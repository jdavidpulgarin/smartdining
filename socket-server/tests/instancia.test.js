const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearInstancia } = require('../src/instancia');
const { crearRedisFalso } = require('./redis-falso');
const { levantar, CLAVE_INTERNA } = require('./helpers');

// T5: X-Instancia-Id en toda respuesta de /internal/* y GET /internal/salud
// (EVENTS.md §6.5). El backend vuelve a emitir la carta cuando el id cambia.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const silencioso = { info() {}, error() {} };

const pedir = (s, ruta, { metodo = 'POST', clave = CLAVE_INTERNA, cuerpo } = {}) => fetch(`${s.url}${ruta}`, {
  method: metodo,
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  ...(cuerpo !== undefined ? { body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) } : {}),
});

async function servidor(t, env = {}, deps = {}) {
  const s = await levantar(env, deps);
  t.after(() => s.cerrar());
  return s;
}

test('crearInstancia: un UUID v4 nuevo cada vez y arrancadoEn en ISO', () => {
  const a = crearInstancia();
  const b = crearInstancia();
  assert.match(a.instanciaId, UUID);
  assert.notStrictEqual(a.instanciaId, b.instanciaId);
  assert.strictEqual(new Date(a.arrancadoEn).toISOString(), a.arrancadoEn);
  assert.ok(Object.isFrozen(a), 'nadie la cambia en caliente');
});

test('X-Instancia-Id en las respuestas 200, 400, 401, 404 y 503 de /internal/*, siempre el mismo', async (t) => {
  const s = await servidor(t);
  const id = s.ctx.instancia.instanciaId;
  const casos = [
    ['200', await pedir(s, '/internal/plato-disponibilidad', { cuerpo: { id_plato: 7, disponible: true, eventId: randomUUID() } }), 200],
    ['400 por campo', await pedir(s, '/internal/plato-disponibilidad', { cuerpo: { id_plato: 'x', disponible: true } }), 400],
    ['400 JSON malformado', await pedir(s, '/internal/inventario-alerta', { cuerpo: '{"roto":' }), 400],
    ['401 sin clave', await pedir(s, '/internal/plato-disponibilidad', { clave: null, cuerpo: { id_plato: 7, disponible: true } }), 401],
    ['401 clave errónea', await pedir(s, '/internal/salud', { metodo: 'GET', clave: 'otra' }), 401],
    ['404 ruta interna que no existe', await pedir(s, '/internal/no-existe', { cuerpo: {} }), 404],
    ['200 salud', await pedir(s, '/internal/salud', { metodo: 'GET' }), 200],
  ];
  for (const [nombre, r, status] of casos) {
    assert.strictEqual(r.status, status, nombre);
    assert.strictEqual(r.headers.get('x-instancia-id'), id, nombre);
  }
  // Cerrando: el 503 de reinicio también la lleva (el backend reintenta y ve el id nuevo después).
  s.ctx.cerrando = true;
  const r = await pedir(s, '/internal/plato-disponibilidad', { cuerpo: { id_plato: 7, disponible: true } });
  assert.deepStrictEqual([r.status, r.headers.get('x-instancia-id')], [503, id]);
  s.ctx.cerrando = false;
});

test('las rutas que NO son /internal/* no anuncian la instancia', async (t) => {
  const s = await servidor(t);
  for (const ruta of ['/health', '/push/clave-publica', '/no-existe', '/internalx/salud']) {
    const r = await fetch(`${s.url}${ruta}`);
    assert.strictEqual(r.headers.get('x-instancia-id'), null, ruta);
  }
});

test('GET /internal/salud: 200 { instanciaId, arrancadoEn, redis } y nada más; sin clave o con otra, 401', async (t) => {
  const s = await servidor(t);
  const r = await pedir(s, '/internal/salud', { metodo: 'GET' });
  const cuerpo = await r.json();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(Object.keys(cuerpo).sort(), ['arrancadoEn', 'instanciaId', 'redis']);
  assert.deepStrictEqual(cuerpo, { instanciaId: s.ctx.instancia.instanciaId, arrancadoEn: s.ctx.instancia.arrancadoEn, redis: 'ok' });
  assert.match(cuerpo.instanciaId, UUID);
  const texto = JSON.stringify(cuerpo);
  assert.ok(!texto.includes(CLAVE_INTERNA), 'ni la clave interna');

  for (const clave of [null, 'otra', `${CLAVE_INTERNA}x`]) {
    const sin = await pedir(s, '/internal/salud', { metodo: 'GET', clave });
    assert.strictEqual(sin.status, 401);
    const error = await sin.json();
    assert.strictEqual(error.codigo, 'NO_AUTORIZADO');
    assert.ok(!('instanciaId' in error), 'sin clave no se da el cuerpo de salud');
  }
});

test('GET /internal/salud sin INTERNAL_API_KEY configurada: 503 NO_CONFIGURADO', async (t) => {
  const s = await servidor(t);
  s.config.internalApiKey = undefined;
  const r = await pedir(s, '/internal/salud', { metodo: 'GET' });
  assert.deepStrictEqual([r.status, (await r.json()).codigo], [503, 'NO_CONFIGURADO']);
});

test('GET /internal/salud con Redis caído: 200 y redis "caido" (no es un 503 como /health)', async (t) => {
  const falso = crearRedisFalso();
  const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  await redis.conectar();
  const s = await servidor(t, {}, { redis });
  assert.strictEqual((await (await pedir(s, '/internal/salud', { metodo: 'GET' })).json()).redis, 'ok');
  falso.caer();
  const r = await pedir(s, '/internal/salud', { metodo: 'GET' });
  assert.deepStrictEqual([r.status, (await r.json()).redis], [200, 'caido']);
  assert.strictEqual((await fetch(`${s.url}/health`)).status, 503, '/health sí se degrada');
  falso.levantar();
});

test('GET /internal/salud no gasta ni se frena por ningún límite: 50 seguidas, todas 200', async (t) => {
  const s = await servidor(t);
  const respuestas = await Promise.all(Array.from({ length: 50 }, () => pedir(s, '/internal/salud', { metodo: 'GET' })));
  assert.deepStrictEqual([...new Set(respuestas.map((r) => r.status))], [200]);
});

test('dos arranques (dos instancias de la app) tienen instanciaId distinto; cada una mantiene el suyo', async (t) => {
  const a = await servidor(t);
  const b = await servidor(t);
  const idA = (await (await pedir(a, '/internal/salud', { metodo: 'GET' })).json()).instanciaId;
  const idB = (await (await pedir(b, '/internal/salud', { metodo: 'GET' })).json()).instanciaId;
  assert.match(idA, UUID);
  assert.match(idB, UUID);
  assert.notStrictEqual(idA, idB);
  // Dentro de la misma instancia no cambia entre peticiones.
  assert.strictEqual((await pedir(a, '/internal/salud', { metodo: 'GET' })).headers.get('x-instancia-id'), idA);
});
