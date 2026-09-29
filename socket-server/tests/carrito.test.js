const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal } = require('./helpers');

const set = (comensal, id_plato, cantidad, extra = {}) => ({
  eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal, id_plato, cantidad, ...extra,
});

async function mesaConDos(s, id = 1) {
  const ana = await s.conectar(tokenComensal(id));
  const beto = await s.conectar(tokenComensal(id));
  await emitir(ana, 'join:table', {});
  await emitir(beto, 'join:table', {});
  return { ana, beto };
}

test('cart:update sincroniza a los demás y el emisor recibe el snapshot en el ack', async () => {
  const s = await levantar();
  const { ana, beto } = await mesaConDos(s);
  const llega = esperar(beto, 'cart:updated');
  const evento = set('Ana', 3, 2, { notas: 'sin cebolla' });
  const ack = await emitir(ana, 'cart:update', evento);
  assert.strictEqual(ack.ok, true);
  assert.deepStrictEqual(ack.carrito.items, [
    { id_linea: evento.id_linea, comensal: 'Ana', id_plato: 3, cantidad: 2, notas: 'sin cebolla' },
  ]);
  const ev = await llega;
  assert.strictEqual(ev.carrito.version, 1);
  assert.strictEqual(ev.origen, 'Ana');
  await s.cerrar();
});

test('idempotencia: reenviar el mismo eventId no duplica ni sube la versión', async () => {
  const s = await levantar();
  const { ana, beto } = await mesaConDos(s);
  const evento = set('Ana', 3, 2);
  const primero = esperar(beto, 'cart:updated');
  const a1 = await emitir(ana, 'cart:update', evento);
  await primero;
  const repetido = esperar(beto, 'cart:updated', 300);
  const a2 = await emitir(ana, 'cart:update', evento);
  assert.deepStrictEqual([a1.duplicado, a2.duplicado], [false, true]);
  assert.strictEqual(a2.carrito.version, a1.carrito.version);
  assert.strictEqual(a2.carrito.items.length, 1);
  assert.strictEqual(await repetido, null, 'los demás no reciben un segundo cart:updated');
  await s.cerrar();
});

test('reconexión: el snapshot del join:table reemplaza el estado sin duplicar', async () => {
  const s = await levantar();
  const { ana, beto } = await mesaConDos(s);
  await emitir(ana, 'cart:update', set('Ana', 3, 2));
  const eventoBeto = set('Beto', 4, 1);
  await emitir(beto, 'cart:update', eventoBeto);
  beto.close(); // Beto se desconecta y vuelve con un socket nuevo
  const beto2 = await s.conectar(tokenComensal(1));
  const join = await emitir(beto2, 'join:table', {});
  assert.strictEqual(join.carrito.items.length, 2);
  // Reenvía lo que creía no entregado: mismo eventId → no se duplica.
  const ack = await emitir(beto2, 'cart:update', eventoBeto);
  assert.strictEqual(ack.duplicado, true);
  assert.strictEqual(ack.carrito.items.length, 2);
  await s.cerrar();
});

test('set fija cantidad absoluta; remove y clear', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s);
  const primero = set('Ana', 3, 2);
  await emitir(ana, 'cart:update', primero);
  // mismo id_linea: es una edición de esa línea, no un ítem nuevo
  const b = await emitir(ana, 'cart:update', set('Ana', 3, 5, { id_linea: primero.id_linea }));
  assert.deepStrictEqual(b.carrito.items.map((i) => i.cantidad), [5]);
  const c = await emitir(ana, 'cart:update', {
    eventId: randomUUID(), accion: 'remove', comensal: 'Ana', id_linea: primero.id_linea,
  });
  assert.strictEqual(c.carrito.items.length, 0);
  await emitir(ana, 'cart:update', set('Ana', 1, 1));
  // clear es del personal, no del comensal (ver el test dedicado más abajo)
  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'join:table', { id_mesa: 1 });
  const d = await emitir(mesero, 'cart:update', { eventId: randomUUID(), accion: 'clear', id_mesa: 1 });
  assert.strictEqual(d.carrito.items.length, 0);
  await s.cerrar();
});

test('clear: el comensal no puede vaciar el carrito de la mesa; el personal sí', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s);
  await emitir(ana, 'cart:update', set('Ana', 3, 1));
  const rechazado = await emitir(ana, 'cart:update', { eventId: randomUUID(), accion: 'clear' });
  assert.strictEqual(rechazado.codigo, 'NO_AUTORIZADO');
  assert.strictEqual(s.carritos.snapshot(1).items.length, 1); // el carrito queda intacto

  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'join:table', { id_mesa: 1 });
  const ok = await emitir(mesero, 'cart:update', { eventId: randomUUID(), accion: 'clear', id_mesa: 1 });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(s.carritos.snapshot(1).items.length, 0);
  await s.cerrar();
});

