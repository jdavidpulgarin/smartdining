const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, CLAVE_INTERNA,
} = require('./helpers');

const avisar = (s, cuerpo, clave = CLAVE_INTERNA) => fetch(`${s.url}/internal/ingrediente-disponibilidad`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(clave ? { 'x-internal-key': clave } : {}) },
  body: JSON.stringify(cuerpo),
});

async function escenario(t) {
  const s = await levantar();
  t.after(() => s.cerrar());
  const m5 = await s.conectar(tokenComensal(5));
  await emitir(m5, 'join:table', {});
  const m6 = await s.conectar(tokenComensal(6));
  await emitir(m6, 'join:table', {});
  const cocina = await s.conectar(tokenPersonal('cocina'));
  return { s, m5, m6, cocina };
}

test('llega a todas las mesas y a la cocina solo con los campos validados', async (t) => {
  const { s, m5, m6, cocina } = await escenario(t);
  const esperas = [m5, m6, cocina].map((c) => esperar(c, 'ingrediente:disponibilidad'));
  const r = await avisar(s, { id_ingrediente: 12, disponible: false, extra: '<script>' });
  assert.deepStrictEqual([r.status, (await r.json()).duplicado], [200, false]);
  for (const ev of await Promise.all(esperas)) {
    assert.deepStrictEqual(Object.keys(ev).sort(), ['disponible', 'emitidoEn', 'id_ingrediente']);
    assert.deepStrictEqual([ev.id_ingrediente, ev.disponible], [12, false]);
  }
});

test('sin clave interna o con clave errónea: 401 y no se difunde', async (t) => {
  const { s, m5 } = await escenario(t);
  const nada = esperar(m5, 'ingrediente:disponibilidad', 300);
  assert.strictEqual((await avisar(s, { id_ingrediente: 1, disponible: true }, null)).status, 401);
  assert.strictEqual((await avisar(s, { id_ingrediente: 1, disponible: true }, 'otra')).status, 401);
  assert.strictEqual(await nada, null);
});

test('un comensal no puede emitirlo por socket (no existe como evento de cliente)', async (t) => {
  const { m5, m6 } = await escenario(t);
  const nada = esperar(m6, 'ingrediente:disponibilidad', 300);
  m5.emit('ingrediente:disponibilidad', { id_ingrediente: 1, disponible: false });
  assert.strictEqual(await nada, null);
});

test('payload inválido: id no entero positivo, disponible no booleano, eventId malo', async (t) => {
  const { s } = await escenario(t);
  for (const cuerpo of [
    { id_ingrediente: '12', disponible: true },
    { id_ingrediente: 0, disponible: true },
    { id_ingrediente: 2 ** 53, disponible: true },
    { id_ingrediente: 3, disponible: 'no' },
    { id_ingrediente: 3 },
    { id_ingrediente: 3, disponible: true, eventId: 'x' },
  ]) {
    assert.strictEqual((await avisar(s, cuerpo)).status, 400, JSON.stringify(cuerpo));
  }
});

test('duplicado: el mismo eventId del backend no se difunde dos veces', async (t) => {
  const { s, cocina } = await escenario(t);
  const eventId = randomUUID();
  const primero = esperar(cocina, 'ingrediente:disponibilidad');
  await avisar(s, { id_ingrediente: 3, disponible: true, eventId });
  await primero;
  const segundo = esperar(cocina, 'ingrediente:disponibilidad', 300);
  const r = await avisar(s, { id_ingrediente: 3, disponible: true, eventId });
  assert.strictEqual((await r.json()).duplicado, true);
  assert.strictEqual(await segundo, null);
});
