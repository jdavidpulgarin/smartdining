const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { io: cliente } = require('socket.io-client');
const { levantar, emitir, tokenComensal, tokenPantalla, tokenPersonal } = require('./helpers');
const { MAX_BUFFER_BYTES } = require('../src/limites');
const { backendFalso, sinRespuesta } = require('./pagos-helpers');

const linea = () => ({ eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal: 'Ana', id_plato: 1, cantidad: 1 });

test('ráfaga: más de 20 eventos en 1 s reciben RATE_LIMIT y no se procesan', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  const acks = await Promise.all(Array.from({ length: 30 }, () => emitir(ana, 'cart:update', linea())));
  const limitados = acks.filter((a) => a.codigo === 'RATE_LIMIT').length;
  assert.ok(limitados >= 9, `limitados: ${limitados}`);
  // join:table también contó dentro de la ventana: aceptados + limitados = 30.
  const items = (await s.carritos.snapshot(5)).items.length;
  assert.strictEqual(items, 30 - limitados);
  assert.ok(items <= 20);
});

test('ventana deslizante: pasado 1 s el cupo se recupera', async (t) => {
  const reloj = { t: 0 };
  const s = await levantar({}, { limiteEventos: { max: 3, ahora: () => reloj.t } });
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {}); // 1
  reloj.t = 600;
  await emitir(ana, 'cart:update', linea()); // 2
  await emitir(ana, 'cart:update', linea()); // 3
  assert.strictEqual((await emitir(ana, 'cart:update', linea())).codigo, 'RATE_LIMIT');
  reloj.t = 1001; // salió el join (t=0) de la ventana, quedan 2
  assert.strictEqual((await emitir(ana, 'cart:update', linea())).ok, true);
  assert.strictEqual((await emitir(ana, 'cart:update', linea())).codigo, 'RATE_LIMIT');
  reloj.t = 1601; // salieron los de t=600
  assert.strictEqual((await emitir(ana, 'cart:update', linea())).ok, true);
});

test('el límite es por socket: otro comensal de la misma mesa no se ve afectado', async (t) => {
  const s = await levantar({}, { limiteEventos: { max: 2 } });
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  const beto = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  await emitir(ana, 'cart:update', linea());
  assert.strictEqual((await emitir(ana, 'cart:update', linea())).codigo, 'RATE_LIMIT');
  assert.strictEqual((await emitir(beto, 'join:table', {})).ok, true);
});

test('un mensaje de más de 16 KB se rechaza y corta esa conexión', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar());
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  const corte = new Promise((r) => ana.once('disconnect', r));
  ana.emit('cart:update', { ...linea(), notas: 'x'.repeat(MAX_BUFFER_BYTES + 100) }, () => {});
  assert.strictEqual(await corte, 'transport close');
  assert.strictEqual((await s.carritos.snapshot(5)).items.length, 0);
});

test('conexiones por mesa: capacidad del backend + 4; pantalla y personal no cuentan', async (t) => {
  const backend = backendFalso({ 'GET /api/mesas/5': () => ({ status: 200, cuerpo: { id_mesa: 5, capacidad: 2 } }) });
  const s = await levantar({}, { backend });
  t.after(() => s.cerrar());
  const conectados = [];
  for (let i = 0; i < 6; i += 1) conectados.push(await s.conectar(tokenComensal(5)));
  await assert.rejects(s.conectar(tokenComensal(5)), { message: 'MESA_LLENA' });
  await s.conectar(tokenPantalla(5));
  await s.conectar(tokenPersonal('mesero'));
  await s.conectar(tokenComensal(6)); // otra mesa: su propio cupo
  assert.strictEqual(s.limiteMesas.conectados(5), 6);
  // Al irse uno, entra otro.
  const se = new Promise((r) => setTimeout(r, 100));
  conectados[0].close();
  await se;
  assert.strictEqual(s.limiteMesas.conectados(5), 5);
  await s.conectar(tokenComensal(5));
  assert.strictEqual(backend.llamadas.filter((l) => l.ruta === '/api/mesas/5').length, 1, 'capacidad en caché');
});

test('sin backend (o caído) se usa MESA_CAPACIDAD_POR_DEFECTO', async (t) => {
  const backend = backendFalso({ 'GET /api/mesas/5': () => sinRespuesta() });
  const s = await levantar({ MESA_CAPACIDAD_POR_DEFECTO: '1' }, { backend });
  t.after(() => s.cerrar());
  for (let i = 0; i < 5; i += 1) await s.conectar(tokenComensal(5));
  await assert.rejects(s.conectar(tokenComensal(5)), { message: 'MESA_LLENA' });
});

test('una capacidad absurda del backend se ignora', async (t) => {
  const backend = backendFalso({ 'GET /api/mesas/5': () => ({ status: 200, cuerpo: { capacidad: 100000 } }) });
  const s = await levantar({}, { backend });
  t.after(() => s.cerrar());
  assert.strictEqual(await s.limiteMesas.capacidadDe(5), 6);
});
