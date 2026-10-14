// R-18: el alias del comensal sale SOLO de su JWT (lo firma el backend).
// Cada prueba es un intento concreto de hacerse pasar por otro comensal.
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, esperar, tokenComensal, tokenPersonal, firmar,
} = require('./helpers');
const { WOMPI_ENV, cuenta, backendFalso, pasarelaFalsa } = require('./pagos-helpers');
const { aplicarOperacion, CARRITO_VACIO } = require('../src/carrito');
const { crearAlmacenCarritosRedis } = require('../src/almacen/carritos-redis');
const { crearRedisFalso } = require('./redis-falso');

const linea = (extra = {}) => ({
  eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), id_plato: 3, cantidad: 1, ...extra,
});

/** Mesa 5 con Ana y Beto sentados, cada uno con su JWT. */
async function mesa(t, env = {}, deps = {}) {
  const s = await levantar(env, deps);
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5, 'Ana'));
  const beto = await s.conectar(tokenComensal(5, 'Beto'));
  await emitir(ana, 'join:table', {});
  await emitir(beto, 'join:table', {});
  return { s, ana, beto };
}

// --- Sesiones antiguas (sin alias en el JWT) --------------------------------

test('JWT de comensal sin alias: no conecta (TOKEN_INVALIDO) y por HTTP responde 401 TOKEN_INVALIDO', async (t) => {
  const s = await levantar(WOMPI_ENV, { backend: backendFalso({}), pasarela: pasarelaFalsa({}).pasarela });
  t.after(() => s.cerrar());
  const antiguo = firmar({ id_mesa: 5, rol: 'comensal' });
  await assert.rejects(s.conectar(antiguo), { message: 'TOKEN_INVALIDO' });
  for (const malo of ['', '   ', 'x'.repeat(41), 7]) {
    await assert.rejects(s.conectar(firmar({ id_mesa: 5, rol: 'comensal', comensal: malo })), { message: 'TOKEN_INVALIDO' }, String(malo));
  }
  const post = (ruta, cuerpo) => fetch(`${s.url}${ruta}`, {
    method: 'POST', headers: { Authorization: `Bearer ${antiguo}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  for (const [ruta, cuerpo] of [['/pagos/intencion', { modo: 'total', eventId: randomUUID() }], ['/push/suscripcion', { subscription: {} }]]) {
    const r = await post(ruta, cuerpo);
    assert.deepStrictEqual([r.status, (await r.json()).codigo], [401, 'TOKEN_INVALIDO'], ruta);
  }
});

// --- Carrito -----------------------------------------------------------------

test('carrito: Beto no puede agregar una línea a nombre de Ana', async (t) => {
  const { s, beto } = await mesa(t);
  const ack = await emitir(beto, 'cart:update', linea({ comensal: 'Ana' }));
  assert.strictEqual(ack.codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await s.carritos.snapshot(5)).items.length, 0);
});

test('carrito: sin `comensal`, la línea queda a nombre del alias del JWT', async (t) => {
  const { ana, beto } = await mesa(t);
  const llega = esperar(ana, 'cart:updated');
  const ack = await emitir(beto, 'cart:update', linea());
  assert.strictEqual(ack.ok, true);
  assert.strictEqual(ack.carrito.items[0].comensal, 'Beto');
  assert.strictEqual((await llega).origen, 'Beto');
});

test('carrito: Beto no puede editar ni quitar la línea de Ana (aunque conozca su id_linea)', async (t) => {
  const { s, ana, beto } = await mesa(t);
  const deAna = linea({ cantidad: 2, notas: 'sin cebolla' });
  await emitir(ana, 'cart:update', deAna);
  const antes = await s.carritos.snapshot(5);

  const editar = await emitir(beto, 'cart:update', { ...deAna, eventId: randomUUID(), cantidad: 99 });
  const quitar = await emitir(beto, 'cart:update', { eventId: randomUUID(), accion: 'remove', id_linea: deAna.id_linea });
  const robar = await emitir(beto, 'cart:update', { ...deAna, eventId: randomUUID(), comensal: 'Beto' });
  assert.deepStrictEqual([editar.codigo, quitar.codigo, robar.codigo], ['NO_AUTORIZADO', 'NO_AUTORIZADO', 'NO_AUTORIZADO']);
  assert.deepStrictEqual(await s.carritos.snapshot(5), antes, 'el carrito no cambió');

  // Ana sí puede editar y quitar la suya.
  assert.strictEqual((await emitir(ana, 'cart:update', { ...deAna, eventId: randomUUID(), cantidad: 3 })).ok, true);
  assert.strictEqual((await emitir(ana, 'cart:update', { eventId: randomUUID(), accion: 'remove', id_linea: deAna.id_linea })).ok, true);
});

test('carrito: el rechazo no consume el eventId (corregido, el mismo id se aplica)', async (t) => {
  const { beto } = await mesa(t);
  const ev = linea({ comensal: 'Ana' });
  assert.strictEqual((await emitir(beto, 'cart:update', ev)).codigo, 'NO_AUTORIZADO');
  const ok = await emitir(beto, 'cart:update', { ...ev, comensal: 'Beto' });
  assert.deepStrictEqual([ok.ok, ok.duplicado], [true, false]);
});

test('carrito: el mesero sí puede corregir la línea de cualquier comensal', async (t) => {
  const { s, ana } = await mesa(t);
  const deAna = linea();
  await emitir(ana, 'cart:update', deAna);
  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'join:table', { id_mesa: 5 });
  const ack = await emitir(mesero, 'cart:update', { ...deAna, eventId: randomUUID(), id_mesa: 5, comensal: 'Ana', cantidad: 4 });
  assert.strictEqual(ack.ok, true);
  assert.deepStrictEqual(ack.carrito.items.map((i) => [i.comensal, i.cantidad]), [['Ana', 4]]);
});

test('carrito: la regla de dueño vive en la operación atómica (memoria y Redis)', async () => {
  const conLinea = aplicarOperacion(CARRITO_VACIO, { accion: 'set', id_linea: 'l1', comensal: 'Ana', id_plato: 1, cantidad: 1 }).carrito;
  for (const accion of ['set', 'remove']) {
    assert.deepStrictEqual(
      aplicarOperacion(conLinea, { accion, id_linea: 'l1', comensal: 'Beto', id_plato: 1, cantidad: 9, soloDe: 'Beto' }),
      { error: 'Esa línea es de otro comensal', codigo: 'NO_AUTORIZADO' },
    );
  }
  // Sin soloDe (personal) se puede editar.
  assert.strictEqual(aplicarOperacion(conLinea, { accion: 'set', id_linea: 'l1', comensal: 'Ana', id_plato: 1, cantidad: 9 }).carrito.items[0].cantidad, 9);

  const redis = crearAlmacenCarritosRedis({ cliente: crearRedisFalso().cliente });
  await redis.aplicarUnaVez(7, { accion: 'set', id_linea: 'l1', comensal: 'Ana', id_plato: 1, cantidad: 1, soloDe: 'Ana' }, 'a');
  const r = await redis.aplicarUnaVez(7, { accion: 'remove', id_linea: 'l1', comensal: 'Beto', soloDe: 'Beto' }, 'b');
  assert.strictEqual(r.codigo, 'NO_AUTORIZADO');
  assert.strictEqual((await redis.snapshot(7)).items.length, 1);
});

// --- Sala, presencia y push -------------------------------------------------

test('sala: llamar al mesero y pedir la cuenta llevan el alias del JWT, no el del payload', async (t) => {
  const { s, beto } = await mesa(t);
  const panel = await s.conectar(tokenPersonal('mesero'));
  const llamada = esperar(panel, 'mesa:llamar_mesero');
  await emitir(beto, 'mesa:llamar_mesero', { eventId: randomUUID(), comensal: 'Ana' });
  assert.strictEqual((await llamada).comensal, 'Beto');
  const cuentaPedida = esperar(panel, 'cuenta:solicitada');
  await emitir(beto, 'cuenta:solicitada', { eventId: randomUUID(), comensal: 'Ana' });
  assert.strictEqual((await cuentaPedida).comensal, 'Beto');
});

test('presencia: un join:table con otro alias se rechaza; el panel ve los alias de los JWT', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  const panel = await s.conectar(tokenPersonal('mesero'));
  const beto = await s.conectar(tokenComensal(5, 'Beto'));
  assert.strictEqual((await emitir(beto, 'join:table', { comensal: 'Ana' })).codigo, 'NO_AUTORIZADO');
  const llega = esperar(panel, 'mesa:presencia');
  assert.strictEqual((await emitir(beto, 'join:table', { comensal: 'Beto' })).ok, true);
  assert.deepStrictEqual((await llega).comensales, ['Beto']);
});

test('push: la suscripción queda a nombre del alias del JWT; por HTTP no se puede pedir la de otro', async (t) => {
  const push = { habilitado: true, clavePublica: 'x', enviar: async () => ({ ok: true }) };
  const { s, beto } = await mesa(t, {}, { push });
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/beto', keys: { p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  assert.strictEqual((await emitir(beto, 'push:subscribe', { eventId: randomUUID(), subscription: sub, comensal: 'Ana' })).ok, true);
  assert.deepStrictEqual((await s.suscripciones.listar(5)).map((x) => x.comensal), ['Beto'], 'el payload no decide');
  const r = await fetch(`${s.url}/push/suscripcion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenComensal(5, 'Beto')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: { ...sub, endpoint: 'https://fcm.googleapis.com/fcm/send/otra' }, comensal: 'Ana' }),
  });
  assert.strictEqual(r.status, 403);
});

// --- Pagos -------------------------------------------------------------------

test('pago: Beto no puede pagar "lo propio" de Ana; sin `comensal` paga lo suyo', async (t) => {
  const backend = backendFalso({
    'GET /api/mesas/5/cuenta/interno': () => ({ status: 200, cuerpo: cuenta(5, 9_000_000, 9_000_000, { Ana: 4_000_000, Beto: 5_000_000 }) }),
  });
  const { s } = await mesa(t, WOMPI_ENV, { backend, pasarela: pasarelaFalsa({}).pasarela });
  const pagar = (cuerpo) => fetch(`${s.url}/pagos/intencion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenComensal(5, 'Beto')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventId: randomUUID(), modo: 'propio', ...cuerpo }),
  });
  const comoAna = await pagar({ comensal: 'Ana' });
  assert.deepStrictEqual([comoAna.status, (await comoAna.json()).codigo], [403, 'NO_AUTORIZADO']);
  const propio = await pagar({});
  assert.strictEqual(propio.status, 201);
  const intencion = await s.almacenPagos.obtener((await propio.json()).referencia);
  assert.deepStrictEqual([intencion.comensal, intencion.monto_centavos], ['Beto', 5_000_000]);
});
