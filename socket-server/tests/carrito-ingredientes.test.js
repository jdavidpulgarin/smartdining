const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal } = require('./helpers');
const { validarIngredientes, MAX_INGREDIENTES } = require('../src/carrito');

const ing = (id_ingrediente, porcion = 'normal', extra = {}) => ({ id_ingrediente, porcion, ...extra });
const set = (ingredientes, extra = {}) => ({
  eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal: 'Ana', id_plato: 3, cantidad: 1, ingredientes, ...extra,
});

async function mesa(t) {
  const s = await levantar();
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(1));
  const beto = await s.conectar(tokenComensal(1));
  await emitir(ana, 'join:table', {});
  await emitir(beto, 'join:table', {});
  return { s, ana, beto };
}

test('ingredientes válidos se guardan normalizados y los demás los ven igual', async (t) => {
  const { ana, beto } = await mesa(t);
  const llega = esperar(beto, 'cart:updated');
  const ack = await emitir(ana, 'cart:update', set([ing(10, 'ligera'), ing(12, 'extra')]));
  assert.strictEqual(ack.ok, true);
  assert.deepStrictEqual(ack.carrito.items[0].ingredientes, [
    { id_ingrediente: 10, porcion: 'ligera' }, { id_ingrediente: 12, porcion: 'extra' },
  ]);
  assert.deepStrictEqual((await llega).carrito.items[0].ingredientes, ack.carrito.items[0].ingredientes);
});

test('sin ingredientes (o null) la línea es un plato simple', async (t) => {
  const { ana } = await mesa(t);
  const sinCampo = set(undefined);
  delete sinCampo.ingredientes;
  assert.strictEqual((await emitir(ana, 'cart:update', sinCampo)).carrito.items[0].ingredientes, null);
  const conNull = await emitir(ana, 'cart:update', set(null));
  assert.strictEqual(conNull.ok, true);
  assert.ok(conNull.carrito.items.every((i) => i.ingredientes === null));
  // Un arreglo vacío es válido: plato armable sin nada elegido todavía.
  assert.deepStrictEqual((await emitir(ana, 'cart:update', set([]))).carrito.items[2].ingredientes, []);
});

test(`más de ${MAX_INGREDIENTES} ingredientes se rechaza`, async (t) => {
  const { s, ana } = await mesa(t);
  const muchos = Array.from({ length: MAX_INGREDIENTES + 1 }, (_, i) => ing(i + 1));
  const ack = await emitir(ana, 'cart:update', set(muchos));
  assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual(s.carritos.snapshot(1).items.length, 0);
  const justo = Array.from({ length: MAX_INGREDIENTES }, (_, i) => ing(i + 1));
  assert.strictEqual((await emitir(ana, 'cart:update', set(justo))).ok, true);
});

test('porción inválida se rechaza', async (t) => {
  const { ana } = await mesa(t);
  for (const porcion of ['doble', 'NORMAL', '', null, 1]) {
    const ack = await emitir(ana, 'cart:update', set([ing(10, porcion)]));
    assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO', String(porcion));
  }
  const sinPorcion = await emitir(ana, 'cart:update', set([{ id_ingrediente: 10 }]));
  assert.strictEqual(sinPorcion.codigo, 'PAYLOAD_INVALIDO');
});

test('id_ingrediente que no es entero positivo se rechaza', async (t) => {
  const { ana } = await mesa(t);
  for (const id of ['10', 1.5, 0, -3, null, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const ack = await emitir(ana, 'cart:update', set([ing(id)]));
    assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO', String(id));
  }
});

test('ids de ingrediente repetidos se rechazan', async (t) => {
  const { ana } = await mesa(t);
  const ack = await emitir(ana, 'cart:update', set([ing(10, 'normal'), ing(10, 'extra')]));
  assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO');
  assert.match(ack.mensaje, /repetido/);
});

test('campos extra (precio_aplicado incluido) se descartan, no se guardan ni se difunden', async (t) => {
  const { ana, beto } = await mesa(t);
  const llega = esperar(beto, 'cart:updated');
  const ack = await emitir(ana, 'cart:update', set([
    ing(10, 'normal', { precio_aplicado: -99999, nombre: '<script>', __proto__x: 1 }),
  ]));
  assert.strictEqual(ack.ok, true);
  assert.deepStrictEqual(ack.carrito.items[0].ingredientes, [{ id_ingrediente: 10, porcion: 'normal' }]);
  assert.deepStrictEqual(Object.keys((await llega).carrito.items[0].ingredientes[0]).sort(), ['id_ingrediente', 'porcion']);
});

test('un elemento que no es objeto plano se rechaza', async (t) => {
  const { ana } = await mesa(t);
  for (const malo of [10, 'arroz', null, [10, 'normal'], true]) {
    const ack = await emitir(ana, 'cart:update', set([malo]));
    assert.strictEqual(ack.codigo, 'PAYLOAD_INVALIDO', JSON.stringify(malo));
  }
  assert.strictEqual((await emitir(ana, 'cart:update', set({ id_ingrediente: 1, porcion: 'normal' }))).codigo, 'PAYLOAD_INVALIDO');
  // Fuera del socket (donde todo llega como JSON) también se exige prototipo de Object.
  assert.match(validarIngredientes([Object.create({ id_ingrediente: 1, porcion: 'normal' })]), /objeto/);
  assert.match(validarIngredientes([new Map()]), /objeto/);
});

test('reenvío idempotente con ingredientes: mismo eventId no duplica ni cambia el snapshot', async (t) => {
  const { ana, beto } = await mesa(t);
  const evento = set([ing(10, 'extra', { precio_aplicado: 1500 }), ing(11)]);
  const a1 = await emitir(ana, 'cart:update', evento);
  const otro = esperar(beto, 'cart:updated', 300);
  await otro; // consume el primero
  const repetido = esperar(beto, 'cart:updated', 300);
  const a2 = await emitir(ana, 'cart:update', evento);
  assert.deepStrictEqual([a1.duplicado, a2.duplicado], [false, true]);
  assert.deepStrictEqual(a2.carrito, a1.carrito);
  assert.strictEqual(await repetido, null);
});

test('un payload inválido no consume el eventId: corregido con el mismo id se aplica', async (t) => {
  const { ana } = await mesa(t);
  const id = randomUUID();
  assert.strictEqual((await emitir(ana, 'cart:update', set([ing(1, 'doble')], { eventId: id }))).ok, false);
  const ok = await emitir(ana, 'cart:update', set([ing(1, 'extra')], { eventId: id }));
  assert.deepStrictEqual([ok.ok, ok.duplicado], [true, false]);
});
