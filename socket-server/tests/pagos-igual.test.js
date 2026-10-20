// Modo "igual": el saldo se reparte entre quienes aún no han pagado (más quien
// paga), para que nunca quede saldo sin dueño ni a uno le toque la parte de
// otro. La presencia lleva `pagaron` y llega también a la mesa.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');
const { calcularMonto, personasPorPagar } = require('../src/cuenta');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearEstadoMesasRedis, TTL_CUENTA_SEG } = require('../src/almacen/mesas-redis');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = { info() {}, error() {} };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Las 5 filas de la propuesta. `pagos`: [alias, modo, monto esperado en centavos].
const FILAS = [
  {
    nombre: '2 personas, $85.000: Ana propio $20.000 y Beto igual',
    total: 8_500_000,
    comensales: ['Ana', 'Beto'],
    propio: { Ana: 2_000_000 },
    pagos: [['Ana', 'propio', 2_000_000], ['Beto', 'igual', 6_500_000]],
  },
  {
    nombre: '3 personas, $100.000: Ana propio $30.000; Beto y Carlos igual',
    total: 10_000_000,
    comensales: ['Ana', 'Beto', 'Carlos'],
    propio: { Ana: 3_000_000 },
    pagos: [['Ana', 'propio', 3_000_000], ['Beto', 'igual', 3_500_000], ['Carlos', 'igual', 3_500_000]],
  },
  {
    nombre: '4 personas, $120.000: Ana propio $45.000; Beto, Carlos y Dani igual',
    total: 12_000_000,
    comensales: ['Ana', 'Beto', 'Carlos', 'Dani'],
    propio: { Ana: 4_500_000 },
    pagos: [['Ana', 'propio', 4_500_000], ['Beto', 'igual', 2_500_000], ['Carlos', 'igual', 2_500_000], ['Dani', 'igual', 2_500_000]],
  },
  {
    nombre: '4 personas, $120.000: Ana propio $10.000; los otros tres igual',
    total: 12_000_000,
    comensales: ['Ana', 'Beto', 'Carlos', 'Dani'],
    propio: { Ana: 1_000_000 },
    pagos: [['Ana', 'propio', 1_000_000], ['Beto', 'igual', 3_666_700], ['Carlos', 'igual', 3_666_700], ['Dani', 'igual', 3_666_600]],
  },
  {
    nombre: '3 personas, $100.000: todos igual',
    total: 10_000_000,
    comensales: ['Ana', 'Beto', 'Carlos'],
    propio: {},
    pagos: [['Ana', 'igual', 3_333_300], ['Beto', 'igual', 3_333_400], ['Carlos', 'igual', 3_333_300]],
  },
];

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

test('personasPorPagar: presentes sin pagar + quien paga, nunca menos de 1', () => {
  const n = (comensales, pagaron, comensal) => personasPorPagar({ comensales, pagaron, comensal });
  assert.strictEqual(n(['Ana', 'Beto', 'Caro'], [], 'Ana'), 3);
  assert.strictEqual(n(['Ana', 'Beto', 'Caro'], ['Ana'], 'Beto'), 2, 'Ana ya pagó: no cuenta');
  assert.strictEqual(n(['Ana', 'Beto', 'Caro'], ['Ana'], 'Ana'), 3, 'quien paga cuenta aunque ya haya pagado algo');
  assert.strictEqual(n(['Beto'], ['Ana'], 'Zoe'), 2, 'quien paga cuenta aunque no esté sentado');
  assert.strictEqual(n(['Ana', 'Beto'], ['Ana', 'Beto'], 'Beto'), 1);
  assert.strictEqual(n([], [], 'Ana'), 1);
  assert.strictEqual(n(['Ana', 'Ana'], [], 'Ana'), 1, 'un alias es una persona');
});

for (const fila of FILAS) {
  test(`fórmula: ${fila.nombre}`, () => {
    let saldo = fila.total;
    const pagaron = [];
    for (const [alias, modo, esperado] of fila.pagos) {
      const c = cuenta(5, fila.total, saldo, fila.propio);
      const personas = personasPorPagar({ comensales: fila.comensales, pagaron, comensal: alias });
      const { montoCentavos } = calcularMonto({
        modo, cuenta: c, comensal: alias, personas,
      });
      assert.strictEqual(montoCentavos, esperado, `${alias} (${modo}, n=${personas})`);
      assert.ok(montoCentavos <= saldo, 'nunca más que el saldo');
      if (modo === 'igual' && personas > 1) assert.strictEqual(montoCentavos % 100, 0, 'las partes van en pesos enteros');
      saldo -= montoCentavos;
      pagaron.push(alias);
    }
    assert.strictEqual(saldo, 0, 'no queda saldo sin dueño');
  });
}

