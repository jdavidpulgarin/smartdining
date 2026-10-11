const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { crearRegistroIdempotenciaRedis } = require('../src/almacen/idempotencia-redis');
const { crearRevocacionesRedis, TTL_REVOCACION_SEG } = require('../src/almacen/revocaciones-redis');
const { crearAlmacenSuscripcionesRedis } = require('../src/almacen/suscripciones-redis');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRegistroIdempotencia } = require('../src/idempotencia');
const { crearRedisFalso } = require('./redis-falso');
const {
  levantar, emitir, tokenComensal, tokenPersonal, firmar, CLAVE_INTERNA,
} = require('./helpers');

const silencioso = { info() {}, error() {} };
const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'BNabc', auth: 'k8x' } });

test('idempotencia: reservar es atómico y respeta el TTL', async () => {
  const reloj = { t: 1_000_000 };
  const falso = crearRedisFalso({ ahora: () => reloj.t });
  const registro = crearRegistroIdempotenciaRedis({ cliente: falso.cliente, ttlMs: 10_000 });
  assert.strictEqual(await registro.reservar('order:status:e1'), true);
  assert.strictEqual(await registro.reservar('order:status:e1'), false);
  assert.strictEqual(await registro.obtener('order:status:e1'), true);
  assert.deepStrictEqual(falso.llaves(), ['sd:idem:order:status:e1']);
  reloj.t += 10_001;
  assert.strictEqual(await registro.obtener('order:status:e1'), undefined);
  assert.strictEqual(await registro.reservar('order:status:e1'), true, 'vencido, se puede volver a procesar');
});

test('idempotencia en memoria también ofrece reservar', () => {
  const registro = crearRegistroIdempotencia();
  assert.strictEqual(registro.reservar('k'), true);
  assert.strictEqual(registro.reservar('k'), false);
});

test('revocaciones: se guardan por mesa con TTL', async () => {
  const falso = crearRedisFalso();
  const rev = crearRevocacionesRedis({ cliente: falso.cliente });
  assert.strictEqual(await rev.obtener(5), null);
  await rev.fijar(5, 123456);
  assert.strictEqual(await rev.obtener(5), 123456);
  assert.deepStrictEqual(falso.llaves(), ['sd:qr:revocado:5']);
  assert.ok(TTL_REVOCACION_SEG > 24 * 60 * 60, 'dura más que el QR más largo');
});

test('suscripciones: hash por mesa, sin duplicar endpoint y con tope', async () => {
  const falso = crearRedisFalso();
  const subs = crearAlmacenSuscripcionesRedis({ cliente: falso.cliente, maxPorMesa: 2 });
  assert.strictEqual(await subs.agregar(5, sub(1)), true);
  assert.strictEqual(await subs.agregar(5, sub(1)), true, 'mismo endpoint reemplaza');
  assert.strictEqual(await subs.agregar(5, sub(2)), true);
  assert.strictEqual(await subs.agregar(5, sub(3)), false, 'tope por mesa');
  assert.strictEqual(await subs.agregar(5, sub(2)), true, 'editar uno existente no choca con el tope');
  assert.strictEqual((await subs.listar(5)).length, 2);
  assert.deepStrictEqual(await subs.listar(6), []);
  assert.strictEqual(await subs.quitar(5, sub(1).endpoint), true);
  assert.strictEqual(await subs.quitar(5, sub(1).endpoint), false);
  await subs.limpiarMesa(5);
  assert.deepStrictEqual(await subs.listar(5), []);
});

test('suscripciones: dos altas simultáneas no superan el tope', async () => {
  const falso = crearRedisFalso();
  const subs = crearAlmacenSuscripcionesRedis({ cliente: falso.cliente, maxPorMesa: 1 });
  let otra;
  falso.interferir(() => { otra = subs.agregar(5, sub('b')); return otra; });
  const a = await subs.agregar(5, sub('a'));
  const b = await otra;
  assert.deepStrictEqual([a, b].sort(), [false, true]);
  assert.strictEqual((await subs.listar(5)).length, 1);
});

async function levantarConRedis(t, falso) {
  const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  const s = await levantar({}, { redis });
  t.after(() => s.cerrar());
  return s;
}

