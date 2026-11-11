// Presencia inicial: el personal que entra a room:admin (o recarga el panel)
// recibe al instante mesa:presencia de cada mesa con algo, solo en su socket.
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { io: cliente } = require('socket.io-client');
const {
  levantar, emitir, tokenComensal, tokenPantalla, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearEstadoMesasRedis, TTL_CUENTA_SEG } = require('../src/almacen/mesas-redis');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = { info() {}, error() {} };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const REDIS_URL = process.env.REDIS_URL;
const DIA_MS = TTL_CUENTA_SEG * 1000;
// Lo que se espera que haya llegado: se espera bastante más que lo que tarda.
const ESPERA_MS = 300;

/**
 * Conecta con el listener de mesa:presencia YA puesto: el servidor la manda
 * justo al conectar y un listener agregado después del 'connect' podría
 * perderla (el panel real registra sus listeners antes de conectar).
 */
function conectarEscuchando(s, token) {
  const c = cliente(s.url, {
    auth: { token }, transports: ['websocket'], reconnection: false, autoConnect: false,
  });
  const recibidas = [];
  c.on('mesa:presencia', (p) => recibidas.push(p));
  return new Promise((resolve, reject) => {
    c.on('connect', () => resolve({ c, recibidas }));
    c.on('connect_error', reject);
    c.connect();
  });
}

const agregarSinCelular = (s, idMesa, alias) => fetch(`${s.url}/internal/mesa-comensal`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
  body: JSON.stringify({
    id_mesa: idMesa, alias, accion: 'agregar', eventId: randomUUID(),
  }),
});
const liberar = (s, idMesa) => fetch(`${s.url}/internal/mesa-liberada`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
  body: JSON.stringify({ id_mesa: idMesa }),
});
/** Solo las mesas de esta prueba: en Redis real otras pruebas escriben a la vez. */
const deEstas = (recibidas, mesas) => recibidas.filter((p) => mesas.includes(p.id_mesa));

/**
 * Mesas (con ids propios de cada corrida para Redis real):
 * - A: Ana sentada con celular;
 * - B: un "sin celular" y NINGÚN socket (ni comensal ni tablet);
 * - C: alguien que pagó y ningún socket;
 * - D: solo la tablet conectada (mesa vacía o cerrada): no se envía.
 */
async function escenario(t, deps = {}, base = 10) {
  const s = await levantar({}, { presencia: { ventanaMs: 30 }, ...deps });
  const mesas = { A: base + 1, B: base + 2, C: base + 3, D: base + 4 };
  const abiertos = [];
  t.after(async () => {
    for (const c of abiertos) c.close();
    for (const id of Object.values(mesas)) await s.estadoMesas.limpiarMesa(id);
    await s.cerrar();
  });
  const ana = await s.conectar(tokenComensal(mesas.A, 'Ana'));
  await emitir(ana, 'join:table', {});
  assert.strictEqual((await agregarSinCelular(s, mesas.B, 'Abuela')).status, 200);
  await s.estadoMesas.marcarPago(mesas.C, 'Beto');
  await s.conectar(tokenPantalla(mesas.D));
  await pausa(100); // se cierran las ventanas de presencia de los cambios de arriba
  const conectar = async (token) => {
    const r = await conectarEscuchando(s, token);
    abiertos.push(r.c);
    return r;
  };
  return { s, mesas, conectar };
}

const esperadas = (m) => [
  { id_mesa: m.A, comensales: ['Ana'], total: 1, pagaron: [], sin_celular: [] },
  { id_mesa: m.B, comensales: ['Abuela'], total: 1, pagaron: [], sin_celular: ['Abuela'] },
  { id_mesa: m.C, comensales: [], total: 0, pagaron: ['Beto'], sin_celular: [] },
];

const ALMACENES = {
  memoria: async () => ({}),
  'Redis falso': async () => {
    const falso = crearRedisFalso();
    const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
    await redis.conectar();
    return { redis };
  },
};

for (const [nombre, crearDeps] of Object.entries(ALMACENES)) {
  test(`${nombre}: admin, mesero y cajero reciben al conectar una presencia por mesa con algo`, async (t) => {
    const { mesas, conectar } = await escenario(t, await crearDeps());
    for (const rol of ['admin', 'mesero', 'cajero']) {
      const { recibidas } = await conectar(tokenPersonal(rol));
      await pausa(ESPERA_MS);
      const todas = Object.values(mesas);
      assert.deepStrictEqual(deEstas(recibidas, todas), esperadas(mesas), rol);
      assert.ok(!recibidas.some((p) => p.id_mesa === mesas.D), `${rol}: la mesa con solo la tablet no se envía`);
    }
  });
}

test('aislamiento: comensal, tablet y cocina no reciben la presencia inicial', async (t) => {
  const { mesas, conectar } = await escenario(t);
  const quienes = await Promise.all([
    conectar(tokenComensal(mesas.A, 'Carla')),
    conectar(tokenComensal(mesas.D, 'Dani')),
    conectar(tokenPantalla(mesas.A)),
    conectar(tokenPersonal('cocina')),
  ]);
  await pausa(ESPERA_MS);
  assert.deepStrictEqual(quienes.map((q) => q.recibidas.length), [0, 0, 0, 0]);
});

test('sin difusión: el panel que ya estaba no recibe nada cuando entra otro', async (t) => {
  const { mesas, conectar } = await escenario(t);
  const primero = await conectar(tokenPersonal('admin'));
  await pausa(ESPERA_MS);
  assert.strictEqual(primero.recibidas.length, 3);
  const segundo = await conectar(tokenPersonal('mesero'));
  await pausa(ESPERA_MS);
  assert.strictEqual(segundo.recibidas.length, 3);
  assert.strictEqual(primero.recibidas.length, 3, 'la presencia inicial va solo al que entra');
  assert.ok(mesas.A);
});