test('mismo comensal y mismo plato con distinto id_linea: conviven dos líneas', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s);
  await emitir(ana, 'cart:update', set('Ana', 3, 1, { notas: 'término medio' }));
  const b = await emitir(ana, 'cart:update', set('Ana', 3, 1, { notas: 'bien asada' }));
  assert.strictEqual(b.carrito.items.length, 2);
  assert.deepStrictEqual(b.carrito.items.map((i) => i.notas).sort(), ['bien asada', 'término medio']);
  await s.cerrar();
});

test('set con un id_linea existente reemplaza esa línea, no crea otra', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s);
  const primero = set('Ana', 3, 1, { notas: 'sin sal' });
  await emitir(ana, 'cart:update', primero);
  const editado = await emitir(ana, 'cart:update', set('Ana', 3, 4, { id_linea: primero.id_linea, notas: 'con sal' }));
  assert.strictEqual(editado.carrito.items.length, 1);
  assert.deepStrictEqual(editado.carrito.items[0], {
    id_linea: primero.id_linea, comensal: 'Ana', id_plato: 3, cantidad: 4, notas: 'con sal',
  });
  await s.cerrar();
});

test('remove por id_linea elimina solo esa línea', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s);
  const uno = set('Ana', 3, 1);
  const dos = set('Ana', 3, 1);
  await emitir(ana, 'cart:update', uno);
  await emitir(ana, 'cart:update', dos);
  const r = await emitir(ana, 'cart:update', {
    eventId: randomUUID(), accion: 'remove', comensal: 'Ana', id_linea: uno.id_linea,
  });
  assert.strictEqual(r.carrito.items.length, 1);
  assert.strictEqual(r.carrito.items[0].id_linea, dos.id_linea);
  await s.cerrar();
});

test('set o remove sin id_linea válido responde PAYLOAD_INVALIDO', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s);
  const sinLinea = set('Ana', 3, 1);
  delete sinLinea.id_linea;
  assert.strictEqual((await emitir(ana, 'cart:update', sinLinea)).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cart:update', set('Ana', 3, 1, { id_linea: 'no-es-uuid' }))).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cart:update', {
    eventId: randomUUID(), accion: 'remove', comensal: 'Ana', id_linea: 'no-es-uuid',
  })).codigo, 'PAYLOAD_INVALIDO');
  await s.cerrar();
});

test('aislamiento: el carrito de una mesa no se ve ni afecta a otra', async () => {
  const s = await levantar();
  const { ana } = await mesaConDos(s, 1);
  const otra = await s.conectar(tokenComensal(2));
  const join2 = await emitir(otra, 'join:table', {});
  const escucha = esperar(otra, 'cart:updated');
  await emitir(ana, 'cart:update', set('Ana', 3, 2));
  assert.strictEqual(await escucha, null);
  assert.deepStrictEqual(join2.carrito, { version: 0, items: [] });
  // Aunque mande id_mesa ajeno, no puede escribir en otra mesa.
  const ajeno = await emitir(ana, 'cart:update', set('Ana', 3, 2, { id_mesa: 2 }));
  assert.strictEqual(ajeno.codigo, 'NO_AUTORIZADO');
  await s.cerrar();
});

test('validaciones: sin join, eventId inválido, cantidad fuera de rango, rol no permitido', async () => {
  const s = await levantar();
  const ana = await s.conectar(tokenComensal(1));
  assert.strictEqual((await emitir(ana, 'cart:update', set('Ana', 3, 2))).codigo, 'SIN_SALA');
  await emitir(ana, 'join:table', {});
  assert.strictEqual((await emitir(ana, 'cart:update', { ...set('Ana', 3, 2), eventId: 'x' })).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cart:update', set('Ana', 3, 0))).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cart:update', set('Ana', 3, 100))).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cart:update', set('', 3, 1))).codigo, 'PAYLOAD_INVALIDO');
  assert.strictEqual((await emitir(ana, 'cart:update', { ...set('Ana', 3, 1), accion: 'explotar' })).codigo, 'PAYLOAD_INVALIDO');
  const cocina = await s.conectar(tokenPersonal('cocina'));
  assert.strictEqual((await emitir(cocina, 'cart:update', set('X', 1, 1, { id_mesa: 1 }))).codigo, 'NO_AUTORIZADO');
  // Un fallo de validación no consume el eventId: el mismo id ya corregido sí se aplica.
  const id = randomUUID();
  assert.strictEqual((await emitir(ana, 'cart:update', { ...set('Ana', 3, 0), eventId: id })).ok, false);
  assert.strictEqual((await emitir(ana, 'cart:update', { ...set('Ana', 3, 1), eventId: id })).duplicado, false);
  await s.cerrar();
});
