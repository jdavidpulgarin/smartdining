const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal } = require('./helpers');

const CLAVE = 'clave-interna-de-pruebas';
const cambio = (extra = {}) => ({
  eventId: randomUUID(), id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-87', estado_anterior: 'recibido', estado: 'en_preparacion', ...extra,
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

test('la cocina notifica un cambio y llega en vivo a KDS, Admin y a esa mesa (no a otra)', async () => {
  const { s, cocina, admin, mesa5, mesa6 } = await escenario();
  const esperas = [esperar(admin, 'order:status'), esperar(mesa5, 'order:status'), esperar(mesa6, 'order:status')];
  const ack = await emitir(cocina, 'order:status', cambio({ estado: 'listo', estado_anterior: 'en_preparacion' }));
  assert.strictEqual(ack.ok, true);
  const [adm, m5, m6] = await Promise.all(esperas);
  assert.strictEqual(adm.estado, 'listo');
  assert.strictEqual(m5.codigo_pedido, 'PED-87');
  assert.strictEqual(m6, null);
  await s.cerrar();
});

test('idempotencia: reenviar el mismo eventId no repite la notificación', async () => {
  const { s, mesero, mesa5 } = await escenario();
  const evento = cambio({ estado: 'entregado', estado_anterior: 'listo' });
  const primera = esperar(mesa5, 'order:status');
  await emitir(mesero, 'order:status', evento);
  assert.ok(await primera);
  const repetida = esperar(mesa5, 'order:status', 300);
  const ack = await emitir(mesero, 'order:status', evento);
  assert.strictEqual(ack.duplicado, true);
  assert.strictEqual(await repetida, null);
  // Otro cambio del MISMO pedido con eventId nuevo sí pasa.
  assert.strictEqual((await emitir(mesero, 'order:status', cambio({ estado: 'pagado', estado_anterior: 'entregado' }))).duplicado, false);
  await s.cerrar();
});

test('permisos: comensal no puede; cocina solo en_preparacion/listo', async () => {
  const { s, cocina, mesa5 } = await escenario();
  assert.strictEqual((await emitir(mesa5, 'order:status', cambio())).codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await emitir(cocina, 'order:status', cambio({ estado: 'pagado' }))).codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await emitir(cocina, 'order:status', cambio({ estado: 'listo' }))).ok, true);
  await s.cerrar();
});

test('validaciones del payload y solo se reenvían campos conocidos', async () => {
  const { s, mesero, mesa5 } = await escenario();
  assert.strictEqual((await emitir(mesero, 'order:status', cambio({ estado: 'volando' }))).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(mesero, 'order:status', cambio({ id_mesa: 'cinco' }))).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(mesero, 'order:status', cambio({ eventId: 'x' }))).codigo, 'PAYLOAD_INVALIDO');
  const llega = esperar(mesa5, 'order:status');
  await emitir(mesero, 'order:status', cambio({ estado: 'listo', secreto: 'no debe salir' }));
  assert.strictEqual((await llega).secreto, undefined);
  await s.cerrar();
});

test('HTTP interno del backend: exige clave y difunde', async () => {
  const { s, mesa5 } = await escenario();
  const post = (clave, cuerpo) => fetch(`${s.url}/internal/order-status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) }, body: JSON.stringify(cuerpo),
  });
  assert.strictEqual((await post(null, cambio())).status, 401);
  const llega = esperar(mesa5, 'order:status');
  const r = await post(CLAVE, cambio({ estado: 'listo' }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await llega).estado, 'listo');
  await s.cerrar();
});
