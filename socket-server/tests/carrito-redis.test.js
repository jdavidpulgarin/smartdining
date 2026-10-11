const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearAlmacenCarritosRedis, llaveCarrito, llaveIdem } = require('../src/almacen/carritos-redis');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');
const { levantar, emitir, tokenComensal } = require('./helpers');

const silencioso = { info() {}, error() {} };
const linea = (comensal, cantidad = 1, id_linea = randomUUID()) => ({
  accion: 'set', id_linea, comensal, id_plato: 3, cantidad,
});
const evento = (comensal, cantidad = 1) => ({ eventId: randomUUID(), ...linea(comensal, cantidad) });

test('aplicarUnaVez guarda el carrito con TTL y marca el eventId', async () => {
  const falso = crearRedisFalso();
  const carritos = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  const r = await carritos.aplicarUnaVez(5, linea('Ana'), 'comensal:cart:5:e1');
  assert.deepStrictEqual([r.duplicado, r.snapshot.version, r.snapshot.items.length], [false, 1, 1]);
  assert.deepStrictEqual(falso.llaves().sort(), [llaveCarrito(5), llaveIdem('comensal:cart:5:e1')].sort());
  assert.deepStrictEqual(await carritos.snapshot(5), r.snapshot);
  assert.deepStrictEqual(await carritos.snapshot(6), { version: 0, items: [] });
});

test('un eventId repetido no se reaplica y devuelve el snapshot vigente', async () => {
  const falso = crearRedisFalso();
  const carritos = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  const op = linea('Ana', 2);
  await carritos.aplicarUnaVez(5, op, 'k1');
  await carritos.aplicarUnaVez(5, linea('Beto'), 'k2');
  const dup = await carritos.aplicarUnaVez(5, op, 'k1');
  assert.strictEqual(dup.duplicado, true);
  assert.deepStrictEqual([dup.snapshot.version, dup.snapshot.items.length], [2, 2]);
});

test('conflicto de WATCH: se reintenta y no se pierde la escritura del otro proceso', async () => {
  const falso = crearRedisFalso();
  const carritos = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  const otro = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  // Entre el WATCH y el EXEC de Ana, "otra instancia" agrega la línea de Beto.
  falso.interferir(() => otro.aplicarUnaVez(5, linea('Beto'), 'kb'));
  const r = await carritos.aplicarUnaVez(5, linea('Ana'), 'ka');
  assert.strictEqual(r.duplicado, false);
  assert.deepStrictEqual(r.snapshot.items.map((i) => i.comensal).sort(), ['Ana', 'Beto']);
  assert.strictEqual(r.snapshot.version, 2);
});

test('el mismo evento enviado dos veces en paralelo se aplica una sola vez', async () => {
  const falso = crearRedisFalso();
  const carritos = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  const op = linea('Ana');
  // El segundo envío se cuela entre el WATCH y el EXEC del primero.
  let segundo;
  falso.interferir(() => { segundo = carritos.aplicarUnaVez(5, op, 'mismo'); return segundo; });
  const primero = await carritos.aplicarUnaVez(5, op, 'mismo');
  const r2 = await segundo;
  assert.deepStrictEqual([primero.duplicado, r2.duplicado], [true, false], 'el que ganó aplicó; el otro vio la marca');
  assert.strictEqual((await carritos.snapshot(5)).version, 1);
});

test('un conflicto que no cesa termina en error (ERROR_INTERNO para el cliente)', async () => {
  const falso = crearRedisFalso();
  const carritos = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  const original = falso.cliente.executeIsolated;
  falso.cliente.executeIsolated = async () => { throw new falso.WatchError(); };
  await assert.rejects(carritos.aplicarUnaVez(5, linea('Ana'), 'k'), /Conflicto persistente/);
  falso.cliente.executeIsolated = original;
});

test('el tope de ítems y los errores de lógica son los mismos que en memoria', async () => {
  const falso = crearRedisFalso();
  const carritos = crearAlmacenCarritosRedis({ cliente: falso.cliente });
  for (let i = 0; i < 200; i += 1) await carritos.aplicarUnaVez(5, linea('Ana'), null);
  const r = await carritos.aplicarUnaVez(5, linea('Ana'), 'k-tope');
  assert.match(r.error, /máximo/);
  assert.strictEqual(falso.llaves().includes(llaveIdem('k-tope')), false, 'un rechazo no consume el eventId');
});

async function levantarConRedis(t, falso) {
  const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  const s = await levantar({}, { redis });
  t.after(() => s.cerrar());
  return s;
}

test('reinicio: el carrito sigue ahí y join:table devuelve el mismo snapshot', async (t) => {
  const falso = crearRedisFalso();
  const s1 = await levantarConRedis(t, falso);
  const ana = await s1.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  const ack = await emitir(ana, 'cart:update', evento('Ana', 2));
  await s1.cerrar();

  const s2 = await levantarConRedis(t, falso); // "otro proceso" con el mismo Redis
  const beto = await s2.conectar(tokenComensal(5));
  const join = await emitir(beto, 'join:table', {});
  assert.deepStrictEqual(join.carrito, ack.carrito);
});

test('con Redis caído cart:update responde ERROR_INTERNO y se recupera al volver', async (t) => {
  const falso = crearRedisFalso();
  const s = await levantarConRedis(t, falso);
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  const ev = evento('Ana');
  falso.caer();
  const caido = await emitir(ana, 'cart:update', ev);
  assert.strictEqual(caido.codigo, 'ERROR_INTERNO');
  falso.levantar();
  // El cliente reintenta con el MISMO eventId: como no se aplicó, ahora sí.
  const ok = await emitir(ana, 'cart:update', ev);
  assert.deepStrictEqual([ok.ok, ok.duplicado], [true, false]);
});

// --- Contra un Redis real (CI levanta redis:7). Se omite si no hay REDIS_URL. ---
const REDIS_URL = process.env.REDIS_URL;

test('Redis real: carrito atómico, idempotente y persistente entre instancias', { skip: !REDIS_URL && 'sin REDIS_URL' }, async (t) => {
  const conexion = crearConexionRedis({ url: REDIS_URL, log: silencioso });
  await conexion.conectar();
  const mesa = 900000 + Math.floor(Math.random() * 99999);
  // Limpiar y LUEGO cerrar, en un solo hook (node:test corre los t.after en
  // orden de registro).
  t.after(async () => {
    await conexion.cliente.del(llaveCarrito(mesa));
    await conexion.cerrar();
  });
  const a = crearAlmacenCarritosRedis({ cliente: conexion.cliente });
  const b = crearAlmacenCarritosRedis({ cliente: conexion.cliente });

  // 20 escrituras concurrentes desde dos "instancias": ninguna se pierde.
  await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b)
    .aplicarUnaVez(mesa, linea(`C${i}`), `real:${mesa}:${i}`)));
  const snap = await a.snapshot(mesa);
  assert.deepStrictEqual([snap.items.length, snap.version], [20, 20]);

  // Reenvíos concurrentes del mismo evento: se aplica una vez.
  const op = linea('Repetido');
  const rs = await Promise.all([1, 2, 3].map(() => b.aplicarUnaVez(mesa, op, `real:${mesa}:dup`)));
  assert.strictEqual(rs.filter((r) => !r.duplicado).length, 1);
  assert.strictEqual((await a.snapshot(mesa)).version, 21);
  const ttl = await conexion.cliente.ttl(llaveCarrito(mesa));
  assert.ok(ttl > 0, 'la llave del carrito tiene TTL');
});
