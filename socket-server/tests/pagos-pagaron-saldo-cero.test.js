// El pago que deja el saldo en 0 también se anota en `pagaron` mientras la
// mesa siga ocupada (un pedido sin entregar: EVENTS.md §5.1), pero nunca en una
// mesa que el backend ya liberó: ensuciaría la sesión del grupo siguiente.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  levantar, emitir, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { crearEstadoMesasRedis } = require('../src/almacen/mesas-redis');

const silencioso = { info() {}, error() {} };
const REDIS_URL = process.env.REDIS_URL;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera (hasta 2 s) a que se cumpla `cond`, sin depender de la carga de la máquina. */
async function hasta(cond, ms = 2000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await pausa(20); // eslint-disable-line no-await-in-loop
}

// Mesa `idMesa` (5 por defecto) con $90.000. El backend cobra y responde el saldo; no libera la mesa
// por su cuenta (eso lo decide la prueba con /internal/mesa-liberada).
async function escenario(t, almacen, idMesa = 5) {
  const mesa = { saldo: 9_000_000 };
  const backend = backendFalso({
    [`GET /api/mesas/${idMesa}/cuenta/interno`]: () => ({ status: 200, cuerpo: cuenta(idMesa, 9_000_000, mesa.saldo) }),
    'POST /api/transacciones/internal': (c) => {
      mesa.saldo -= c.monto_centavos;
      // Saldo 0 con un pedido sin entregar: la mesa sigue ocupada.
      return { status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: mesa.saldo, mesa_liberada: false } };
    },
    'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
  });
  const transacciones = {};
  const deps = { backend, pasarela: pasarelaFalsa(transacciones).pasarela, presencia: { ventanaMs: 50 } };
  if (almacen === 'redis') {
    deps.redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: crearRedisFalso().crearCliente, log: silencioso });
  } else if (almacen === 'redis-real') {
    deps.redis = crearConexionRedis({ url: REDIS_URL, log: silencioso });
    await deps.redis.conectar();
  }
  const s = await levantar(WOMPI_ENV, deps);
  // Una sola limpieza y en orden: node:test corre los t.after en el orden en que
  // se registran, y con Redis real hay que borrar la mesa ANTES de cerrar.
  t.after(async () => {
    if (almacen === 'redis-real') await s.estadoMesas.limpiarMesa(idMesa);
    await s.cerrar();
  });

  const interno = (ruta, cuerpo) => fetch(`${s.url}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
    body: JSON.stringify(cuerpo),
  });
  const liberar = async () => assert.strictEqual((await interno('/internal/mesa-liberada', { id_mesa: idMesa, motivo: 'pagada' })).status, 200);
  /** Sesión nueva: el personal genera el QR y el JWT del comensal es posterior a la liberación. */
  const reabrir = async () => {
    const r = await fetch(`${s.url}/qr/generar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPersonal('mesero')}` },
      body: JSON.stringify({ id_mesa: idMesa }),
    });
    assert.strictEqual(r.status, 201);
    mesa.saldo = 9_000_000;
  };
  // iat 2 s en el futuro: así el JWT de la sesión nueva es posterior a la
  // liberación aunque todo pase en el mismo segundo.
  const token = (alias, nueva) => tokenComensal(idMesa, alias, nueva ? { iat: Math.floor(Date.now() / 1000) + 2 } : {});
  const sentar = async (alias, nueva = false) => {
    const c = await s.conectar(token(alias, nueva));
    const recibidas = [];
    c.on('mesa:presencia', (p) => recibidas.push(p));
    await emitir(c, 'join:table', {});
    return recibidas;
  };
  const pedir = async (alias, nueva = false) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(alias, nueva)}` },
      body: JSON.stringify({ modo: 'total', eventId: crypto.randomUUID() }),
    });
    assert.strictEqual(r.status, 201);
    return (await r.json()).referencia;
  };
  const pagar = async (referencia) => {
    const id = `tx-${crypto.randomUUID()}`;
    transacciones[id] = {
      id, reference: referencia, status: 'APPROVED', amount_in_cents: mesa.saldo, currency: 'COP',
    };
    const ev = eventoWompi({
      secreto: WOMPI_ENV.WOMPI_EVENTS_SECRET, id, referencia, monto: mesa.saldo,
    });
    const r = await fetch(`${s.url}/pagos/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
    });
    return r.json();
  };
  const caja = (cuerpo) => interno('/internal/payment-confirmed', {
    eventId: crypto.randomUUID(), id_mesa: idMesa, monto_centavos: 9_000_000, saldo_restante_centavos: 0, ...cuerpo,
  });
  /** La próxima llamada a marcarPago corre `antes` y/o `despues` alrededor de la escritura real. */
  const alrededorDeMarcar = ({ antes, despues }) => {
    const original = s.estadoMesas.marcarPago;
    s.estadoMesas.marcarPago = async (...args) => {
      s.estadoMesas.marcarPago = original;
      if (antes) await antes();
      await original.apply(s.estadoMesas, args);
      if (despues) await despues();
    };
  };
  const pagaron = () => s.estadoMesas.pagaron(idMesa);
  return {
    s, mesa, liberar, reabrir, sentar, pedir, pagar, caja, alrededorDeMarcar, pagaron, idMesa,
  };
}

for (const almacen of ['memoria', 'redis']) {
  test(`${almacen}: saldo 0 con un pedido sin entregar: quien pagó aparece en pagaron y en mesa:presencia`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    const deBeto = await e.sentar('Beto');
    const conPago = () => deBeto.find((p) => p.pagaron.length > 0);
    const r = await e.pagar(await e.pedir('Ana'));
    assert.strictEqual(r.registrado, true);
    assert.strictEqual(e.mesa.saldo, 0);
    assert.deepStrictEqual(await e.pagaron(), ['Ana']);
    await hasta(conPago);
    assert.deepStrictEqual(conPago(), {
      id_mesa: 5, comensales: ['Ana', 'Beto'], total: 2, pagaron: ['Ana'], sin_celular: [],
    });
  });

  test(`${almacen}: saldo 0 con la mesa ya liberada: no se anota y la sesión siguiente empieza limpia`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    const referencia = await e.pedir('Ana');
    await e.liberar(); // el backend liberó la mesa antes de que llegara el webhook
    assert.strictEqual((await e.pagar(referencia)).registrado, true);
    assert.deepStrictEqual(await e.pagaron(), []);
    assert.ok(!(await e.s.estadoMesas.mesasConEstado()).includes(5), 'la mesa no queda en el índice');

    await e.reabrir();
    const deZoe = await e.sentar('Zoe', true);
    await hasta(() => deZoe.length > 0);
    assert.deepStrictEqual(deZoe[0].pagaron, [], 'el grupo nuevo no hereda a Ana');
    // En la sesión nueva el pago que deja saldo 0 sí se anota.
    assert.strictEqual((await e.pagar(await e.pedir('Zoe', true))).registrado, true);
    assert.deepStrictEqual(await e.pagaron(), ['Zoe']);
  });

  test(`${almacen}: el webhook de una intención vieja llega con el grupo siguiente ya sentado: no lo ensucia`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    const vieja = await e.pedir('Ana');
    await e.liberar();
    await e.reabrir(); // QR nuevo: la mesa ya no figura liberada (mesaLiberada es false)
    const deZoe = await e.sentar('Zoe', true);
    assert.strictEqual((await e.pagar(vieja)).registrado, true);
    assert.deepStrictEqual(await e.pagaron(), [], 'la intención es de antes de la liberación');
    await pausa(150); // más que la ventana de presencia (50 ms)
    assert.ok(deZoe.every((p) => p.pagaron.length === 0), 'Zoe nunca ve a Ana en pagaron');
  });

  test(`${almacen}: carrera, la liberación termina justo antes de anotar: se deshace la anotación`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    const referencia = await e.pedir('Ana');
    // La guardia previa no ve nada; mesa-liberada (revoca y limpia) corre
    // completo antes de la escritura, que queda sola en una mesa libre.
    e.alrededorDeMarcar({ antes: e.liberar });
    assert.strictEqual((await e.pagar(referencia)).registrado, true);
    assert.deepStrictEqual(await e.pagaron(), []);
    assert.ok(!(await e.s.estadoMesas.mesasConEstado()).includes(5), 'la mesa no queda en el índice');
  });

  test(`${almacen}: carrera, la liberación llega entre la anotación y la comprobación: no queda nada`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    const referencia = await e.pedir('Ana');
    e.alrededorDeMarcar({ despues: e.liberar });
    assert.strictEqual((await e.pagar(referencia)).registrado, true);
    assert.deepStrictEqual(await e.pagaron(), []);
  });

  test(`${almacen}: carrera, la liberación llega después del pago: la limpia como al resto de la sesión`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    assert.strictEqual((await e.pagar(await e.pedir('Ana'))).registrado, true);
    assert.deepStrictEqual(await e.pagaron(), ['Ana']);
    await e.liberar();
    assert.deepStrictEqual(await e.pagaron(), []);
  });

  test(`${almacen}: caja con saldo 0 y la mesa ocupada: anota y avisa; el reintento tras la liberación no`, async (t) => {
    const e = await escenario(t, almacen);
    const deAna = await e.sentar('Ana');
    const conPago = () => deAna.find((p) => p.pagaron.length > 0);
    assert.strictEqual((await e.caja({ comensal: 'Caro' })).status, 200);
    assert.deepStrictEqual(await e.pagaron(), ['Caro']);
    await hasta(conPago);
    assert.deepStrictEqual(conPago().pagaron, ['Caro']);

    await e.liberar();
    // El backend reintenta un cobro de la sesión ya cerrada (otro eventId).
    assert.strictEqual((await e.caja({ comensal: 'Dani' })).status, 200);
    assert.deepStrictEqual(await e.pagaron(), []);
  });

  test(`${almacen}: caja, la liberación llega entre la anotación y la comprobación: no queda nada`, async (t) => {
    const e = await escenario(t, almacen);
    await e.sentar('Ana');
    e.alrededorDeMarcar({ despues: e.liberar });
    assert.strictEqual((await e.caja({ comensal: 'Caro' })).status, 200);
    assert.deepStrictEqual(await e.pagaron(), []);
  });
}

// --- Contra un Redis real (el job «socket-server · pruebas (con Redis)» del CI
// levanta redis:7). Se omiten si no hay REDIS_URL. Mesa al azar por prueba: el
// Redis es compartido y las marcas de revocación duran horas.
const sinRedis = !REDIS_URL && 'sin REDIS_URL';
const mesaAlAzar = () => 800000 + Math.floor(Math.random() * 90000);

test('Redis real: desmarcarPago quita solo ese alias y saca la mesa del índice cuando no le queda nada', { skip: sinRedis }, async (t) => {
  const conexion = crearConexionRedis({ url: REDIS_URL, log: silencioso });
  await conexion.conectar();
  const e = crearEstadoMesasRedis({ cliente: conexion.cliente });
  const [conPagos, conSinCelular] = [mesaAlAzar(), mesaAlAzar() + 1];
  t.after(async () => {
    await e.limpiarMesa(conPagos);
    await e.limpiarMesa(conSinCelular);
    await conexion.cerrar();
  });

  await e.marcarPago(conPagos, 'Ana');
  await e.marcarPago(conPagos, 'Beto');
  await e.desmarcarPago(conPagos, 'Ana');
  assert.deepStrictEqual(await e.pagaron(conPagos), ['Beto']);
  assert.ok((await e.mesasConEstado()).includes(conPagos), 'Beto sigue anotado: la mesa sigue en el índice');
  await e.desmarcarPago(conPagos, 'Beto');
  assert.deepStrictEqual(await e.pagaron(conPagos), []);
  assert.ok(!(await e.mesasConEstado()).includes(conPagos), 'sin nada anotado sale del índice');

  await e.agregarSinCelular(conSinCelular, 'abuela', 'Abuela');
  await e.marcarPago(conSinCelular, 'Ana');
  await e.desmarcarPago(conSinCelular, 'Ana');
  assert.ok((await e.mesasConEstado()).includes(conSinCelular), 'con un sin celular la mesa sigue en el índice');
  // Desmarcar a quien no está es inofensivo.
  await e.desmarcarPago(conSinCelular, 'Zoe');
  assert.deepStrictEqual(await e.pagaron(conSinCelular), []);
});

test('Redis real: saldo 0 con un pedido sin entregar se anota y llega en mesa:presencia', { skip: sinRedis }, async (t) => {
  const e = await escenario(t, 'redis-real', mesaAlAzar());
  const deAna = await e.sentar('Ana');
  assert.strictEqual((await e.pagar(await e.pedir('Ana'))).registrado, true);
  assert.deepStrictEqual(await e.pagaron(), ['Ana']);
  await hasta(() => deAna.some((p) => p.pagaron.length > 0));
  assert.deepStrictEqual(deAna.find((p) => p.pagaron.length > 0).pagaron, ['Ana']);
});

test('Redis real: carrera, la liberación termina justo antes de anotar: se deshace y la mesa sale del índice', { skip: sinRedis }, async (t) => {
  const e = await escenario(t, 'redis-real', mesaAlAzar());
  await e.sentar('Ana');
  const referencia = await e.pedir('Ana');
  e.alrededorDeMarcar({ antes: e.liberar });
  assert.strictEqual((await e.pagar(referencia)).registrado, true);
  assert.deepStrictEqual(await e.pagaron(), []);
  assert.ok(!(await e.s.estadoMesas.mesasConEstado()).includes(e.idMesa), 'la mesa no queda en el índice');
});

test('Redis real: carrera, la liberación llega entre la anotación y la comprobación: no queda nada', { skip: sinRedis }, async (t) => {
  const e = await escenario(t, 'redis-real', mesaAlAzar());
  await e.sentar('Ana');
  const referencia = await e.pedir('Ana');
  e.alrededorDeMarcar({ despues: e.liberar });
  assert.strictEqual((await e.pagar(referencia)).registrado, true);
  assert.deepStrictEqual(await e.pagaron(), []);
});

test('Redis real: el webhook de una intención vieja con el grupo siguiente sentado no lo ensucia', { skip: sinRedis }, async (t) => {
  const e = await escenario(t, 'redis-real', mesaAlAzar());
  await e.sentar('Ana');
  const vieja = await e.pedir('Ana');
  await e.liberar();
  await e.reabrir();
  const deZoe = await e.sentar('Zoe', true);
  assert.strictEqual((await e.pagar(vieja)).registrado, true);
  assert.deepStrictEqual(await e.pagaron(), []);
  await pausa(150);
  assert.ok(deZoe.every((p) => p.pagaron.length === 0), 'Zoe nunca ve a Ana en pagaron');
});

test('Redis real: caja, la liberación llega entre la anotación y la comprobación: no queda nada', { skip: sinRedis }, async (t) => {
  const e = await escenario(t, 'redis-real', mesaAlAzar());
  await e.sentar('Ana');
  e.alrededorDeMarcar({ despues: e.liberar });
  assert.strictEqual((await e.caja({ comensal: 'Caro' })).status, 200);
  assert.deepStrictEqual(await e.pagaron(), []);
});