test('reinicio: un QR revocado sigue revocado y el grupo anterior no vuelve a entrar', async (t) => {
  const falso = crearRedisFalso();
  const s1 = await levantarConRedis(t, falso);
  const viejo = firmar({ id_mesa: 5, rol: 'comensal', iat: Math.floor(Date.now() / 1000) - 60 });
  const gen = await fetch(`${s1.url}/qr/generar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenPersonal('mesero')}` },
    body: JSON.stringify({ id_mesa: 5 }),
  });
  const { token } = await gen.json();
  await new Promise((r) => setTimeout(r, 5));
  await fetch(`${s1.url}/internal/mesa-liberada`, {
    method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({ id_mesa: 5 }),
  });
  await s1.cerrar();

  const s2 = await levantarConRedis(t, falso);
  const v = await (await fetch(`${s2.url}/qr/validar`, { method: 'POST', body: JSON.stringify({ token }) })).json();
  assert.strictEqual(v.motivo, 'revocado');
  await assert.rejects(s2.conectar(viejo), { message: 'TOKEN_INVALIDO' });
});

test('reinicio: un eventId ya procesado sigue siendo duplicado', async (t) => {
  const falso = crearRedisFalso();
  const s1 = await levantarConRedis(t, falso);
  const cambio = { eventId: randomUUID(), id_pedido: 1, id_mesa: 5, estado: 'listo' };
  const enviar = (s) => fetch(`${s.url}/internal/order-status`, {
    method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify(cambio),
  }).then((r) => r.json());
  assert.strictEqual((await enviar(s1)).duplicado, false);
  await s1.cerrar();
  const s2 = await levantarConRedis(t, falso);
  assert.strictEqual((await enviar(s2)).duplicado, true);
});

test('con Redis caído: la conexión de comensal se rechaza y los eventos dan ERROR_INTERNO', async (t) => {
  const falso = crearRedisFalso();
  const s = await levantarConRedis(t, falso);
  const ana = await s.conectar(tokenComensal(5));
  falso.caer();
  assert.strictEqual((await emitir(ana, 'join:table', {})).codigo, 'ERROR_INTERNO');
  await assert.rejects(s.conectar(tokenComensal(5)), { message: 'ERROR_INTERNO' });
  const r = await fetch(`${s.url}/internal/order-status`, {
    method: 'POST',
    headers: { 'x-internal-key': CLAVE_INTERNA },
    body: JSON.stringify({ eventId: randomUUID(), id_pedido: 1, id_mesa: 5, estado: 'listo' }),
  });
  assert.strictEqual(r.status, 500);
  assert.strictEqual((await r.json()).codigo, 'ERROR_INTERNO');
});

// --- Contra un Redis real (CI levanta redis:7). Se omite si no hay REDIS_URL. ---
const REDIS_URL = process.env.REDIS_URL;

test('Redis real: idempotencia, revocaciones y suscripciones', { skip: !REDIS_URL && 'sin REDIS_URL' }, async (t) => {
  const conexion = crearConexionRedis({ url: REDIS_URL, log: silencioso });
  await conexion.conectar();
  t.after(() => conexion.cerrar());
  const { cliente } = conexion;
  const mesa = 900000 + Math.floor(Math.random() * 99999);
  const clave = `prueba:${randomUUID()}`;
  t.after(() => cliente.del([`sd:idem:${clave}`, `sd:qr:revocado:${mesa}`, `sd:push:${mesa}`]));

  const registro = crearRegistroIdempotenciaRedis({ cliente });
  const reservas = await Promise.all([1, 2, 3, 4].map(() => registro.reservar(clave)));
  assert.strictEqual(reservas.filter(Boolean).length, 1, 'solo una reserva gana');

  const rev = crearRevocacionesRedis({ cliente });
  await rev.fijar(mesa, 42);
  assert.strictEqual(await rev.obtener(mesa), 42);

  const subs = crearAlmacenSuscripcionesRedis({ cliente, maxPorMesa: 3 });
  const altas = await Promise.all([1, 2, 3, 4, 5].map((n) => subs.agregar(mesa, sub(n))));
  assert.strictEqual(altas.filter(Boolean).length, 3);
  assert.strictEqual((await subs.listar(mesa)).length, 3);
});
