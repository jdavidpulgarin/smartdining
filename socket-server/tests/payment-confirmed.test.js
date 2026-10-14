const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA } = require('./helpers');

const CLAVE = CLAVE_INTERNA;
const cobro = (extra = {}) => ({
  eventId: randomUUID(),
  id_mesa: 5,
  comensal: 'Ana',
  monto_centavos: 2_000_000,
  saldo_restante_centavos: 1_450_000,
  referencia_externa: 'CAJA-123',
  id_transaccion: 901,
  ...extra,
});

async function escenario() {
  const s = await levantar({});
  const admin = await s.conectar(tokenPersonal('admin'));
  const cajero = await s.conectar(tokenPersonal('cajero', 2));
  const mesa5 = await s.conectar(tokenComensal(5));
  const mesa6 = await s.conectar(tokenComensal(6));
  await emitir(mesa5, 'join:table', {});
  await emitir(mesa6, 'join:table', {});
  const post = (cuerpo, clave = CLAVE) => fetch(`${s.url}/internal/payment-confirmed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
  return { s, admin, cajero, mesa5, mesa6, post };
}

test('exige la clave interna: 401 sin clave o con clave equivocada, sin emitir nada', async () => {
  const { s, admin, mesa5, post } = await escenario();
  const esperas = [esperar(admin, 'payment:confirmed'), esperar(mesa5, 'payment:confirmed')];
  const sinClave = await post(cobro(), null);
  assert.strictEqual(sinClave.status, 401);
  assert.strictEqual((await sinClave.json()).codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await post(cobro(), 'clave-equivocada')).status, 401);
  assert.deepStrictEqual(await Promise.all(esperas), [null, null]);
  await s.cerrar();
});

test('un cobro de caja llega a Admin, a la caja y a esa mesa (no a otra) con el payload exacto', async () => {
  const { s, admin, cajero, mesa5, mesa6, post } = await escenario();
  const esperas = ['admin', 'cajero', 'mesa5', 'mesa6'].map((n) => esperar({ admin, cajero, mesa5, mesa6 }[n], 'payment:confirmed'));
  const evento = cobro();
  const r = await post(evento);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { ok: true, eventId: evento.eventId, duplicado: false });
  const [adm, caja, m5, m6] = await Promise.all(esperas);
  assert.strictEqual(m6, null);
  const { emitidoEn, ...resto } = m5;
  assert.ok(!Number.isNaN(Date.parse(emitidoEn)));
  assert.deepStrictEqual(resto, {
    eventId: evento.eventId,
    id_mesa: 5,
    comensal: 'Ana',
    monto: 20000,
    saldo_restante: 14500,
    monto_centavos: 2_000_000,
    saldo_restante_centavos: 1_450_000,
    referencia_externa: 'CAJA-123',
  });
  assert.deepStrictEqual(adm, m5);
  assert.deepStrictEqual(caja, m5);
  await s.cerrar();
});

test('abono parcial de un comensal sin referencia externa: referencia_externa null y monto con centavos', async () => {
  const { s, mesa5, post } = await escenario();
  const llega = esperar(mesa5, 'payment:confirmed');
  const r = await post(cobro({ comensal: 'Luis', monto_centavos: 1_000_050, referencia_externa: null }));
  assert.strictEqual(r.status, 200);
  const p = await llega;
  assert.strictEqual(p.comensal, 'Luis');
  assert.strictEqual(p.referencia_externa, null);
  assert.strictEqual(p.monto, 10000.5);
  assert.strictEqual(p.monto_centavos, 1_000_050);
  await s.cerrar();
});

test('saldo_restante_centavos = 0 es válido (mesa completa, sin comensal)', async () => {
  const { s, admin, post } = await escenario();
  const llega = esperar(admin, 'payment:confirmed');
  const { comensal, referencia_externa, ...sinOpcionales } = cobro({ saldo_restante_centavos: 0 });
  assert.strictEqual((await post(sinOpcionales)).status, 200);
  const p = await llega;
  assert.strictEqual(p.saldo_restante, 0);
  assert.strictEqual(p.saldo_restante_centavos, 0);
  assert.strictEqual(p.comensal, null);
  assert.strictEqual(p.referencia_externa, null);
  await s.cerrar();
});

test('idempotencia: el mismo eventId o la misma id_transaccion no repiten el aviso', async () => {
  const { s, mesa5, post } = await escenario();
  const evento = cobro({ id_transaccion: 77 });
  const primera = esperar(mesa5, 'payment:confirmed');
  assert.strictEqual((await (await post(evento)).json()).duplicado, false);
  assert.ok(await primera);

  const repetida = esperar(mesa5, 'payment:confirmed');
  const mismoEvento = await (await post(evento)).json();
  assert.deepStrictEqual(mismoEvento, { ok: true, eventId: evento.eventId, duplicado: true });
  const mismaTx = await (await post(cobro({ id_transaccion: 77 }))).json();
  assert.strictEqual(mismaTx.duplicado, true);
  assert.strictEqual(await repetida, null);

  // Otro cobro (otra id_transaccion) sí pasa.
  const otro = esperar(mesa5, 'payment:confirmed');
  assert.strictEqual((await (await post(cobro({ id_transaccion: 78 }))).json()).duplicado, false);
  assert.ok(await otro);
  await s.cerrar();
});

test('validaciones: 400 PAYLOAD_INVALIDO o JSON_INVALIDO y no se emite nada', async () => {
  const { s, admin, post } = await escenario();
  const llega = esperar(admin, 'payment:confirmed', 500);
  const { eventId, ...sinEventId } = cobro();
  const { saldo_restante_centavos, ...sinSaldo } = cobro();
  const invalidos = [
    cobro({ eventId: 'no-es-uuid' }),
    sinEventId,
    cobro({ id_mesa: 'cinco' }),
    cobro({ id_mesa: 0 }),
    cobro({ monto_centavos: 0 }),
    cobro({ monto_centavos: 1500.5 }),
    cobro({ monto_centavos: '2000000' }),
    cobro({ monto_centavos: 10_000_000_001 }),
    cobro({ saldo_restante_centavos: -1 }),
    sinSaldo,
    cobro({ comensal: '' }),
    cobro({ comensal: 'x'.repeat(41) }),
    cobro({ comensal: 7 }),
    cobro({ referencia_externa: 'r'.repeat(256) }),
    cobro({ id_transaccion: -3 }),
  ];
  for (const cuerpo of invalidos) {
    const r = await post(cuerpo);
    assert.strictEqual(r.status, 400, JSON.stringify(cuerpo));
    assert.strictEqual((await r.json()).codigo, 'PAYLOAD_INVALIDO', JSON.stringify(cuerpo));
  }
  const malformado = await post('{"eventId": ');
  assert.strictEqual(malformado.status, 400);
  assert.strictEqual((await malformado.json()).codigo, 'JSON_INVALIDO');
  assert.strictEqual(await llega, null);
  await s.cerrar();
});

test('solo se reenvían los campos conocidos: un campo extra no llega a las pantallas', async () => {
  const { s, mesa5, post } = await escenario();
  const llega = esperar(mesa5, 'payment:confirmed');
  assert.strictEqual((await post(cobro({ secreto: 'no debe salir', metodo_pago: 'efectivo' }))).status, 200);
  const p = await llega;
  assert.strictEqual(p.secreto, undefined);
  assert.strictEqual(p.metodo_pago, undefined);
  assert.strictEqual(p.id_transaccion, undefined);
  await s.cerrar();
});
