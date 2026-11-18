// REDIS APAGADO NO PUEDE COLGAR UNA PETICION.
//
// El fallo original: con la estrategia de reconexion por omision de node-redis,
// connect() reintenta para siempre y nunca rechaza, asi que `await
// connectRedis()` no volvia y los try/catch de los llamadores no llegaban a
// ejecutarse. Medido antes del arreglo: connectRedis(), estaActivo() y
// cache.leerJson() seguian pendientes a los 5 s.
//
// Esta REDIS_URL apunta a un puerto CERRADO y se fija ANTES de requerir el
// modulo, porque el cliente se crea al cargarlo. node --test da un proceso por
// archivo, asi que esto no afecta a las demas pruebas. Ninguna prueba de aqui
// necesita un Redis de verdad.
const PUERTO_CERRADO = 6390;
process.env.REDIS_URL = `redis://127.0.0.1:${PUERTO_CERRADO}`;

const test = require('node:test');
const assert = require('node:assert');
const redis = require('../src/config/redis');
const { instalarFakeDb } = require('./helpers/fake-db');
const usuarioActivo = require('../src/services/usuario-activo');
const cache = require('../src/services/cache');

// Tope generoso: lo que se vigila es que VUELVA, no que sea rapidisimo. El
// fallo original no volvia nunca.
const TOPE_MS = 3000;
// Lo que debe tardar una llamada que ya esta en enfriamiento: sin tocar la red.
const TOPE_ENFRIADO_MS = 150;

/** Cliente de mentira con el minimo que usa connectRedis. */
function clienteFalso({ conecta = true, abierto = false } = {}) {
  const cliente = {
    isOpen: abierto,
    isReady: abierto,
    intentos: 0,
    async connect() {
      cliente.intentos += 1;
      if (!conecta) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      cliente.isOpen = true;
      cliente.isReady = true;
      return cliente;
    },
  };
  return cliente;
}

/** Mide cuanto tarda una promesa en resolver o rechazar, con tope. */
async function medir(promesa) {
  const t0 = Date.now();
  let estado = 'resuelve';
  let valor;
  let error;
  const vencida = Symbol('vencida');
  const resultado = await Promise.race([
    promesa.then((v) => { valor = v; return 'resuelve'; }, (e) => { error = e; return 'rechaza'; }),
    new Promise((r) => setTimeout(() => r(vencida), TOPE_MS)),
  ]);
  if (resultado === vencida) {
    // Es el fallo original: la promesa sigue pendiente. Se avisa aqui para que
    // el mensaje diga QUE paso, en vez de un timeout del runner.
    assert.fail(`la promesa no volvio en ${TOPE_MS} ms (es el fallo que este arreglo corrige)`);
  }
  estado = resultado;
  return { estado, valor, error, ms: Date.now() - t0 };
}

test.beforeEach(() => {
  redis.reiniciarEstado();
  delete process.env.REDIS_ENFRIAMIENTO_MS;
  delete process.env.REDIS_CONNECT_TIMEOUT_MS;
});

test.after(() => {
  redis.reiniciarEstado();
});

// ---------------------------------------------------------------------------
// connectRedis rechaza rapido
// ---------------------------------------------------------------------------

test('redis: con el puerto cerrado, connectRedis RECHAZA y no se queda colgado', async () => {
  const r = await medir(redis.connectRedis());

  assert.strictEqual(r.estado, 'rechaza', 'antes del arreglo no volvia nunca');
  assert.ok(r.ms < TOPE_MS, `tardo ${r.ms} ms`);
  assert.ok(r.error instanceof Error);
});

test('redis: el error tiene nombre propio, para que un catch pueda distinguirlo', async () => {
  const r = await medir(redis.connectRedis());

  assert.strictEqual(r.error.name, 'RedisNoDisponible');
  assert.ok(r.error instanceof redis.RedisNoDisponible);
});