test('reconexión (recargar el panel): se vuelve a recibir', async (t) => {
  const { mesas, conectar } = await escenario(t);
  const antes = await conectar(tokenPersonal('admin'));
  await pausa(ESPERA_MS);
  antes.c.close();
  const despues = await conectar(tokenPersonal('admin'));
  await pausa(ESPERA_MS);
  assert.deepStrictEqual(despues.recibidas, esperadas(mesas));
});

test('liberar la mesa la saca del índice: el panel que entra después ya no la ve', async (t) => {
  const { s, mesas, conectar } = await escenario(t);
  assert.strictEqual((await liberar(s, mesas.B)).status, 200);
  assert.ok(!(await s.estadoMesas.mesasConEstado()).includes(mesas.B));
  const { recibidas } = await conectar(tokenPersonal('admin'));
  await pausa(ESPERA_MS);
  assert.deepStrictEqual(recibidas.map((p) => p.id_mesa), [mesas.A, mesas.C]);
});

test('Redis caído: el panel conecta igual y no recibe la presencia inicial', async (t) => {
  const falso = crearRedisFalso();
  const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  await redis.conectar();
  const s = await levantar({}, { redis });
  t.after(() => s.cerrar());
  await s.estadoMesas.marcarPago(31, 'Beto');
  falso.caer();
  const { c, recibidas } = await conectarEscuchando(s, tokenPersonal('admin'));
  t.after(() => c.close());
  await pausa(ESPERA_MS);
  assert.strictEqual(c.connected, true);
  assert.deepStrictEqual(recibidas, []);
});

// --- Índice sd:mesas:con-estado: vence a las 24 h y se renueva al anotar ------

function almacenesConReloj() {
  let ms = 1_000_000;
  const reloj = { ahora: () => ms, avanzar: (d) => { ms += d; } };
  const falso = crearRedisFalso({ ahora: reloj.ahora });
  const conexion = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  return {
    reloj,
    memoria: crearEstadoMesasMemoria({ ahora: reloj.ahora }),
    redis: crearEstadoMesasRedis({ cliente: conexion.cliente, ahora: reloj.ahora }),
    conectar: () => conexion.conectar(),
  };
}

for (const tipo of ['memoria', 'redis']) {
  test(`índice (${tipo}): anota pagos y sin celular, vence a las 24 h y se renueva al anotar`, async () => {
    const a = almacenesConReloj();
    if (tipo === 'redis') await a.conectar();
    const e = a[tipo];
    await e.marcarPago(3, 'Beto');
    await e.agregarSinCelular(7, 'abuela', 'Abuela');
    assert.deepStrictEqual(await e.mesasConEstado(), [3, 7]);
    assert.strictEqual(await e.agregarSinCelular(7, 'abuela', 'Abuela'), false, 'repetido: no anota otra vez');

    a.reloj.avanzar(DIA_MS - 1000);
    await e.marcarPago(3, 'Carla'); // renueva la 3; la 7 sigue con su vencimiento
    a.reloj.avanzar(2000);
    assert.deepStrictEqual(await e.mesasConEstado(), [3], 'la 7 venció a las 24 h de su última anotación');

    await e.limpiarMesa(3);
    assert.deepStrictEqual(await e.mesasConEstado(), []);
  });
}

test('índice (redis): la llave entera tiene TTL de 24 h, renovado al anotar', async () => {
  const a = almacenesConReloj();
  await a.conectar();
  await a.redis.marcarPago(3, 'Beto');
  a.reloj.avanzar(DIA_MS - 1000);
  await a.redis.agregarSinCelular(8, 'abuela', 'Abuela');
  a.reloj.avanzar(2000);
  // Si el EXPIRE no se renovara, la llave habría desaparecido con la 8 adentro.
  assert.deepStrictEqual(await a.redis.mesasConEstado(), [8]);
  a.reloj.avanzar(DIA_MS);
  assert.deepStrictEqual(await a.redis.mesasConEstado(), []);
});

// --- Contra un Redis real (CI levanta redis:7). Se omite si no hay REDIS_URL. ---

test('Redis real: el índice y la presencia inicial de una mesa sin sockets', { skip: !REDIS_URL && 'sin REDIS_URL' }, async (t) => {
  const conexion = crearConexionRedis({ url: REDIS_URL, log: silencioso });
  await conexion.conectar();
  const { cliente: c } = conexion;
  const base = 900000 + Math.floor(Math.random() * 90000);

  const e = crearEstadoMesasRedis({ cliente: c });
  await e.agregarSinCelular(base + 2, 'abuela', 'Abuela');
  assert.ok((await e.mesasConEstado()).includes(base + 2));
  const ttl = await c.ttl('sd:mesas:con-estado');
  assert.ok(ttl > TTL_CUENTA_SEG - 60 && ttl <= TTL_CUENTA_SEG, `TTL de la llave: ${ttl}`);
  await e.limpiarMesa(base + 2);
  assert.ok(!(await e.mesasConEstado()).includes(base + 2));

  // Servidor completo con Redis real: el panel ve de una la mesa sin sockets.
  const { mesas, conectar } = await escenario(t, { redis: conexion }, base);
  const { recibidas } = await conectar(tokenPersonal('admin'));
  await pausa(ESPERA_MS);
  assert.deepStrictEqual(deEstas(recibidas, Object.values(mesas)), esperadas(mesas));
});