// ---------------------------------------------------------------------------
// Estado de mesa: `pagaron` en memoria y en Redis
// ---------------------------------------------------------------------------

const ESTADOS = {
  memoria: () => ({ estado: crearEstadoMesasMemoria() }),
  redis: () => {
    const falso = crearRedisFalso();
    return { estado: crearEstadoMesasRedis({ cliente: falso.cliente }), falso };
  },
};

for (const [nombre, crear] of Object.entries(ESTADOS)) {
  test(`${nombre}: pagaron es idempotente, ordenado, por mesa y se borra con limpiarMesa`, async () => {
    const { estado } = crear();
    await estado.marcarPago(5, 'Beto');
    await estado.marcarPago(5, 'Ana');
    await estado.marcarPago(5, 'Beto');
    await estado.marcarPago(6, 'Zoe');
    assert.deepStrictEqual(await estado.pagaron(5), ['Ana', 'Beto']);
    assert.deepStrictEqual(await estado.pagaron(6), ['Zoe']);
    await estado.marcarCuenta(5);
    await estado.limpiarMesa(5);
    assert.deepStrictEqual(await estado.pagaron(5), []);
    assert.strictEqual(await estado.cuentaSolicitada(5), false);
    assert.deepStrictEqual(await estado.pagaron(6), ['Zoe'], 'otra mesa no se toca');
  });
}

test('redis: pagaron vive en sd:mesa:{ID}:pagaron con TTL de la sesión de mesa', async () => {
  const reloj = { t: 1_000_000 };
  const falso = crearRedisFalso({ ahora: () => reloj.t });
  const estado = crearEstadoMesasRedis({ cliente: falso.cliente });
  await estado.marcarPago(5, 'Ana');
  assert.ok(falso.llaves().includes('sd:mesa:5:pagaron'));
  reloj.t += TTL_CUENTA_SEG * 1000 + 1;
  assert.deepStrictEqual(await estado.pagaron(5), []);
});

// ---------------------------------------------------------------------------
// De punta a punta: intención + webhook, en memoria y con el doble de Redis
// ---------------------------------------------------------------------------

async function escenario(t, almacen, { total, propio = {} }) {
  const mesa = { total, saldo: total, propio: { ...propio } };
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, mesa.total, mesa.saldo, mesa.propio) }),
    'POST /api/transacciones/internal': (c) => {
      if (c.monto_centavos > mesa.saldo) return { status: 409, cuerpo: { error: 'excede' } };
      mesa.saldo -= c.monto_centavos;
      if (c.modo === 'propio') mesa.propio[c.comensal] = 0;
      return { status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: mesa.saldo, mesa_liberada: mesa.saldo === 0 } };
    },
    'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
  });
  const transacciones = {};
  const deps = { backend, pasarela: pasarelaFalsa(transacciones).pasarela, presencia: { ventanaMs: 50 } };
  if (almacen === 'redis') {
    deps.redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: crearRedisFalso().crearCliente, log: silencioso });
  }
  const s = await levantar(WOMPI_ENV, deps);
  t.after(() => s.cerrar());
  const sockets = {};
  const sentar = async (alias) => {
    sockets[alias] = await s.conectar(tokenComensal(5, alias));
    await emitir(sockets[alias], 'join:table', {});
  };
  const pedir = async (alias, modo) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenComensal(5, alias)}` },
      body: JSON.stringify({ modo, eventId: crypto.randomUUID() }),
    });
    return { status: r.status, cuerpo: await r.json() };
  };
  const pagar = async (referencia, monto) => {
    const id = `tx-${crypto.randomUUID()}`;
    transacciones[id] = {
      id, reference: referencia, status: 'APPROVED', amount_in_cents: monto, currency: 'COP',
    };
    const ev = eventoWompi({
      secreto: WOMPI_ENV.WOMPI_EVENTS_SECRET, id, referencia, monto,
    });
    const r = await fetch(`${s.url}/pagos/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
    });
    return r.json();
  };
  return {
    s, mesa, sockets, sentar, pedir, pagar,
  };
}

