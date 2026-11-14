// `pagaron` y los modos que quedan (T2): «pagar lo mío» (propio) y «pagar toda
// la cuenta» (total). El modo «igual» (Dividir) ya no existe: 400. La
// presencia sigue llevando `pagaron` (quién ya pagó algo en esta sesión de
// mesa) y llega también a la mesa.
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
const { calcularMonto, MODOS } = require('../src/cuenta');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearEstadoMesasRedis, TTL_CUENTA_SEG } = require('../src/almacen/mesas-redis');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = { info() {}, error() {} };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** Espera (hasta 2 s) a que se cumpla `cond`, sin depender de la carga de la máquina. */
async function hasta(cond, ms = 2000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await pausa(20); // eslint-disable-line no-await-in-loop
}

// Mesas que se pagan completas con propio y total. `pagos`: [alias, modo, monto esperado en centavos].
const FILAS = [
  {
    nombre: '2 personas, $85.000: Ana paga lo suyo ($20.000) y Beto el resto con total',
    total: 8_500_000,
    comensales: ['Ana', 'Beto'],
    propio: { Ana: 2_000_000, Beto: 6_500_000 },
    pagos: [['Ana', 'propio', 2_000_000], ['Beto', 'total', 6_500_000]],
  },
  {
    nombre: '3 personas, $100.000: Ana y Beto pagan lo suyo; Carlos paga lo que queda',
    total: 10_000_000,
    comensales: ['Ana', 'Beto', 'Carlos'],
    propio: { Ana: 3_000_000, Beto: 5_000_000, Carlos: 1_000_000 },
    pagos: [['Ana', 'propio', 3_000_000], ['Beto', 'propio', 5_000_000], ['Carlos', 'total', 2_000_000]],
  },
  {
    nombre: '3 personas, $120.000: cada uno paga lo suyo y la cuenta queda en 0',
    total: 12_000_000,
    comensales: ['Ana', 'Beto', 'Carlos'],
    propio: { Ana: 4_500_000, Beto: 4_000_000, Carlos: 3_500_000 },
    pagos: [['Ana', 'propio', 4_500_000], ['Beto', 'propio', 4_000_000], ['Carlos', 'propio', 3_500_000]],
  },
  {
    nombre: '1 persona invita: Ana paga toda la cuenta de $100.000',
    total: 10_000_000,
    comensales: ['Ana', 'Beto'],
    propio: { Ana: 4_000_000, Beto: 6_000_000 },
    pagos: [['Ana', 'total', 10_000_000]],
  },
];

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

test('MODOS: solo propio y total; «igual» ya no es un modo', () => {
  assert.deepStrictEqual([...MODOS].sort(), ['propio', 'total']);
  assert.ok(!MODOS.includes('igual'));
});

for (const fila of FILAS) {
  test(`fórmula: ${fila.nombre}`, () => {
    let saldo = fila.total;
    const propio = { ...fila.propio };
    for (const [alias, modo, esperado] of fila.pagos) {
      const { montoCentavos } = calcularMonto({ modo, cuenta: cuenta(5, fila.total, saldo, propio), comensal: alias });
      assert.strictEqual(montoCentavos, esperado, `${alias} (${modo})`);
      assert.ok(montoCentavos <= saldo, 'nunca más que el saldo');
      saldo -= montoCentavos;
      if (modo === 'propio') propio[alias] = 0;
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
    s, mesa, sockets, sentar, pedir, pagar, backend,
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

  test(`${almacen}: modo «igual» → 400 PAYLOAD_INVALIDO, sin consultar la cuenta ni gastar el límite`, async (t) => {
    const {
      sentar, pedir, backend,
    } = await escenario(t, almacen, { total: 9_000_000, propio: { Ana: 3_000_000 } });
    await sentar('Ana');
    const antes = backend.llamadas ? backend.llamadas.length : 0;
    for (let k = 0; k < 6; k += 1) {
      const r = await pedir('Ana', 'igual');
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.cuerpo.codigo, 'PAYLOAD_INVALIDO');
      assert.match(r.cuerpo.mensaje, /igual.*ya no existe.*propio.*total/i);
    }
    if (backend.llamadas) assert.strictEqual(backend.llamadas.length, antes, 'no se consulta la cuenta');
    // 6 «igual» no consumieron el límite de 5 intenciones por minuto.
    assert.strictEqual((await pedir('Ana', 'propio')).status, 201);
  });

  test(`${almacen}: tras un pago, la mesa recibe mesa:presencia con pagaron; mesa-liberada lo borra`, async (t) => {
    const {
      s, sockets, sentar, pedir, pagar,
    } = await escenario(t, almacen, { total: 9_000_000, propio: { Ana: 3_000_000, Beto: 6_000_000 } });
    await sentar('Ana');
    await sentar('Beto');
    // Bajo carga, la presencia de "Beto se sentó" (pagaron []) puede llegar
    // tarde: se guardan todas y se espera la que trae el pago.
    const recibidas = [];
    sockets.Beto.on('mesa:presencia', (p) => recibidas.push(p));
    const conPago = () => recibidas.find((p) => p.pagaron.length > 0);
    const i = await pedir('Ana', 'propio');
    await pagar(i.cuerpo.referencia, i.cuerpo.monto_en_centavos);
    await hasta(conPago);
    assert.deepStrictEqual(conPago(), {
      id_mesa: 5, comensales: ['Ana', 'Beto'], total: 2, pagaron: ['Ana'], sin_celular: [],
    });
    await fetch(`${s.url}/internal/mesa-liberada`, {
      method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5 }),
    });
    assert.deepStrictEqual(await s.estadoMesas.pagaron(5), []);
  });

  test(`${almacen}: un cobro de caja con alias anota a ese comensal en pagaron; sin alias, a nadie`, async (t) => {
    const {
      s, mesa, sockets, sentar, pedir,
    } = await escenario(t, almacen, { total: 9_000_000, propio: { Ana: 3_000_000, Beto: 3_000_000, Caro: 3_000_000 } });
    for (const alias of ['Ana', 'Beto', 'Caro']) await sentar(alias);
    await pausa(100);
    const llega = esperar(sockets.Ana, 'mesa:presencia', 1000);
    mesa.saldo = 6_000_000; // la caja ya cobró $30.000 a Caro
    mesa.propio.Caro = 0;
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
    // Después de la caja, cada modo cobra con el saldo nuevo.
    assert.strictEqual((await pedir('Ana', 'propio')).cuerpo.monto_en_centavos, 3_000_000);
    assert.strictEqual((await pedir('Beto', 'total')).cuerpo.monto_en_centavos, 6_000_000);
  });
}

test('el personal recibe el mismo mesa:presencia con pagaron', async (t) => {
  const {
    s, sentar, pedir, pagar,
  } = await escenario(t, 'memoria', { total: 9_000_000, propio: { Ana: 4_000_000, Beto: 5_000_000 } });
  const admin = await s.conectar(tokenPersonal('admin'));
  await sentar('Ana');
  await sentar('Beto');
  await pausa(100);
  const llega = esperar(admin, 'mesa:presencia', 1000);
  const i = await pedir('Beto', 'propio');
  await pagar(i.cuerpo.referencia, i.cuerpo.monto_en_centavos);
  assert.deepStrictEqual((await llega).pagaron, ['Beto']);
});
