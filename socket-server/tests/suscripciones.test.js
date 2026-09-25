const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, tokenComensal, tokenPersonal } = require('./helpers');
const { validarSuscripcion } = require('../src/suscripciones');

const sub = (n = 1) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/dispositivo-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});

// Servicio push falso que registra lo enviado y permite simular caducidad.
function pushFalso() {
  const f = { habilitado: true, clavePublica: 'k', enviados: [], caducar: new Set() };
  f.enviar = async (s, payload) => {
    f.enviados.push({ endpoint: s.endpoint, payload });
    return f.caducar.has(s.endpoint) ? { ok: false, caducada: true } : { ok: true };
  };
  return f;
}
const post = (s, metodo, cuerpo, token) => fetch(`${s.url}/push/suscripcion`, {
  method: metodo, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(cuerpo),
});
const cambio = (extra) => ({ eventId: randomUUID(), id_pedido: 1, id_mesa: 5, codigo_pedido: 'PED-1', estado: 'listo', ...extra });
const pausa = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('validarSuscripcion rechaza endpoints peligrosos (SSRF) y llaves malformadas', () => {
  assert.ok(validarSuscripcion(sub()).suscripcion);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x',
    'https://intranet/x', 'no-url', 'https://169.254.169.254/latest']) {
    assert.ok(validarSuscripcion({ ...sub(), endpoint }).error, endpoint);
  }
  assert.ok(validarSuscripcion({ endpoint: sub().endpoint }).error);
  assert.ok(validarSuscripcion({ ...sub(), keys: { p256dh: 'a b', auth: 'x' } }).error);
  assert.ok(validarSuscripcion(null).error);
});

test('HTTP: el comensal se suscribe y se desuscribe; solo el comensal', async () => {
  const push = pushFalso();
  const s = await levantar({}, { push });
  assert.strictEqual((await post(s, 'POST', { subscription: sub() })).status, 401);
  assert.strictEqual((await post(s, 'POST', { subscription: sub() }, tokenPersonal('mesero'))).status, 403);
  assert.strictEqual((await post(s, 'POST', { subscription: { endpoint: 'x' } }, tokenComensal(5))).status, 400);
  assert.strictEqual((await post(s, 'POST', { subscription: sub() }, tokenComensal(5))).status, 201);
  assert.strictEqual((await post(s, 'POST', { subscription: sub() }, tokenComensal(5))).status, 201); // idempotente
  assert.strictEqual(s.suscripciones.listar(5).length, 1);
  assert.strictEqual((await post(s, 'DELETE', { endpoint: sub().endpoint }, tokenComensal(5))).status, 200);
  assert.strictEqual(s.suscripciones.listar(5).length, 0);
  await s.cerrar();
});

test('por socket: push:subscribe es idempotente y push:unsubscribe la quita', async () => {
  const s = await levantar({}, { push: pushFalso() });
  const ana = await s.conectar(tokenComensal(5));
  const eventId = randomUUID();
  assert.strictEqual((await emitir(ana, 'push:subscribe', { eventId, subscription: sub() })).duplicado, false);
  assert.strictEqual((await emitir(ana, 'push:subscribe', { eventId, subscription: sub() })).duplicado, true);
  assert.strictEqual((await emitir(ana, 'push:subscribe', { eventId: randomUUID(), subscription: { endpoint: 'x' } })).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual(s.suscripciones.listar(5).length, 1);
  assert.strictEqual((await emitir(ana, 'push:unsubscribe', { endpoint: sub().endpoint })).ok, true);
  assert.strictEqual(s.suscripciones.listar(5).length, 0);
  const mesero = await s.conectar(tokenPersonal('mesero'));
  assert.strictEqual((await emitir(mesero, 'push:subscribe', { eventId: randomUUID(), subscription: sub() })).codigo, 'NO_AUTORIZADO');
  await s.cerrar();
});

test('un cambio de estado envía push solo a las suscripciones de ESA mesa', async () => {
  const push = pushFalso();
  const s = await levantar({}, { push });
  s.suscripciones.agregar(5, sub(1));
  s.suscripciones.agregar(6, sub(2));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  await emitir(cocina, 'order:status', cambio());
  await pausa();
  assert.deepStrictEqual(push.enviados.map((e) => e.endpoint), [sub(1).endpoint]);
  assert.strictEqual(push.enviados[0].payload.titulo, 'Tu pedido está listo');
  assert.strictEqual(push.enviados[0].payload.id_mesa, 5);
  // Estados que no ameritan interrumpir al comensal no generan push.
  await emitir(cocina, 'order:status', cambio({ estado: 'listo' }));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'order:status', cambio({ estado: 'entregado' }));
  await pausa();
  assert.strictEqual(push.enviados.length, 2);
  await s.cerrar();
});

test('un evento duplicado no reenvía push y las suscripciones caducadas se eliminan', async () => {
  const push = pushFalso();
  const s = await levantar({}, { push });
  s.suscripciones.agregar(5, sub(1));
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const evento = cambio();
  await emitir(cocina, 'order:status', evento);
  await emitir(cocina, 'order:status', evento);
  await pausa();
  assert.strictEqual(push.enviados.length, 1);
  push.caducar.add(sub(1).endpoint);
  await emitir(cocina, 'order:status', cambio());
  await pausa();
  assert.strictEqual(s.suscripciones.listar(5).length, 0);
  await s.cerrar();
});

test('al liberar la mesa se borran suscripciones y carrito de esa mesa (no de otras)', async () => {
  const s = await levantar({ INTERNAL_API_KEY: 'k' }, { push: pushFalso() });
  s.suscripciones.agregar(5, sub(1));
  s.suscripciones.agregar(6, sub(2));
  s.carritos.aplicar(5, { accion: 'set', comensal: 'Ana', id_plato: 1, cantidad: 1 });
  const r = await fetch(`${s.url}/internal/mesa-liberada`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': 'k' }, body: JSON.stringify({ id_mesa: 5 }),
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(s.suscripciones.listar(5).length, 0);
  assert.strictEqual(s.suscripciones.listar(6).length, 1);
  assert.deepStrictEqual(s.carritos.snapshot(5).items, []);
  await s.cerrar();
});
