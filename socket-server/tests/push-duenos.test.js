const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');
const { crearDuenosRedis, crearDuenosMemoria } = require('../src/almacen/duenos');
const { crearRedisFalso } = require('./redis-falso');

const sub = (n) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/dispositivo-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});
function pushFalso() {
  const f = { habilitado: true, clavePublica: 'k', enviados: [] };
  f.enviar = async (s, payload) => { f.enviados.push({ endpoint: s.endpoint, payload }); return { ok: true }; };
  return f;
}
const pausa = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const interno = (s, ruta, cuerpo) => fetch(`${s.url}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify(cuerpo),
});
const listo = (extra = {}) => ({ eventId: randomUUID(), id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-87', estado: 'listo', ...extra });

/** Mesa 5 con Ana y Beto sentados y suscritos (cada uno con su teléfono). */
async function escenario(t) {
  const push = pushFalso();
  const s = await levantar({}, { push });
  t.after(() => s.cerrar());
  const sentar = async (alias, n) => {
    const c = await s.conectar(tokenComensal(5, alias));
    await emitir(c, 'join:table', {});
    await emitir(c, 'push:subscribe', { eventId: randomUUID(), subscription: sub(n) });
    return c;
  };
  const ana = await sentar('Ana', 1);
  const beto = await sentar('Beto', 2);
  return { s, push, ana, beto };
}
const linea = (comensal) => ({ eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal, id_plato: 3, cantidad: 1 });

test('"¡Tu plato está listo!" llega solo a quien lo pidió (dueños tomados del carrito)', async (t) => {
  const { s, push, ana } = await escenario(t);
  await emitir(ana, 'cart:update', linea('Ana'));
  await interno(s, '/internal/order-created', { eventId: randomUUID(), pedido: { id_pedido: 87, id_mesa: 5, estado: 'recibido' } });
  await interno(s, '/internal/order-status', listo());
  await pausa();
  assert.deepStrictEqual(push.enviados.map((e) => e.endpoint), [sub(1).endpoint]);
  assert.strictEqual(push.enviados[0].payload.titulo, '¡Tu plato está listo!');
});

test('también se toman los dueños de items[].comensal si el backend los envía', async (t) => {
  const { s, push } = await escenario(t);
  await interno(s, '/internal/order-created', {
    eventId: randomUUID(),
    pedido: { id_pedido: 87, id_mesa: 5, estado: 'recibido', items: [{ id_plato: 3, comensal: 'Beto' }, { id_plato: 4, comensal: 'x'.repeat(41) }] },
  });
  await interno(s, '/internal/order-status', listo());
  await pausa();
  assert.deepStrictEqual(push.enviados.map((e) => e.endpoint), [sub(2).endpoint]);
});

test('si no se sabe de quién es el pedido, el push de listo no le llega a nadie', async (t) => {
  const { s, push } = await escenario(t);
  await interno(s, '/internal/order-status', listo({ id_pedido: 999 }));
  await pausa();
  assert.strictEqual(push.enviados.length, 0);
});

test('otros estados (en preparación) siguen avisando a toda la mesa', async (t) => {
  const { s, push } = await escenario(t);
  await interno(s, '/internal/order-status', listo({ estado: 'en_preparacion' }));
  await pausa();
  assert.strictEqual(push.enviados.length, 2);
});

test('payload mínimo: sin nombres, montos ni mesa; abre /seguimiento', async (t) => {
  const { s, push, ana } = await escenario(t);
  await emitir(ana, 'cart:update', linea('Ana'));
  await interno(s, '/internal/order-created', { eventId: randomUUID(), pedido: { id_pedido: 87, id_mesa: 5, estado: 'recibido', total: 56000 } });
  await interno(s, '/internal/order-status', listo());
  await pausa();
  const { payload } = push.enviados[0];
  assert.deepStrictEqual(Object.keys(payload).sort(), ['cuerpo', 'estado', 'id_pedido', 'titulo', 'url']);
  assert.strictEqual(payload.url, '/seguimiento');
  assert.ok(!JSON.stringify(payload).includes('Ana'));
  assert.ok(!JSON.stringify(payload).includes('56000'));
});

test('dueños en Redis: sd:pedido:{id}:duenos con TTL; memoria con tope', async () => {
  const falso = crearRedisFalso();
  const r = crearDuenosRedis({ cliente: falso.cliente });
  await r.guardar(87, new Set(['Ana', 'Beto']));
  assert.deepStrictEqual(await r.obtener(87), ['Ana', 'Beto']);
  assert.deepStrictEqual(await r.obtener(88), []);
  assert.deepStrictEqual(falso.llaves(), ['sd:pedido:87:duenos']);
  const m = crearDuenosMemoria();
  for (let i = 0; i < 5001; i += 1) m.guardar(i, ['X']);
  assert.deepStrictEqual(m.obtener(0), [], 'el más viejo se descartó');
  assert.deepStrictEqual(m.obtener(5000), ['X']);
});

test('el personal no puede suscribirse ni recibir el push de un comensal', async (t) => {
  const { s } = await escenario(t);
  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'join:table', { id_mesa: 5 });
  const ack = await emitir(mesero, 'push:subscribe', { eventId: randomUUID(), subscription: sub(9) });
  assert.strictEqual(ack.codigo, 'NO_AUTORIZADO');
});