test('redis: el timeout de conexion es corto y configurable', () => {
  assert.strictEqual(redis.timeoutMs({}), redis.TIMEOUT_POR_DEFECTO_MS);
  assert.ok(redis.TIMEOUT_POR_DEFECTO_MS >= 1000 && redis.TIMEOUT_POR_DEFECTO_MS <= 2000);
  assert.strictEqual(redis.timeoutMs({ REDIS_CONNECT_TIMEOUT_MS: '800' }), 800);
  // Un valor sin sentido no deja el backend sin timeout.
  for (const malo of ['0', '-5', 'abc', '', '1.5']) {
    assert.strictEqual(
      redis.timeoutMs({ REDIS_CONNECT_TIMEOUT_MS: malo }),
      redis.TIMEOUT_POR_DEFECTO_MS,
      `"${malo}" deberia ignorarse`
    );
  }
});

// ---------------------------------------------------------------------------
// Enfriamiento: con Redis apagado, cada peticion no paga el intento otra vez
// ---------------------------------------------------------------------------

test('redis: tras un fallo, la siguiente llamada rechaza al instante', async () => {
  const primera = await medir(redis.connectRedis());
  assert.strictEqual(primera.estado, 'rechaza');

  const segunda = await medir(redis.connectRedis());

  assert.strictEqual(segunda.estado, 'rechaza');
  assert.ok(
    segunda.ms < TOPE_ENFRIADO_MS,
    `la segunda tardo ${segunda.ms} ms: deberia rechazar sin tocar la red`
  );
  assert.match(segunda.error.message, /enfriamiento/i);
});

test('redis: el enfriamiento no toca la red (el cliente no recibe otro connect)', async () => {
  const cliente = clienteFalso({ conecta: false });

  await assert.rejects(() => redis.connectRedis({ cliente }));
  assert.strictEqual(cliente.intentos, 1);

  await assert.rejects(() => redis.connectRedis({ cliente }));
  assert.strictEqual(cliente.intentos, 1, 'en enfriamiento no se vuelve a intentar');
});

test('redis: el enfriamiento caduca y entonces SI se reintenta', async () => {
  process.env.REDIS_ENFRIAMIENTO_MS = '60';
  const cliente = clienteFalso({ conecta: false });

  await assert.rejects(() => redis.connectRedis({ cliente }));
  assert.strictEqual(cliente.intentos, 1);

  await new Promise((r) => setTimeout(r, 90));

  await assert.rejects(() => redis.connectRedis({ cliente }));
  assert.strictEqual(cliente.intentos, 2, 'pasado el enfriamiento se vuelve a intentar');
});

test('redis: el enfriamiento es corto y configurable', () => {
  assert.strictEqual(redis.enfriamientoMs({}), redis.ENFRIAMIENTO_POR_DEFECTO_MS);
  assert.ok(
    redis.ENFRIAMIENTO_POR_DEFECTO_MS >= 10000 && redis.ENFRIAMIENTO_POR_DEFECTO_MS <= 30000,
    'entre 10 y 30 s: corto, para que la recuperacion no tarde'
  );
  assert.strictEqual(redis.enfriamientoMs({ REDIS_ENFRIAMIENTO_MS: '5000' }), 5000);
  assert.strictEqual(
    redis.enfriamientoMs({ REDIS_ENFRIAMIENTO_MS: 'nada' }),
    redis.ENFRIAMIENTO_POR_DEFECTO_MS
  );
});

test('redis: varias llamadas a la vez comparten un solo intento', async () => {
  const cliente = clienteFalso({ conecta: false });

  const resultados = await Promise.allSettled([
    redis.connectRedis({ cliente }),
    redis.connectRedis({ cliente }),
    redis.connectRedis({ cliente }),
  ]);

  assert.deepStrictEqual(resultados.map((r) => r.status), ['rejected', 'rejected', 'rejected']);
  assert.strictEqual(cliente.intentos, 1, 'una conexion, no una por peticion');
});

