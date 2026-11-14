const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { io: cliente } = require('socket.io-client');
const {
  levantar, emitir, esperar, tokenComensal,
} = require('./helpers');

// Regresión de seguridad (T1): con connectionStateRecovery, Socket.io
// recuperaba la sesión SIN pasar por los middlewares (skipMiddlewares) y le
// devolvía sus salas. Un celular sin red mientras se liberaba su mesa volvía
// dentro de room:mesa-N y leía y escribía el carrito del grupo siguiente.
// Ahora cada reconexión se autentica de cero y ese JWT se rechaza.

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const lineaSet = (extra = {}) => ({
  eventId: crypto.randomUUID(), accion: 'set', id_linea: crypto.randomUUID(), id_plato: 3, cantidad: 1, ...extra,
});

test('el servidor no activa connectionStateRecovery', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  assert.strictEqual(s.io.opts.connectionStateRecovery, undefined);
});

test('un celular del grupo anterior que vuelve tras liberar la mesa NO entra a la sala ni ve ni toca el carrito', async (t) => {
  const s = await levantar({ PRESENCIA_GRACIA_MS: '0' });
  const viejos = [];
  t.after(async () => { viejos.forEach((c) => c.close()); await s.cerrar(); });

  // Ana, del grupo que se va, con la reconexión automática de la PWA.
  const tokenViejo = tokenComensal(1, 'Ana', { iat: Math.floor(Date.now() / 1000) - 5 });
  const ana = cliente(s.url, {
    auth: { token: tokenViejo }, transports: ['websocket'], reconnectionDelay: 100, reconnectionDelayMax: 100,
  });
  viejos.push(ana);
  await new Promise((r) => ana.once('connect', r));
  assert.strictEqual((await emitir(ana, 'join:table', {})).ok, true);
  const idAntes = ana.id;
  const recibidos = [];
  ana.onAny((evento) => recibidos.push(evento));

  // Se le cae la red (segundo plano) y, mientras tanto, la mesa se libera.
  const rechazo = new Promise((r) => ana.once('connect_error', r));
  ana.io.engine.close();
  await pausa(20);
  await s.ctx.liberarMesa(1, 'pagada');

  // Al volver, el handshake se autentica de cero: TOKEN_INVALIDO.
  assert.strictEqual((await rechazo).message, 'TOKEN_INVALIDO');
  ana.io.reconnection(false);
  assert.strictEqual(ana.connected, false);
  assert.ok(!ana.recovered, 'sin recuperación de sesión');
  const enSala = await s.io.in('room:mesa-1').fetchSockets();
  assert.ok(enSala.every((x) => x.id !== idAntes && x.data.identidad.comensal !== 'Ana'), 'Ana no queda en room:mesa-1');

  // El grupo siguiente arma su carrito: a Ana no le llega nada.
  s.ctx.reabrirMesa(1);
  const beto = await s.conectar(tokenComensal(1, 'Beto', { iat: Math.floor(Date.now() / 1000) + 2 }));
  const unirse = await emitir(beto, 'join:table', {});
  assert.strictEqual(unirse.ok, true);
  assert.strictEqual((await emitir(beto, 'cart:update', lineaSet({ notas: 'privado' }))).ok, true);
  await pausa(150);
  assert.ok(!recibidos.some((e) => e.startsWith('cart')), 'Ana no recibe el carrito del grupo siguiente');

  // Y no puede escribir en él: no tiene conexión, y un socket nuevo con su JWT se rechaza.
  await assert.rejects(s.conectar(tokenViejo), /TOKEN_INVALIDO/);
  const otroCarrito = await new Promise((r) => {
    beto.emit('join:table', {}, (ack) => r(ack.carrito));
  });
  assert.deepStrictEqual(otroCarrito.items.map((i) => i.comensal), ['Beto'], 'el carrito solo tiene lo de Beto');
});

test('un corte corto SIN liberar la mesa: reconecta como socket nuevo, vuelve a la sala con join:table y recibe el carrito', async (t) => {
  const s = await levantar();
  const otros = [];
  t.after(async () => { otros.forEach((c) => c.close()); await s.cerrar(); });

  const ana = cliente(s.url, {
    auth: { token: tokenComensal(2, 'Ana') }, transports: ['websocket'], reconnectionDelay: 100, reconnectionDelayMax: 100,
  });
  otros.push(ana);
  await new Promise((r) => ana.once('connect', r));
  await emitir(ana, 'join:table', {});
  const idAntes = ana.id;

  const beto = await s.conectar(tokenComensal(2, 'Beto'));
  await emitir(beto, 'join:table', {});

  const vuelve = new Promise((r) => ana.once('connect', r));
  ana.io.engine.close();
  await vuelve;
  assert.ok(!ana.recovered, 'sin recuperación de sesión');
  assert.notStrictEqual(ana.id, idAntes);

  // Sin join:table no está en la sala: no recibe lo de la mesa.
  const sinSala = esperar(ana, 'cart:updated', 200);
  await emitir(beto, 'cart:update', lineaSet());
  assert.strictEqual(await sinSala, null);

  // Lo que hace la PWA en cada connect (EVENTS.md §3.3): join:table y reemplazar el carrito.
  const r = await emitir(ana, 'join:table', {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.carrito.items.length, 1);
  assert.strictEqual((await emitir(ana, 'cart:update', lineaSet())).ok, true);
});
