// Presencia inicial · mesa:presencia:solicitar: como mucho una cada
// LIMITE_SOLICITUD_PRESENCIA_MS por socket, y con Redis caído el ack es
// ERROR_INTERNO sin cortar la conexión.
const test = require('node:test');
const assert = require('node:assert');
const { levantar, emitir, tokenPersonal } = require('./helpers');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { LIMITE_SOLICITUD_PRESENCIA_MS } = require('../src/sala');
const {
  silencioso, pausa, conectarEscuchando, esperadas, escenarioSolicitar,
} = require('./presencia-inicial-helpers');

test(`solicitar: como mucho una cada ${LIMITE_SOLICITUD_PRESENCIA_MS / 1000} s por socket (RATE_LIMIT sin calcular)`, async (t) => {
  const { s, mesas, conectar } = await escenarioSolicitar(t);
  const original = s.presencia.listarConEstado;
  let calculos = 0;
  s.presencia.listarConEstado = (...a) => { calculos += 1; return original(...a); };
  t.after(() => { s.presencia.listarConEstado = original; });
  const uno = await conectar(tokenPersonal('admin'));
  const otro = await conectar(tokenPersonal('mesero'));

  assert.strictEqual((await emitir(uno.c, 'mesa:presencia:solicitar', {})).ok, true);
  const repetida = await emitir(uno.c, 'mesa:presencia:solicitar', {});
  assert.deepStrictEqual([repetida.ok, repetida.codigo, 'mesas' in repetida], [false, 'RATE_LIMIT', false]);
  assert.strictEqual(calculos, 1, 'la rechazada no calcula nada');
  // El límite es por socket: otro panel puede pedir.
  assert.strictEqual((await emitir(otro.c, 'mesa:presencia:solicitar', {})).ok, true);

  await pausa(LIMITE_SOLICITUD_PRESENCIA_MS + 50);
  const despues = await emitir(uno.c, 'mesa:presencia:solicitar', {});
  assert.deepStrictEqual(despues, { ok: true, mesas: esperadas(mesas) });
});

test('solicitar con Redis caído: ack ERROR_INTERNO y la conexión sigue', async (t) => {
  const falso = crearRedisFalso();
  const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  await redis.conectar();
  const s = await levantar({}, { redis, presencia: { retrasoInicialMs: 60_000 } });
  t.after(() => s.cerrar());
  const { c } = await conectarEscuchando(s, tokenPersonal('admin'));
  t.after(() => c.close());
  falso.caer();
  const ack = await emitir(c, 'mesa:presencia:solicitar', {});
  assert.deepStrictEqual([ack.ok, ack.codigo], [false, 'ERROR_INTERNO']);
  assert.strictEqual(c.connected, true);
});