// ---------------------------------------------------------------------------
// Recuperacion cuando Redis vuelve, sin reiniciar el backend
// ---------------------------------------------------------------------------

test('redis: cuando Redis vuelve, la cache se reactiva sola', async () => {
  process.env.REDIS_ENFRIAMIENTO_MS = '60';
  const caido = clienteFalso({ conecta: false });

  await assert.rejects(() => redis.connectRedis({ cliente: caido }), /Redis/);

  // "Vuelve" Redis: el mismo hueco, un cliente que ahora si conecta.
  await new Promise((r) => setTimeout(r, 90));
  const vivo = clienteFalso({ conecta: true });
  const recuperado = await redis.connectRedis({ cliente: vivo });

  assert.strictEqual(recuperado, vivo);
  assert.strictEqual(vivo.isOpen, true);
  assert.strictEqual(redis.estado.enfriadoHasta, 0, 'el enfriamiento se levanta al conectar');
});

test('redis: un cliente ya conectado se devuelve sin volver a conectar', async () => {
  const cliente = clienteFalso({ abierto: true });

  const devuelto = await redis.connectRedis({ cliente });

  assert.strictEqual(devuelto, cliente);
  assert.strictEqual(cliente.intentos, 0, 'con Redis sano no se reconecta en cada peticion');
});

// ---------------------------------------------------------------------------
// Lo que de verdad reporto Jarrison: la peticion del personal
// ---------------------------------------------------------------------------

test('usuario-activo: con Redis apagado, estaActivo responde desde la BASE y acotado', async () => {
  // La caché se salta en pruebas a propósito, así que se le pasa un entorno de
  // producción para que SÍ intente Redis: es el camino que se colgaba.
  // fake-db contesta esa consulta por su cuenta (usuario activo por omision).
  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const r = await medir(usuarioActivo.estaActivo(7, { env: { NODE_ENV: 'production' } }));

    assert.strictEqual(r.estado, 'resuelve', 'antes del arreglo esto no volvia');
    assert.strictEqual(r.valor, true, 'la respuesta sale de PostgreSQL');
    assert.ok(r.ms < TOPE_MS, `tardo ${r.ms} ms`);
    assert.ok(db.buscar('FROM usuarios WHERE id_usuario'), 'se consulto la base');
  } finally {
    db.restaurar();
  }
});

test('usuario-activo: la BASE sigue decidiendo (falla cerrada) aunque Redis este apagado', async () => {
  // Redis caído no debe convertir un "no existe" en un "pasa".
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioSinRegistro: true });
  try {
    const r = await medir(usuarioActivo.estaActivo(7, { env: { NODE_ENV: 'production' } }));

    assert.strictEqual(r.estado, 'resuelve');
    assert.strictEqual(r.valor, false, 'un usuario que no existe no entra');
  } finally {
    db.restaurar();
  }
});

test('usuario-activo: si la BASE falla, el error sube (falla cerrada)', async () => {
  const db = instalarFakeDb(() => ({ rows: [] }), { usuarioConsultaFalla: true });
  try {
    const r = await medir(usuarioActivo.estaActivo(7, { env: { NODE_ENV: 'production' } }));

    assert.strictEqual(r.estado, 'rechaza', 'Redis es un extra; la base no');
    assert.match(r.error.message, /la base no responde/i);
  } finally {
    db.restaurar();
  }
});

test('usuario-activo: olvidar() con Redis apagado devuelve false y no lanza', async () => {
  const r = await medir(usuarioActivo.olvidar(7));

  assert.strictEqual(r.estado, 'resuelve');
  assert.strictEqual(r.valor, false);
});

// ---------------------------------------------------------------------------
// La cache del menu (ruta publica)
// ---------------------------------------------------------------------------

test('cache: con Redis apagado, leerJson devuelve null acotado', async () => {
  const r = await medir(cache.leerJson('cache:menu'));

  assert.strictEqual(r.estado, 'resuelve', 'antes del arreglo esto no volvia');
  assert.strictEqual(r.valor, null);
  assert.ok(r.ms < TOPE_MS, `tardo ${r.ms} ms`);
});

