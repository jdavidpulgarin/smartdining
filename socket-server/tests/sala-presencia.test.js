const test = require('node:test');
const assert = require('node:assert');
const { levantar, emitir, esperar, tokenComensal, tokenPersonal } = require('./helpers');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
/** Junta todos los mesa:presencia que reciba el socket. */
const recolectar = (socket) => {
  const lista = [];
  socket.on('mesa:presencia', (p) => lista.push(p));
  return lista;
};

async function escenario(t, ventanaMs = 100) {
  const s = await levantar({}, { presencia: { ventanaMs } });
  t.after(() => s.cerrar());
  const admin = await s.conectar(tokenPersonal('admin'));
  return { s, admin };
}

test('join con alias: el panel recibe los comensales presentes y el total', async (t) => {
  const { s, admin } = await escenario(t);
  const llega = esperar(admin, 'mesa:presencia');
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', { comensal: '  Ana ' });
  assert.deepStrictEqual(await llega, { id_mesa: 5, comensales: ['Ana'], total: 1 });
});

test('leave y disconnect actualizan la presencia (último estado siempre llega)', async (t) => {
  const { s, admin } = await escenario(t);
  const vistos = recolectar(admin);
  const ana = await s.conectar(tokenComensal(5));
  const beto = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', { comensal: 'Ana' });
  await emitir(beto, 'join:table', { comensal: 'Beto' });
  await pausa(250);
  assert.deepStrictEqual(vistos.at(-1), { id_mesa: 5, comensales: ['Ana', 'Beto'], total: 2 });
  await emitir(beto, 'leave:table', {});
  await pausa(250);
  assert.deepStrictEqual(vistos.at(-1).comensales, ['Ana']);
  ana.close();
  await pausa(250);
  assert.deepStrictEqual(vistos.at(-1), { id_mesa: 5, comensales: [], total: 0 });
});

test('límite de frecuencia: muchas entradas seguidas producen pocos avisos', async (t) => {
  const { s, admin } = await escenario(t, 300);
  const vistos = recolectar(admin);
  const sockets = [];
  for (let i = 0; i < 6; i += 1) sockets.push(await s.conectar(tokenComensal(5)));
  await Promise.all(sockets.map((c, i) => emitir(c, 'join:table', { comensal: `C${i}` })));
  await pausa(100);
  assert.strictEqual(vistos.length, 1, 'dentro de la ventana solo sale el primero');
  await pausa(400);
  assert.strictEqual(vistos.length, 2, 'al cerrar la ventana sale el pendiente');
  assert.strictEqual(vistos.at(-1).total, 6);
});

test('alias repetido cuenta una persona; sin alias cuenta cada socket', async (t) => {
  const { s, admin } = await escenario(t);
  const vistos = recolectar(admin);
  for (const alias of ['Ana', 'Ana', undefined]) {
    const c = await s.conectar(tokenComensal(5));
    await emitir(c, 'join:table', alias ? { comensal: alias } : {});
  }
  await pausa(250);
  assert.deepStrictEqual(vistos.at(-1), { id_mesa: 5, comensales: ['Ana'], total: 2 });
  assert.deepStrictEqual(await s.presencia.calcular(5), vistos.at(-1));
});

test('alias inválido responde PAYLOAD_INVALIDO y no entra a la sala', async (t) => {
  const { s } = await escenario(t);
  const ana = await s.conectar(tokenComensal(5));
  for (const malo of ['', '   ', 'x'.repeat(41), 7, null]) {
    assert.strictEqual((await emitir(ana, 'join:table', { comensal: malo })).codigo, 'PAYLOAD_INVALIDO');
  }
  assert.strictEqual(s.io.sockets.adapter.rooms.get('room:mesa-5'), undefined);
});

test('rol: el personal no cuenta como comensal; los comensales no reciben presencia', async (t) => {
  const { s, admin } = await escenario(t);
  const vistos = recolectar(admin);
  const mesero = await s.conectar(tokenPersonal('mesero'));
  await emitir(mesero, 'join:table', { id_mesa: 5, comensal: 'Mesero' });
  const ana = await s.conectar(tokenComensal(5));
  const enAna = esperar(ana, 'mesa:presencia', 300);
  await emitir(ana, 'join:table', { comensal: 'Ana' });
  await pausa(250);
  assert.deepStrictEqual(vistos.at(-1).comensales, ['Ana']);
  assert.strictEqual(await enAna, null);
});

test('aislamiento: la presencia de una mesa no mezcla la de otra', async (t) => {
  const { s, admin } = await escenario(t);
  const vistos = recolectar(admin);
  const a = await s.conectar(tokenComensal(5));
  const b = await s.conectar(tokenComensal(6));
  await emitir(a, 'join:table', { comensal: 'Ana' });
  await emitir(b, 'join:table', { comensal: 'Beto' });
  await pausa(250);
  const ultimaDe = (m) => vistos.filter((p) => p.id_mesa === m).at(-1);
  assert.deepStrictEqual(ultimaDe(5).comensales, ['Ana']);
  assert.deepStrictEqual(ultimaDe(6).comensales, ['Beto']);
});
