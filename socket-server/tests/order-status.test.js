const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA } = require('./helpers');

const CLAVE = CLAVE_INTERNA;
const cambio = (extra = {}) => ({
  eventId: randomUUID(), id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-87', estado_anterior: 'recibido', estado: 'en_preparacion', ...extra,
});

async function escenario() {
  const s = await levantar({});
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

// --- origen en POST /internal/order-status (EVENTS.md §6.3) ----------------

const postEstado = (s, cuerpo) => fetch(`${s.url}/internal/order-status`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE }, body: JSON.stringify(cuerpo),
});
const cancelado = (extra = {}) => cambio({ estado_anterior: 'recibido', estado: 'cancelado', ...extra });

test('origen comensal y personal: se reenvían tal cual en order:status a KDS, Admin y la mesa', async () => {
  const { s, cocina, admin, mesa5 } = await escenario();
  for (const origen of ['comensal', 'personal']) {
    const esperas = [esperar(cocina, 'order:status'), esperar(admin, 'order:status'), esperar(mesa5, 'order:status')];
    const r = await postEstado(s, cancelado({ origen }));
    assert.deepStrictEqual([r.status, (await r.json()).ok], [200, true], origen);
    for (const ev of await Promise.all(esperas)) {
      assert.ok(ev, `${origen}: debe llegar`);
      assert.strictEqual(ev.origen, origen);
      assert.strictEqual(ev.estado, 'cancelado');
    }
  }
  await s.cerrar();
});

test('origen ausente: el evento NO lleva la clave origen (quien recibe asume personal)', async () => {
  const { s, mesa5 } = await escenario();
  const llega = esperar(mesa5, 'order:status');
  assert.strictEqual((await postEstado(s, cancelado())).status, 200);
  const ev = await llega;
  assert.ok(ev);
  assert.strictEqual('origen' in ev, false);
  assert.deepStrictEqual(Object.keys(ev).sort(), ['codigo_pedido', 'emitidoEn', 'estado', 'estado_anterior', 'eventId', 'id_mesa', 'id_pedido']);
  await s.cerrar();
});

test('origen inválido o null: 400 PAYLOAD_INVALIDO, no emite y no consume el eventId', async () => {
  const { s, mesa5 } = await escenario();
  for (const origen of [null, '', 'Comensal', 'cocina', 'sistema', 5, true, { quien: 'comensal' }]) {
    const cuerpo = cancelado({ origen });
    const nada = esperar(mesa5, 'order:status', 250);
    const r = await postEstado(s, cuerpo);
    const b = await r.json();
    assert.strictEqual(r.status, 400, JSON.stringify(origen));
    assert.strictEqual(b.codigo, 'PAYLOAD_INVALIDO');
    assert.match(b.mensaje, /origen/);
    assert.strictEqual(await nada, null, `${JSON.stringify(origen)}: no debe emitir`);
    // El mismo eventId, ya corregido, sí sale: el 400 no lo consumió.
    const llega = esperar(mesa5, 'order:status');
    const ok = await postEstado(s, { ...cuerpo, origen: 'comensal' });
    assert.deepStrictEqual(await ok.json(), { ok: true, eventId: cuerpo.eventId, duplicado: false });
    assert.strictEqual((await llega).origen, 'comensal');
  }
  await s.cerrar();
});

test('origen con un estado distinto de cancelado: se acepta y se reenvía igual', async () => {
  const { s, mesa5 } = await escenario();
  const llega = esperar(mesa5, 'order:status');
  const r = await postEstado(s, cambio({ estado_anterior: 'recibido', estado: 'en_preparacion', origen: 'personal' }));
  assert.strictEqual(r.status, 200);
  const ev = await llega;
  assert.deepStrictEqual([ev.estado, ev.origen], ['en_preparacion', 'personal']);
  await s.cerrar();
});

test('por el socket del personal, origen en el payload NO se reenvía (solo el HTTP interno lo pasa)', async () => {
  const { s, mesero, mesa5 } = await escenario();
  const llega = esperar(mesa5, 'order:status');
  const ack = await emitir(mesero, 'order:status', cancelado({ origen: 'comensal' }));
  assert.strictEqual(ack.ok, true);
  assert.strictEqual('origen' in (await llega), false);
  await s.cerrar();
});