test('cache: con Redis apagado, guardarJson y borrar devuelven false acotado', async () => {
  const guardado = await medir(cache.guardarJson('cache:menu', { a: 1 }, 60));
  const borrado = await medir(cache.borrar('cache:menu'));

  assert.strictEqual(guardado.valor, false);
  assert.strictEqual(borrado.valor, false);
  assert.ok(guardado.ms < TOPE_MS && borrado.ms < TOPE_MS);
});

test('cache: tres llamadas seguidas con Redis apagado no acumulan esperas', async () => {
  // Es el efecto del enfriamiento: lo que se notaba como "el panel va lentisimo".
  const t0 = Date.now();
  await cache.leerJson('cache:menu');
  await cache.leerJson('cache:menu');
  await cache.leerJson('cache:menu');
  const total = Date.now() - t0;

  assert.ok(total < TOPE_MS, `tres llamadas tardaron ${total} ms`);
});

// ---------------------------------------------------------------------------
// De extremo a extremo por la ruta protegida, sin arrancar ningun servidor
//
// supertest llama a la app de Express en el proceso, sin abrir puerto. Es el
// escenario que reporto Jarrison: una peticion autenticada del personal con
// Redis apagado. Hay que apagar a mano las dos señales de "estoy en pruebas"
// (NODE_TEST_CONTEXT lo pone el runner) para que la cache de usuario-activo se
// active y se recorra el camino que se colgaba.
// ---------------------------------------------------------------------------

const request = require('supertest');
const { tokenStaff } = require('./helpers/fake-db');
const app = require('../server');

test('ruta protegida: con Redis apagado responde igual y en tiempo acotado', async () => {
  const previo = { env: process.env.NODE_ENV, ctx: process.env.NODE_TEST_CONTEXT };
  process.env.NODE_ENV = 'production';
  delete process.env.NODE_TEST_CONTEXT;
  redis.reiniciarEstado();

  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const t0 = Date.now();
    const res = await request(app)
      .get('/api/pedidos/activos')
      .set('Authorization', `Bearer ${tokenStaff(1, 'admin')}`);
    const ms = Date.now() - t0;

    assert.strictEqual(res.status, 200, 'antes del arreglo la peticion no volvia');
    assert.ok(ms < TOPE_MS, `la peticion tardo ${ms} ms`);
    // Y la comprobacion de H-09 se hizo contra la base, no contra la cache.
    assert.ok(db.buscar('FROM usuarios WHERE id_usuario'), 'se pregunto a PostgreSQL');
  } finally {
    db.restaurar();
    if (previo.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previo.env;
    if (previo.ctx !== undefined) process.env.NODE_TEST_CONTEXT = previo.ctx;
    redis.reiniciarEstado();
  }
});

test('ruta protegida: dos peticiones seguidas con Redis apagado no acumulan esperas', async () => {
  const previo = { env: process.env.NODE_ENV, ctx: process.env.NODE_TEST_CONTEXT };
  process.env.NODE_ENV = 'production';
  delete process.env.NODE_TEST_CONTEXT;
  redis.reiniciarEstado();

  const db = instalarFakeDb(() => ({ rows: [] }));
  try {
    const token = `Bearer ${tokenStaff(1, 'admin')}`;
    const t0 = Date.now();
    await request(app).get('/api/pedidos/activos').set('Authorization', token);
    await request(app).get('/api/pedidos/activos').set('Authorization', token);
    const total = Date.now() - t0;

    assert.ok(total < TOPE_MS, `dos peticiones tardaron ${total} ms`);
  } finally {
    db.restaurar();
    if (previo.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previo.env;
    if (previo.ctx !== undefined) process.env.NODE_TEST_CONTEXT = previo.ctx;
    redis.reiniciarEstado();
  }
});
