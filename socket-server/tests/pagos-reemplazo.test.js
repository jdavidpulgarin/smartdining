// Intención pendiente que ya no sirve (otro modo u otro monto): se reemplaza,
// pero la vieja sigue cobrable por si el comensal ya la pagó en otra pestaña.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal,
} = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, sinRespuesta, pasarelaFalsa,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');
const { crearAlmacenPagosMemoria, crearAlmacenPagosRedis } = require('../src/almacen/pagos');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = { info() {}, error() {} };
const ALMACENES = {
  memoria: () => ({ pagos: crearAlmacenPagosMemoria() }),
  redis: () => {
    const falso = crearRedisFalso();
    return { pagos: crearAlmacenPagosRedis({ cliente: falso.cliente }), falso };
  },
};

// ---------------------------------------------------------------------------
// Almacén: reemplazo atómico, liberación condicional y marca de reemplazada
// ---------------------------------------------------------------------------

for (const [nombre, crear] of Object.entries(ALMACENES)) {
  test(`${nombre}: reemplazarPendiente solo cambia la marca si apunta a la vieja`, async () => {
    const { pagos } = crear();
    await pagos.reservarPendiente(5, 'Ana', 'R1', 1800);
    assert.strictEqual(await pagos.reemplazarPendiente(5, 'Ana', 'R1', 'R2', 1800), 'R2');
    assert.strictEqual(await pagos.obtenerPendiente(5, 'Ana'), 'R2');
    // Otra petición que todavía creía que la pendiente era R1 pierde.
    assert.strictEqual(await pagos.reemplazarPendiente(5, 'Ana', 'R1', 'R3', 1800), 'R2');
    assert.strictEqual(await pagos.obtenerPendiente(5, 'Ana'), 'R2');
    // Si la marca ya no existe (se pagó o venció), la nueva la toma.
    await pagos.liberarPendiente(5, 'Ana', 'R2');
    assert.strictEqual(await pagos.reemplazarPendiente(5, 'Ana', 'R2', 'R4', 1800), 'R4');
  });

  test(`${nombre}: liberarPendiente no borra la marca de una intención más nueva`, async () => {
    const { pagos } = crear();
    await pagos.reservarPendiente(5, 'Ana', 'NUEVA', 1800);
    await pagos.liberarPendiente(5, 'Ana', 'VIEJA');
    assert.strictEqual(await pagos.obtenerPendiente(5, 'Ana'), 'NUEVA');
    await pagos.liberarPendiente(5, 'Ana', 'NUEVA');
    assert.strictEqual(await pagos.obtenerPendiente(5, 'Ana'), null);
  });

  test(`${nombre}: marcarReemplazada solo cambia una intención pendiente`, async () => {
    const { pagos } = crear();
    await pagos.guardarIntencion('R1', { estado: 'pendiente', monto_centavos: 100 }, 1800);
    assert.strictEqual(await pagos.marcarReemplazada('R1', 'R2', 604800), true);
    assert.deepStrictEqual(await pagos.obtener('R1'), { estado: 'reemplazada', monto_centavos: 100, reemplazada_por: 'R2' });
    // Una ya pagada (el webhook ganó la carrera) no vuelve a "reemplazada".
    await pagos.guardarIntencion('R3', { estado: 'pagada' }, 1800);
    assert.strictEqual(await pagos.marcarReemplazada('R3', 'R4', 604800), false);
    assert.strictEqual((await pagos.obtener('R3')).estado, 'pagada');
    assert.strictEqual(await pagos.marcarReemplazada('NO-EXISTE', 'R5', 604800), false);
  });
}

test('redis: si otro proceso cambia la marca a mitad del reemplazo, se reintenta y gana la suya', async () => {
  const { pagos, falso } = ALMACENES.redis();
  await pagos.reservarPendiente(5, 'Ana', 'R1', 1800);
  // Justo antes del EXEC, otra instancia reemplaza R1 por OTRA.
  falso.interferir(() => falso.cliente.set('sd:pago:pendiente:5:Ana', 'OTRA', { EX: 1800 }));
  assert.strictEqual(await pagos.reemplazarPendiente(5, 'Ana', 'R1', 'R2', 1800), 'OTRA');
  assert.strictEqual(await pagos.obtenerPendiente(5, 'Ana'), 'OTRA');
});

// ---------------------------------------------------------------------------
// POST /pagos/intencion + webhook, en memoria y con el doble de Redis
// ---------------------------------------------------------------------------

