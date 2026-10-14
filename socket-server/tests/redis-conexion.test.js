const test = require('node:test');
const assert = require('node:assert');
const { cargarConfig } = require('../src/config');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { ENV_BASE, ORIGEN, levantar } = require('./helpers');

const silencioso = { info() {}, error() {} };

test('sin REDIS_URL fuera de producción el estado queda en memoria', () => {
  const config = cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE });
  assert.strictEqual(config.redisUrl, null);
});

test('con NODE_ENV=production y sin REDIS_URL no se arranca', () => {
  assert.throws(
    () => cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE, NODE_ENV: 'production' }),
    /REDIS_URL es obligatoria/,
  );
  const ok = cargarConfig({ CORS_ORIGINS: ORIGEN, ...ENV_BASE, NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379' });
  assert.strictEqual(ok.redisUrl, 'redis://redis:6379');
});

test('la conexión pide fallar rápido sin cola offline y reconectar con tope', () => {
  let opciones = null;
  const falso = crearRedisFalso();
  crearConexionRedis({ url: 'redis://x:6379', crearCliente: (o) => { opciones = o; return falso.cliente; }, log: silencioso });
  assert.strictEqual(opciones.disableOfflineQueue, true);
  const espera = opciones.socket.reconnectStrategy;
  assert.ok(espera(1) < espera(3));
  assert.strictEqual(espera(1000), 5000);
});

test('el estado refleja caídas y recuperaciones de Redis', async () => {
  const falso = crearRedisFalso();
  const r = crearConexionRedis({ url: 'redis://x:6379', crearCliente: falso.crearCliente, log: silencioso });
  await r.conectar();
  assert.deepStrictEqual([r.estado(), r.disponible()], ['conectado', true]);
  falso.caer();
  assert.strictEqual(r.disponible(), false);
  assert.notStrictEqual(r.estado(), 'conectado');
  falso.levantar();
  assert.strictEqual(r.estado(), 'conectado');
});

test('/health: memoria sin Redis; ok con Redis; degradado (503) si Redis cae', async (t) => {
  const sinRedis = await levantar();
  t.after(() => sinRedis.cerrar());
  assert.deepStrictEqual(await (await fetch(`${sinRedis.url}/health`)).json(), { estado: 'ok', redis: 'memoria' });

  const falso = crearRedisFalso();
  const redis = crearConexionRedis({ url: 'redis://x:6379', crearCliente: falso.crearCliente, log: silencioso });
  const s = await levantar({}, { redis });
  t.after(() => s.cerrar());
  await redis.conectar();
  const ok = await fetch(`${s.url}/health`);
  assert.deepStrictEqual([ok.status, await ok.json()], [200, { estado: 'ok', redis: 'conectado' }]);

  falso.caer();
  const caido = await fetch(`${s.url}/health`);
  assert.strictEqual(caido.status, 503);
  assert.strictEqual((await caido.json()).estado, 'degradado');

  falso.levantar();
  assert.strictEqual((await fetch(`${s.url}/health`)).status, 200);
});
