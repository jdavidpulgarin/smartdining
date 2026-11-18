// Push del pago en línea (webhook de Wompi): solo a quien pagó, UNA vez por
// intención aunque el webhook se repita, nunca si la intención termina en
// en_revision, y si el push falla el pago se confirma igual.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { levantar, emitir, tokenComensal } = require('./helpers');
const {
  WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa,
} = require('./pagos-helpers');
const { eventoWompi } = require('./wompi-eventos');

const sub = (n) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/dispositivo-${n}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
});
const pausa = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function pushFalso({ falla = false } = {}) {
  const f = { habilitado: true, clavePublica: 'k', enviados: [], intentos: 0 };
  f.enviar = async (s, payload) => {
    f.intentos += 1;
    if (falla) throw new Error('servicio push caído');
    f.enviados.push({ endpoint: s.endpoint, payload });
    return { ok: true };
  };
  return f;
}

/**
 * Mesa 5 ($100.000) con Ana y Beto sentados y suscritos. `registro`: respuesta
 * del backend a POST /api/transacciones/internal (por defecto, 201).
 */
async function escenario(t, { push = pushFalso(), registro } = {}) {
  const mesa = { total: 10_000_000, saldo: 10_000_000 };
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, mesa.total, mesa.saldo) }),
    'POST /api/transacciones/internal': registro || ((c) => {
      mesa.saldo -= c.monto_centavos;
      return { status: 201, cuerpo: { ok: true, duplicado: false, saldo_restante_centavos: mesa.saldo, mesa_liberada: false } };
    }),
    'POST /api/pagos/intentos-fallidos/interno': () => ({ status: 201, cuerpo: { ok: true } }),
  });
  const transacciones = {};
  const s = await levantar(WOMPI_ENV, { backend, pasarela: pasarelaFalsa(transacciones).pasarela, push });
  t.after(() => s.cerrar());
  for (const [alias, n] of [['Ana', 1], ['Beto', 2]]) {
    const c = await s.conectar(tokenComensal(5, alias));
    await emitir(c, 'join:table', {});
    await emitir(c, 'push:subscribe', { eventId: crypto.randomUUID(), subscription: sub(n) });
  }
  const intencion = async (alias) => {
    const r = await fetch(`${s.url}/pagos/intencion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenComensal(5, alias)}` },
      body: JSON.stringify({ modo: 'total', eventId: crypto.randomUUID() }),
    });
    return r.json();
  };
  const webhook = async (ev) => (await fetch(`${s.url}/pagos/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Checksum': ev.signature.checksum }, body: JSON.stringify(ev),
  })).json();
  const aprobar = (referencia, monto) => {
    const id = `tx-${crypto.randomUUID()}`;
    transacciones[id] = {
      id, reference: referencia, status: 'APPROVED', amount_in_cents: monto, currency: 'COP',
    };
    return { id, ev: eventoWompi({ secreto: WOMPI_ENV.WOMPI_EVENTS_SECRET, id, referencia, monto }) };
  };
  return {
    s, push, backend, intencion, webhook, aprobar,
  };
}

test('pago aprobado: push SOLO a quien pagó (Ana), con la intención ya en "pagada"', async (t) => {
  const {
    s, push, intencion, webhook, aprobar,
  } = await escenario(t);
  const i = await intencion('Ana');
  const { ev } = aprobar(i.referencia, i.monto_en_centavos);
  assert.strictEqual((await webhook(ev)).registrado, true);
  await pausa();
  assert.strictEqual((await s.almacenPagos.obtener(i.referencia)).estado, 'pagada');
  assert.deepStrictEqual(push.enviados.map((e) => e.endpoint), [sub(1).endpoint], 'Beto no lo recibe');
  assert.strictEqual(push.enviados[0].payload.titulo, 'Tu pago está confirmado');
  assert.ok(!/10000000|100\.000|Ana/.test(JSON.stringify(push.enviados[0].payload)), 'sin monto ni nombre');
});

test('una sola vez por intención: el mismo webhook repetido no manda otro push', async (t) => {
  const {
    push, intencion, webhook, aprobar,
  } = await escenario(t);
  const i = await intencion('Ana');
  const { ev } = aprobar(i.referencia, i.monto_en_centavos);
  await webhook(ev);
  assert.strictEqual((await webhook(ev)).duplicado, true);
  await pausa();
  assert.strictEqual(push.enviados.length, 1);
});

test('una sola vez por intención: si Wompi reintenta tras liberarse la marca del evento, la intención ya "pagada" lo corta', async (t) => {
  const {
    s, push, intencion, webhook, aprobar,
  } = await escenario(t);
  const i = await intencion('Ana');
  const { id, ev } = aprobar(i.referencia, i.monto_en_centavos);
  await webhook(ev);
  await pausa();
  // Como cuando algo falla DESPUÉS del push: el catch libera la marca y
  // Wompi reintenta el mismo evento. compararTransaccion ve la intención en
  // "pagada" (intencion_no_pendiente) y no registra ni avisa otra vez.
  await s.registroPagos.liberar(`pago:wompi:${id}:APPROVED`);
  assert.strictEqual((await webhook(ev)).registrado, false);
  await pausa();
  assert.strictEqual(push.enviados.length, 1);
});

test('avisarPagoPorPush: la marca push:pago:<clave> manda una sola vez aunque lo llamen dos veces', async () => {
  const { avisarPagoPorPush } = require('../src/pagos');
  const { crearRegistroIdempotencia } = require('../src/idempotencia');
  const push = pushFalso();
  const ctx = {
    push,
    registroPagos: crearRegistroIdempotencia({ ttlMs: 60_000 }),
    suscripciones: { async listar() { return [{ ...sub(1), comensal: 'Ana' }, { ...sub(2), comensal: 'Beto' }]; }, async quitar() {} },
  };
  avisarPagoPorPush(ctx, { idMesa: 5, comensal: 'Ana', clave: 'SD-5-1-x' });
  avisarPagoPorPush(ctx, { idMesa: 5, comensal: 'Ana', clave: 'SD-5-1-x' });
  await pausa();
  assert.deepStrictEqual(push.enviados.map((e) => e.endpoint), [sub(1).endpoint]);
});

test('avisarPagoPorPush no lanza nunca: ni si falla la reserva ni si falla el envío', async () => {
  const { avisarPagoPorPush } = require('../src/pagos');
  const ctx = {
    push: pushFalso({ falla: true }),
    registroPagos: { async reservar() { throw new Error('redis caído'); } },
    suscripciones: { async listar() { return [{ ...sub(1), comensal: 'Ana' }]; }, async quitar() {} },
  };
  assert.doesNotThrow(() => avisarPagoPorPush(ctx, { idMesa: 5, comensal: 'Ana', clave: 'SD-5-1-y' }));
  assert.doesNotThrow(() => avisarPagoPorPush({ ...ctx, registroPagos: null }, { idMesa: 5, comensal: 'Ana' }));
  await pausa();
});

test('intención que termina en en_revision (el backend rechaza el registro): sin push', async (t) => {
  const {
    s, push, intencion, webhook, aprobar,
  } = await escenario(t, { registro: () => ({ status: 409, cuerpo: { error: 'excede el saldo' } }) });
  const i = await intencion('Ana');
  const { ev } = aprobar(i.referencia, i.monto_en_centavos);
  assert.strictEqual((await webhook(ev)).registrado, false);
  await pausa();
  assert.strictEqual((await s.almacenPagos.obtener(i.referencia)).estado, 'en_revision');
  assert.strictEqual(push.intentos, 0);
});

test('si el push falla, el pago se confirma igual (registrado, intención pagada, backend llamado)', async (t) => {
  const push = pushFalso({ falla: true });
  const {
    s, backend, intencion, webhook, aprobar,
  } = await escenario(t, { push });
  const i = await intencion('Ana');
  const { ev } = aprobar(i.referencia, i.monto_en_centavos);
  const r = await webhook(ev);
  await pausa();
  assert.deepStrictEqual(r, { ok: true, duplicado: false, registrado: true });
  assert.strictEqual(push.intentos, 1, 'sí se intentó');
  assert.strictEqual((await s.almacenPagos.obtener(i.referencia)).estado, 'pagada');
  assert.strictEqual(backend.llamadas.filter((l) => l.ruta === '/api/transacciones/internal').length, 1);
});