async function escenario(t, almacen) {
  const estado = { cuenta: cuenta(5, 9_000_000, 9_000_000, { Ana: 4_000_000, Beto: 5_000_000 }), registro: null };
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => (estado.cuenta instanceof Error ? estado.cuenta : { status: 200, cuerpo: estado.cuenta }),
    'POST /api/transacciones/internal': (c) => estado.registro(c),
    'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
  });
  const transacciones = {};
  const { pasarela } = pasarelaFalsa(transacciones);
  const deps = { backend, pasarela };
  if (almacen === 'redis') {
    deps.redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: crearRedisFalso().crearCliente, log: silencioso });
  }
  const s = await levantar(WOMPI_ENV, deps);
  t.after(() => s.cerrar());
  const admin = await s.conectar(tokenPersonal('admin'));
  const sentar = async (alias) => {
    const token = tokenComensal(5, alias);
    await emitir(await s.conectar(token), 'join:table', {});
    return token;
  };
  const pedir = async (token, modo) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ modo, eventId: crypto.randomUUID() }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  // Wompi aprueba (o no) la referencia por el monto dado y avisa al webhook.
  const pagar = async (referencia, monto, estadoTx = 'APPROVED') => {
    const id = `tx-${crypto.randomUUID()}`;
    transacciones[id] = {
      id, reference: referencia, status: estadoTx, amount_in_cents: monto, currency: 'COP',
    };
    const ev = eventoWompi({
      secreto: WOMPI_ENV.WOMPI_EVENTS_SECRET, id, referencia, monto, estado: estadoTx,
    });
    const r = await fetch(`${s.url}/pagos/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
    });
    return r.json();
  };
  const consultasDeCuenta = () => backend.llamadas.filter((l) => l.ruta.includes('/cuenta/')).length;
  return {
    s, estado, admin, sentar, pedir, pagar, consultasDeCuenta,
  };
}

for (const almacen of ['memoria', 'redis']) {
  test(`${almacen}: mismo modo y mismo monto → la misma intención; la cuenta se consulta cada vez`, async (t) => {
    const { sentar, pedir, consultasDeCuenta } = await escenario(t, almacen);
    const ana = await sentar('Ana');
    const a = await pedir(ana, 'total');
    const b = await pedir(ana, 'total');
    assert.deepStrictEqual([a.status, b.status], [201, 200]);
    assert.strictEqual(b.cuerpo.referencia, a.cuerpo.referencia);
    assert.strictEqual(consultasDeCuenta(), 2, 'el monto se recalcula antes de reutilizar');
  });

  test(`${almacen}: cambiar de modo crea una intención nueva y la vieja queda reemplazada`, async (t) => {
    const { s, sentar, pedir } = await escenario(t, almacen);
    const ana = await sentar('Ana');
    await sentar('Beto');
    const vieja = await pedir(ana, 'igual');
    assert.strictEqual(vieja.cuerpo.monto_en_centavos, 4_500_000);
    const nueva = await pedir(ana, 'propio');
    assert.strictEqual(nueva.status, 201);
    assert.notStrictEqual(nueva.cuerpo.referencia, vieja.cuerpo.referencia);
    assert.strictEqual(nueva.cuerpo.monto_en_centavos, 4_000_000, 'lo propio de Ana, no el monto viejo');
    assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), nueva.cuerpo.referencia);
    const v = await s.almacenPagos.obtener(vieja.cuerpo.referencia);
    assert.deepStrictEqual([v.estado, v.reemplazada_por, v.monto_centavos], ['reemplazada', nueva.cuerpo.referencia, 4_500_000]);
  });

  test(`${almacen}: si la cuenta cambió (pedido nuevo), mismo modo → intención nueva con el monto nuevo`, async (t) => {
    const { s, estado, sentar, pedir } = await escenario(t, almacen);
    const ana = await sentar('Ana');
    const vieja = await pedir(ana, 'total');
    estado.cuenta = cuenta(5, 12_000_000, 12_000_000, { Ana: 7_000_000, Beto: 5_000_000 });
    const nueva = await pedir(ana, 'total');
    assert.strictEqual(nueva.status, 201);
    assert.strictEqual(nueva.cuerpo.monto_en_centavos, 12_000_000);
    assert.strictEqual((await s.almacenPagos.obtener(vieja.cuerpo.referencia)).estado, 'reemplazada');
  });

  test(`${almacen}: con una pendiente y el backend caído → 503, sin tocar la pendiente`, async (t) => {
    const { s, estado, sentar, pedir } = await escenario(t, almacen);
    const ana = await sentar('Ana');
    const vieja = await pedir(ana, 'total');
    estado.cuenta = sinRespuesta();
    const r = await pedir(ana, 'total');
    assert.deepStrictEqual([r.status, r.cuerpo.codigo], [503, 'ERROR_INTERNO']);
    assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), vieja.cuerpo.referencia);
    assert.strictEqual((await s.almacenPagos.obtener(vieja.cuerpo.referencia)).estado, 'pendiente');
  });

  test(`${almacen}: la vieja ya se pagó en otra pestaña → su webhook se registra y la nueva sigue pendiente`, async (t) => {
    const {
      s, estado, admin, sentar, pedir, pagar,
    } = await escenario(t, almacen);
    const registros = [];
    estado.registro = (c) => {
      registros.push(c);
      return { status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: 9_000_000 - c.monto_centavos } };
    };
    const ana = await sentar('Ana');
    await sentar('Beto');
    const vieja = await pedir(ana, 'igual');
    const nueva = await pedir(ana, 'propio');

    const aviso = esperar(admin, 'payment:confirmed');
    assert.deepStrictEqual(await pagar(vieja.cuerpo.referencia, 4_500_000), { ok: true, duplicado: false, registrado: true });
    const ev = await aviso;
    assert.deepStrictEqual([ev.referencia_externa, ev.monto_centavos, ev.comensal], [vieja.cuerpo.referencia, 4_500_000, 'Ana']);
    assert.deepStrictEqual(registros.map((r) => [r.referencia_externa, r.modo, r.monto_centavos]), [[vieja.cuerpo.referencia, 'igual', 4_500_000]]);
    assert.strictEqual((await s.almacenPagos.obtener(vieja.cuerpo.referencia)).estado, 'pagada');
    assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), nueva.cuerpo.referencia, 'la marca de la nueva no se borra');

    // El saldo cambió: la próxima petición ya no reutiliza la nueva (monto viejo).
    estado.cuenta = cuenta(5, 9_000_000, 4_500_000, { Ana: 0, Beto: 4_500_000 });
    assert.strictEqual((await pedir(ana, 'propio')).status, 409, 'Ana ya no debe nada propio');
    const otra = await pedir(ana, 'total');
    assert.strictEqual(otra.status, 201);
    assert.strictEqual(otra.cuerpo.monto_en_centavos, 4_500_000);
    assert.strictEqual((await s.almacenPagos.obtener(nueva.cuerpo.referencia)).estado, 'reemplazada');
  });

  test(`${almacen}: pagó la vieja Y la nueva → la que excede el saldo no se anuncia; queda la alerta`, async (t) => {
    const {
      estado, admin, sentar, pedir, pagar,
    } = await escenario(t, almacen);
    let saldo = 9_000_000;
    estado.registro = (c) => {
      if (c.monto_centavos > saldo) return { status: 409, cuerpo: { error: 'El pago excede el saldo de la mesa', saldo_centavos: saldo } };
      saldo -= c.monto_centavos;
      return { status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: saldo } };
    };
    const ana = await sentar('Ana');
    const vieja = await pedir(ana, 'total');
    estado.cuenta = cuenta(5, 9_500_000, 9_500_000, { Ana: 4_500_000, Beto: 5_000_000 });
    const nueva = await pedir(ana, 'total');
    assert.strictEqual((await pagar(vieja.cuerpo.referencia, 9_000_000)).registrado, true);
    const alerta = esperar(admin, 'pago:alerta');
    const nada = esperar(admin, 'payment:confirmed', 300);
    assert.strictEqual((await pagar(nueva.cuerpo.referencia, 9_500_000)).registrado, false);
    assert.deepStrictEqual([(await alerta).motivo, await nada], ['backend_rechazo_409', null]);
  });

  test(`${almacen}: una reemplazada se cobra solo por SU monto exacto`, async (t) => {
    const {
      estado, admin, sentar, pedir, pagar,
    } = await escenario(t, almacen);
    estado.registro = () => ({ status: 201, cuerpo: { ok: true, saldo_restante_centavos: 0 } });
    const ana = await sentar('Ana');
    await sentar('Beto');
    const vieja = await pedir(ana, 'igual');
    const nueva = await pedir(ana, 'propio');
    const alerta = esperar(admin, 'pago:alerta');
    // Con la referencia vieja pero por el monto de la nueva: no cuadra.
    assert.strictEqual((await pagar(vieja.cuerpo.referencia, nueva.cuerpo.monto_en_centavos)).registrado, false);
    assert.strictEqual((await alerta).motivo, 'monto_distinto');
  });

  test(`${almacen}: DECLINED de una reemplazada la marca como rechazada sin liberar la nueva`, async (t) => {
    const {
      s, sentar, pedir, pagar,
    } = await escenario(t, almacen);
    const ana = await sentar('Ana');
    await sentar('Beto');
    const vieja = await pedir(ana, 'igual');
    const nueva = await pedir(ana, 'propio');
    assert.strictEqual((await pagar(vieja.cuerpo.referencia, 4_500_000, 'DECLINED')).registrado, false);
    assert.strictEqual((await s.almacenPagos.obtener(vieja.cuerpo.referencia)).estado, 'rechazada');
    assert.strictEqual(await s.almacenPagos.obtenerPendiente(5, 'Ana'), nueva.cuerpo.referencia);
  });
}
