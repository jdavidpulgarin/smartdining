const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal } = require('./helpers');

const CLAVE = 'clave-interna-de-pruebas';
const pedido = (id_pedido = 87, id_mesa = 5) => ({
  id_pedido, codigo_pedido: `PED-${id_pedido}`, id_mesa, estado: 'recibido', total: 56000, items: [{ id_plato: 3, cantidad: 2 }],
});
const post = (s, ruta, cuerpo, clave = CLAVE) => fetch(`${s.url}${ruta}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

async function escenario() {
  const s = await levantar({ INTERNAL_API_KEY: CLAVE });
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesero = await s.conectar(tokenPersonal('mesero'));
  const mesa5 = await s.conectar(tokenComensal(5));
  const mesa6 = await s.conectar(tokenComensal(6));
  await emitir(mesa5, 'join:table', {});
  await emitir(mesa6, 'join:table', {});
  return { s, cocina, admin, mesero, mesa5, mesa6 };
}

test('HTTP interno: difunde a KDS, Admin y a la mesa; no a otras mesas', async () => {
  const { s, cocina, admin, mesa5, mesa6 } = await escenario();
  const esperas = [esperar(cocina, 'order:created'), esperar(admin, 'order:created'), esperar(mesa5, 'order:created'), esperar(mesa6, 'order:created')];
  const eventId = randomUUID();
  const r = await post(s, '/internal/order-created', { eventId, pedido: pedido() });
  assert.deepStrictEqual(await r.json(), { ok: true, eventId, duplicado: false });
  const [kds, adm, m5, m6] = await Promise.all(esperas);
  assert.strictEqual(kds.pedido.codigo_pedido, 'PED-87');
  assert.ok(adm && m5 && kds.emitidoEn);
  assert.strictEqual(m6, null, 'otra mesa no debe enterarse');
  await s.cerrar();
});

test('idempotencia: mismo eventId, o mismo pedido con otro eventId, no se difunde dos veces', async () => {
  const { s, cocina } = await escenario();
  const eventId = randomUUID();
  await post(s, '/internal/order-created', { eventId, pedido: pedido() });
  const otra = esperar(cocina, 'order:created', 300);
  const r1 = await (await post(s, '/internal/order-created', { eventId, pedido: pedido() })).json();
  const r2 = await (await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: pedido() })).json();
  assert.deepStrictEqual([r1.duplicado, r2.duplicado], [true, true]);
  assert.strictEqual(await otra, null);
  await s.cerrar();
});

test('un admin conectado a KDS y Admin recibe la comanda una sola vez', async () => {
  const { s, admin } = await escenario();
  let veces = 0;
  admin.on('order:created', () => { veces += 1; });
  await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: pedido() });
  await esperar(admin, 'nunca', 300);
  assert.strictEqual(veces, 1);
  await s.cerrar();
});

test('HTTP interno exige la clave; sin clave configurada queda cerrado', async () => {
  const { s } = await escenario();
  const cuerpo = { eventId: randomUUID(), pedido: pedido() };
  assert.strictEqual((await post(s, '/internal/order-created', cuerpo, null)).status, 401);
  assert.strictEqual((await post(s, '/internal/order-created', cuerpo, 'mala')).status, 401);
  assert.strictEqual((await post(s, '/internal/order-created', '{no es json', CLAVE)).status, 400);
  assert.strictEqual((await post(s, '/internal/order-created', { eventId: 'x', pedido: pedido() })).status, 400);
  assert.strictEqual((await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: { ...pedido(), estado: 'raro' } })).status, 400);
  await s.cerrar();

  const cerrado = await levantar();
  assert.strictEqual((await post(cerrado, '/internal/order-created', cuerpo)).status, 503);
  await cerrado.cerrar();
});

test('por socket: mesero y admin pueden emitir; comensal y cocina no', async () => {
  const { s, cocina, mesero, mesa5 } = await escenario();
  const llega = esperar(cocina, 'order:created');
  const ack = await emitir(mesero, 'order:created', { eventId: randomUUID(), pedido: pedido(90) });
  assert.strictEqual(ack.ok, true);
  assert.strictEqual((await llega).pedido.id_pedido, 90);
  const falso = await emitir(mesa5, 'order:created', { eventId: randomUUID(), pedido: pedido(91) });
  assert.strictEqual(falso.codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await emitir(cocina, 'order:created', { eventId: randomUUID(), pedido: pedido(92) })).codigo, 'NO_AUTORIZADO');
  await s.cerrar();
});

test('al crearse la comanda se vacía el carrito de esa mesa y se avisa a la mesa', async () => {
  const { s, mesa5 } = await escenario();
  await emitir(mesa5, 'cart:update', { eventId: randomUUID(), accion: 'set', comensal: 'Ana', id_plato: 3, cantidad: 2 });
  const aviso = esperar(mesa5, 'cart:updated');
  await post(s, '/internal/order-created', { eventId: randomUUID(), pedido: pedido() });
  const ev = await aviso;
  assert.deepStrictEqual(ev.carrito.items, []);
  assert.strictEqual(ev.origen, 'sistema');
  assert.deepStrictEqual(s.carritos.snapshot(5).items, []);
  await s.cerrar();
});