for (const almacen of ['memoria', 'redis']) {
  for (const fila of FILAS) {
    test(`${almacen}: ${fila.nombre}`, async (t) => {
      const {
        mesa, sentar, pedir, pagar,
      } = await escenario(t, almacen, fila);
      for (const alias of fila.comensales) await sentar(alias);
      for (const [alias, modo, esperado] of fila.pagos) {
        const i = await pedir(alias, modo);
        assert.strictEqual(i.cuerpo.monto_en_centavos, esperado, `${alias} (${modo})`);
        assert.strictEqual((await pagar(i.cuerpo.referencia, esperado)).registrado, true);
      }
      assert.strictEqual(mesa.saldo, 0, 'no queda saldo sin dueño');
    });
  }

  test(`${almacen}: quien se va sin pagar deja de contar`, async (t) => {
    const {
      sockets, sentar, pedir, pagar,
    } = await escenario(t, almacen, { total: 9_000_000 });
    for (const alias of ['Ana', 'Beto', 'Caro']) await sentar(alias);
    const ana = await pedir('Ana', 'igual');
    assert.strictEqual(ana.cuerpo.monto_en_centavos, 3_000_000);
    await pagar(ana.cuerpo.referencia, 3_000_000);
    sockets.Caro.close();
    await pausa(100);
    const beto = await pedir('Beto', 'igual');
    assert.strictEqual(beto.cuerpo.monto_en_centavos, 6_000_000, 'Caro se fue: Beto es el único que falta');
  });

  test(`${almacen}: tras un pago, la mesa recibe mesa:presencia con pagaron; mesa-liberada lo borra`, async (t) => {
    const {
      s, sockets, sentar, pedir, pagar,
    } = await escenario(t, almacen, { total: 9_000_000 });
    await sentar('Ana');
    await sentar('Beto');
    await pausa(100);
    const llega = esperar(sockets.Beto, 'mesa:presencia', 1000);
    const i = await pedir('Ana', 'igual');
    await pagar(i.cuerpo.referencia, i.cuerpo.monto_en_centavos);
    assert.deepStrictEqual(await llega, {
      id_mesa: 5, comensales: ['Ana', 'Beto'], total: 2, pagaron: ['Ana'],
    });
    await fetch(`${s.url}/internal/mesa-liberada`, {
      method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5 }),
    });
    assert.deepStrictEqual(await s.estadoMesas.pagaron(5), []);
  });

  test(`${almacen}: el pago que deja saldo 0 no se anota (la mesa se libera)`, async (t) => {
    const { s, sentar, pedir, pagar } = await escenario(t, almacen, { total: 9_000_000 });
    await sentar('Ana');
    const i = await pedir('Ana', 'total');
    assert.strictEqual((await pagar(i.cuerpo.referencia, 9_000_000)).registrado, true);
    assert.deepStrictEqual(await s.estadoMesas.pagaron(5), []);
  });

  test(`${almacen}: un cobro de caja con alias también saca a ese comensal del reparto`, async (t) => {
    const {
      s, mesa, sockets, sentar, pedir,
    } = await escenario(t, almacen, { total: 9_000_000 });
    for (const alias of ['Ana', 'Beto', 'Caro']) await sentar(alias);
    await pausa(100);
    const llega = esperar(sockets.Ana, 'mesa:presencia', 1000);
    mesa.saldo = 6_000_000; // la caja ya cobró $30.000 a Caro
    const caja = (cuerpo) => fetch(`${s.url}/internal/payment-confirmed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
      body: JSON.stringify({
        eventId: crypto.randomUUID(), id_mesa: 5, monto_centavos: 3_000_000, saldo_restante_centavos: 6_000_000, ...cuerpo,
      }),
    });
    assert.strictEqual((await caja({ comensal: 'Caro' })).status, 200);
    assert.deepStrictEqual((await llega).pagaron, ['Caro']);
    // Sin alias no se puede saber quién pagó: no se anota a nadie.
    assert.strictEqual((await caja({ comensal: null })).status, 200);
    assert.deepStrictEqual(await s.estadoMesas.pagaron(5), ['Caro']);
    const ana = await pedir('Ana', 'igual');
    assert.strictEqual(ana.cuerpo.monto_en_centavos, 3_000_000, '$60.000 entre Ana y Beto');
  });
}

test('el personal recibe el mismo mesa:presencia con pagaron', async (t) => {
  const {
    s, sentar, pedir, pagar,
  } = await escenario(t, 'memoria', { total: 9_000_000 });
  const admin = await s.conectar(tokenPersonal('admin'));
  await sentar('Ana');
  await sentar('Beto');
  await pausa(100);
  const llega = esperar(admin, 'mesa:presencia', 1000);
  const i = await pedir('Beto', 'igual');
  await pagar(i.cuerpo.referencia, i.cuerpo.monto_en_centavos);
  assert.deepStrictEqual((await llega).pagaron, ['Beto']);
});
