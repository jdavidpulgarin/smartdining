const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');

// Un cuerpo de tipo string se manda tal cual (para probar JSON malformado).
const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}/internal/plato-disponibilidad`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

async function escenario(t) {
  const s = await levantar();
  t.after(() => s.cerrar());
  const m5 = await s.conectar(tokenComensal(5));
  await emitir(m5, 'join:table', {});
  const m6 = await s.conectar(tokenComensal(6));
  await emitir(m6, 'join:table', {});
  const cocina = await s.conectar(tokenPersonal('cocina'));
  const admin = await s.conectar(tokenPersonal('admin'));
  return { s, m5, m6, cocina, admin };
}

test('llega a comensales, cocina y admin solo con los campos validados', async (t) => {
  const { s, m5, m6, cocina, admin } = await escenario(t);
  const esperas = [m5, m6, cocina, admin].map((c) => esperar(c, 'plato:disponibilidad'));
  const r = await avisar(s, {
    id_plato: 7, disponible: false, extra: '<script>', nombre: 'Bandeja', id_ingrediente: 3,
  });
  assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: false }]);
  for (const ev of await Promise.all(esperas)) {
    assert.ok(ev, 'el evento debe llegar a todos los sockets');
    assert.deepStrictEqual(Object.keys(ev).sort(), ['disponible', 'emitidoEn', 'id_plato']);
    assert.deepStrictEqual([ev.id_plato, ev.disponible], [7, false]);
    assert.ok(!Number.isNaN(Date.parse(ev.emitidoEn)));
  }
});

test('disponible: true también se difunde', async (t) => {
  const { s, cocina } = await escenario(t);
  const llega = esperar(cocina, 'plato:disponibilidad');
  assert.strictEqual((await avisar(s, { id_plato: 7, disponible: true })).status, 200);
  const ev = await llega;
  assert.deepStrictEqual([ev.id_plato, ev.disponible], [7, true]);
});

test('sin clave interna o con clave errónea: 401 y no se difunde', async (t) => {
  const { s, m5, admin } = await escenario(t);
  const nada = [m5, admin].map((c) => esperar(c, 'plato:disponibilidad', 300));
  assert.strictEqual((await avisar(s, { id_plato: 1, disponible: true }, null)).status, 401);
  assert.strictEqual((await avisar(s, { id_plato: 1, disponible: true }, 'otra')).status, 401);
  assert.deepStrictEqual(await Promise.all(nada), [null, null]);
});

test('un comensal no puede emitirlo por socket (no existe como evento de cliente)', async (t) => {
  const { m5, m6 } = await escenario(t);
  const nada = esperar(m6, 'plato:disponibilidad', 300);
  m5.emit('plato:disponibilidad', { id_plato: 1, disponible: false });
  assert.strictEqual(await nada, null);
});

test('payload inválido: 400 PAYLOAD_INVALIDO y no se difunde', async (t) => {
  const { s, cocina } = await escenario(t);
  const nada = esperar(cocina, 'plato:disponibilidad', 300);
  for (const cuerpo of [
    { id_plato: '7', disponible: true },
    { id_plato: 0, disponible: true },
    { id_plato: -3, disponible: true },
    { id_plato: 1.5, disponible: true },
    { id_plato: 2 ** 53, disponible: true },
    { disponible: true },
    { id_ingrediente: 7, disponible: true },
    { id_plato: 3, disponible: 'no' },
    { id_plato: 3, disponible: 1 },
    { id_plato: 3, disponible: null },
    { id_plato: 3 },
    { id_plato: 3, disponible: true, eventId: 'x' },
    { id_plato: 3, disponible: true, eventId: null },
  ]) {
    const r = await avisar(s, cuerpo);
    assert.strictEqual(r.status, 400, JSON.stringify(cuerpo));
    assert.strictEqual((await r.json()).codigo, 'PAYLOAD_INVALIDO', JSON.stringify(cuerpo));
  }
  assert.strictEqual(await nada, null);
});

test('JSON malformado o que no es objeto: 400 JSON_INVALIDO', async (t) => {
  const { s } = await escenario(t);
  for (const cuerpo of ['{"id_plato": 1,', '[1,2]', '"texto"', 'null']) {
    const r = await avisar(s, cuerpo);
    assert.strictEqual(r.status, 400, cuerpo);
    assert.strictEqual((await r.json()).codigo, 'JSON_INVALIDO', cuerpo);
  }
});

test('duplicado: el mismo eventId del backend no se difunde dos veces', async (t) => {
  const { s, cocina } = await escenario(t);
  const eventId = randomUUID();
  const primero = esperar(cocina, 'plato:disponibilidad');
  assert.deepStrictEqual(await (await avisar(s, { id_plato: 3, disponible: false, eventId })).json(),
    { ok: true, duplicado: false });
  assert.ok(await primero);
  const segundo = esperar(cocina, 'plato:disponibilidad', 300);
  const r = await avisar(s, { id_plato: 3, disponible: false, eventId });
  assert.deepStrictEqual([r.status, await r.json()], [200, { ok: true, duplicado: true }]);
  assert.strictEqual(await segundo, null);
});

test('la clave de idempotencia es propia: el mismo eventId en ingrediente no bloquea al plato', async (t) => {
  const { s, cocina } = await escenario(t);
  const eventId = randomUUID();
  const ingrediente = await fetch(`${s.url}/internal/ingrediente-disponibilidad`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
    body: JSON.stringify({ id_ingrediente: 3, disponible: false, eventId }),
  });
  assert.strictEqual((await ingrediente.json()).duplicado, false);
  const llega = esperar(cocina, 'plato:disponibilidad');
  const r = await avisar(s, { id_plato: 3, disponible: false, eventId });
  assert.strictEqual((await r.json()).duplicado, false);
  assert.ok(await llega);
});

test('sin eventId no hay idempotencia: dos avisos iguales se difunden dos veces', async (t) => {
  const { s, cocina } = await escenario(t);
  for (let i = 0; i < 2; i += 1) {
    const llega = esperar(cocina, 'plato:disponibilidad');
    assert.strictEqual((await (await avisar(s, { id_plato: 9, disponible: true })).json()).duplicado, false);
    assert.ok(await llega);
  }
});
