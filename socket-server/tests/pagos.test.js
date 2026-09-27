const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal } = require('./helpers');
const { verificarFirmaWebhook } = require('../src/pagos');

const SECRETO = 'whsec_de_pruebas';
const evento = (extra = {}) => ({
  id: `evt_${crypto.randomUUID()}`,
  type: 'payment.succeeded',
  data: { id_pedido: 87, id_mesa: 5, monto: 56000, referencia_externa: 'ch_123' },
  ...extra,
});
const firmar = (crudo, t = Math.floor(Date.now() / 1000), secreto = SECRETO) => {
  const hex = crypto.createHmac('sha256', secreto).update(`${t}.${crudo}`).digest('hex');
  return `t=${t},v1=${hex}`;
};
const enviar = (s, crudo, cabecera) => fetch(`${s.url}/pagos/webhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cabecera ? { 'x-signature': cabecera } : {}) }, body: crudo,
});

async function escenario() {
  const s = await levantar({ PAYMENT_WEBHOOK_SECRET: SECRETO });
  const admin = await s.conectar(tokenPersonal('admin'));
  const mesa5 = await s.conectar(tokenComensal(5));
  const mesa6 = await s.conectar(tokenComensal(6));
  await emitir(mesa5, 'join:table', {});
  await emitir(mesa6, 'join:table', {});
  return { s, admin, mesa5, mesa6 };
}

test('firma válida: confirma el pago y avisa a Admin y a la mesa, no a otras', async () => {
  const { s, admin, mesa5, mesa6 } = await escenario();
  const esperas = [esperar(admin, 'payment:confirmed'), esperar(mesa5, 'payment:confirmed'), esperar(mesa6, 'payment:confirmed')];
  const crudo = JSON.stringify(evento());
  const r = await enviar(s, crudo, firmar(crudo));
  assert.deepStrictEqual(await r.json(), { ok: true, duplicado: false });
  const [adm, m5, m6] = await Promise.all(esperas);
  assert.strictEqual(adm.monto, 56000);
  assert.strictEqual(m5.referencia_externa, 'ch_123');
  assert.strictEqual(m6, null);
  await s.cerrar();
});

test('sin firma, con firma alterada, de otro secreto o cuerpo modificado: 400 y NO se procesa', async () => {
  const { s, admin } = await escenario();
  const crudo = JSON.stringify(evento());
  const llegaria = esperar(admin, 'payment:confirmed', 400);
  const intentos = [
    [crudo, null],
    [crudo, firmar(crudo, undefined, 'otro-secreto')],
    [crudo, firmar(crudo).replace(/.$/, (c) => (c === '0' ? '1' : '0'))],
    [crudo.replace('56000', '1'), firmar(crudo)], // monto alterado tras firmar
    [crudo, 't=abc,v1=xyz'],
    [crudo, 'basura'],
    [crudo, `t=${Math.floor(Date.now() / 1000)}`],
  ];
  for (const [cuerpo, cab] of intentos) {
    const r = await enviar(s, cuerpo, cab);
    assert.strictEqual(r.status, 400, String(cab));
    assert.strictEqual((await r.json()).codigo, 'FIRMA_INVALIDA');
  }
  assert.strictEqual(await llegaria, null, 'ninguna confirmación debe salir con firma inválida');
  await s.cerrar();
});

test('la firma se verifica sobre el cuerpo RAW: el mismo JSON con otros espacios no vale', async () => {
  const { s } = await escenario();
  const e = evento();
  const compacto = JSON.stringify(e);
  const conEspacios = JSON.stringify(e, null, 2);
  assert.strictEqual((await enviar(s, conEspacios, firmar(compacto))).status, 400);
  assert.strictEqual((await enviar(s, conEspacios, firmar(conEspacios))).status, 200);
  await s.cerrar();
});

test('anti-replay: rechaza timestamps fuera de tolerancia (pasado y futuro)', async () => {
  const { s } = await escenario();
  const crudo = JSON.stringify(evento());
  const ahora = Math.floor(Date.now() / 1000);
  assert.strictEqual((await enviar(s, crudo, firmar(crudo, ahora - 330))).status, 400);
  assert.strictEqual((await enviar(s, crudo, firmar(crudo, ahora + 330))).status, 400);
  assert.strictEqual((await enviar(s, crudo, firmar(crudo, ahora - 60))).status, 200);
  await s.cerrar();
});

test('la firma se comprueba ANTES de parsear: cuerpo inválido sin firma es FIRMA_INVALIDA', async () => {
  const { s } = await escenario();
  const r = await enviar(s, '{esto no es json', null);
  assert.strictEqual((await r.json()).codigo, 'FIRMA_INVALIDA');
  const malo = '{esto no es json';
  const r2 = await enviar(s, malo, firmar(malo)); // firmado pero ilegible
  assert.strictEqual((await r2.json()).codigo, 'JSON_INVALIDO');
  await s.cerrar();
});

test('idempotencia: el mismo evento del proveedor se procesa una sola vez', async () => {
  const { s, admin } = await escenario();
  const crudo = JSON.stringify(evento());
  const primero = esperar(admin, 'payment:confirmed');
  const r1 = await (await enviar(s, crudo, firmar(crudo))).json();
  await primero;
  const repetido = esperar(admin, 'payment:confirmed', 300);
  const r2 = await (await enviar(s, crudo, firmar(crudo))).json();
  assert.deepStrictEqual([r1.duplicado, r2.duplicado], [false, true]);
  assert.strictEqual(await repetido, null);
  await s.cerrar();
});

test('eventos de otro tipo se ignoran con 200; datos inválidos con 400', async () => {
  const { s, admin } = await escenario();
  const otro = JSON.stringify(evento({ type: 'payment.refunded' }));
  const escucha = esperar(admin, 'payment:confirmed', 300);
  const r = await enviar(s, otro, firmar(otro));
  assert.deepStrictEqual([r.status, (await r.json()).ignorado], [200, true]);
  assert.strictEqual(await escucha, null);
  for (const data of [{ id_pedido: 1, id_mesa: 5, monto: -5, referencia_externa: 'x' }, { id_pedido: 'a', id_mesa: 5, monto: 1, referencia_externa: 'x' }, null]) {
    const malo = JSON.stringify(evento({ data }));
    assert.strictEqual((await enviar(s, malo, firmar(malo))).status, 400);
  }
  await s.cerrar();
});

test('sin PAYMENT_WEBHOOK_SECRET el endpoint queda cerrado (503) y el cuerpo enorme da 413', async () => {
  const cerrado = await levantar();
  assert.strictEqual((await enviar(cerrado, '{}', 'x')).status, 503);
  await cerrado.cerrar();
  const { s } = await escenario();
  assert.strictEqual((await enviar(s, 'x'.repeat(200 * 1024), 'x')).status, 413);
  await s.cerrar();
});

test('verificarFirmaWebhook: rotación de secreto con varios v1', () => {
  const crudo = Buffer.from('{"a":1}');
  const t = 1_700_000_000;
  const hex = (sec) => crypto.createHmac('sha256', sec).update(`${t}.`).update(crudo).digest('hex');
  const cab = `t=${t},v1=${hex('viejo')},v1=${hex('nuevo')}`;
  const opts = { ahora: () => t * 1000 };
  assert.strictEqual(verificarFirmaWebhook(crudo, cab, 'nuevo', opts).valida, true);
  assert.strictEqual(verificarFirmaWebhook(crudo, cab, 'viejo', opts).valida, true);
  assert.strictEqual(verificarFirmaWebhook(crudo, cab, 'otro', opts).valida, false);
});
