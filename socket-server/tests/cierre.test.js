const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  levantar, emitir, tokenComensal, ENV_BASE, ORIGEN, CLAVE_INTERNA,
} = require('./helpers');
const { crearCierreOrdenado, crearEnCurso } = require('../src/cierre');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = {
  info() {}, warn() {}, error() {},
};
const linea = () => ({ eventId: randomUUID(), accion: 'set', id_linea: randomUUID(), comensal: 'Ana', id_plato: 1, cantidad: 1 });

test('enCurso: esperarVacio resuelve al terminar o al vencer el plazo', async () => {
  const t = crearEnCurso();
  assert.strictEqual(await t.esperarVacio(10), true);
  t.iniciar();
  const espera = t.esperarVacio(1000);
  setTimeout(() => t.terminar(), 20);
  assert.strictEqual(await espera, true);
  t.iniciar();
  assert.strictEqual(await t.esperarVacio(30), false);
});

test('cierre: espera el ack en curso, rechaza lo nuevo y cierra Redis', async (t) => {
  const falso = crearRedisFalso();
  let redisCerrado = false;
  falso.cliente.quit = async () => { redisCerrado = true; };
  const redis = crearConexionRedis({ url: 'redis://x:6379', crearCliente: falso.crearCliente, log: silencioso });
  const s = await levantar({}, { redis });
  t.after(() => s.cerrar().catch(() => {}));

  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  // Un cart:update lento queda "en curso" cuando llega la señal.
  const original = s.carritos.aplicarUnaVez;
  s.carritos.aplicarUnaVez = async (...args) => {
    await new Promise((r) => setTimeout(r, 300));
    return original(...args);
  };
  const lento = emitir(ana, 'cart:update', linea());
  await new Promise((r) => setTimeout(r, 50));

  const cierre = crearCierreOrdenado({ httpServer: s.httpServer, io: s.io, ctx: s.ctx, log: silencioso });
  const cerrando = cierre.cerrar('SIGTERM');
  assert.strictEqual(cierre.cerrar('SIGINT'), cerrando, 'dos señales comparten el mismo cierre');

  // Lo nuevo se rechaza mientras se espera lo que está en curso.
  const r = await fetch(`${s.url}/internal/order-status`, {
    method: 'POST', headers: { 'x-internal-key': CLAVE_INTERNA }, body: JSON.stringify({}),
  }).catch(() => ({ status: 'sin conexión' }));
  assert.ok([503, 'sin conexión'].includes(r.status), `petición nueva: ${r.status}`);

  const desconectada = new Promise((r) => ana.once('disconnect', r));
  const ack = await lento;
  assert.strictEqual(ack.ok, true, 'el ack en curso se entregó antes de cerrar');
  const resultado = await cerrando;
  assert.strictEqual(resultado.vacio, true);
  assert.strictEqual(redisCerrado, true);
  await desconectada; // los sockets se cierran al final, después del ack
});

test('cierre: no espera más del plazo si un manejador se cuelga', async (t) => {
  const s = await levantar();
  t.after(() => s.cerrar().catch(() => {}));
  const ana = await s.conectar(tokenComensal(5));
  await emitir(ana, 'join:table', {});
  s.carritos.aplicarUnaVez = () => new Promise(() => {}); // nunca responde
  ana.emit('cart:update', linea(), () => {});
  await new Promise((r) => setTimeout(r, 50));
  const inicio = Date.now();
  const { vacio } = await crearCierreOrdenado({
    httpServer: s.httpServer, io: s.io, ctx: s.ctx, esperaMaxMs: 200, log: silencioso,
  }).cerrar('SIGTERM');
  assert.strictEqual(vacio, false);
  assert.ok(Date.now() - inicio < 2000);
});

test('proceso real: SIGTERM termina con código 0 y deja de escuchar', { skip: process.platform === 'win32' && 'Windows no entrega SIGTERM a un proceso hijo de node' }, async () => {
  const hijo = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, CORS_ORIGINS: ORIGEN, ...ENV_BASE, PORT: '0', LOG_NIVEL: 'info' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    hijo.stdout.on('data', (d) => { if (String(d).includes('socket-server escuchando')) resolve(); });
    hijo.once('exit', () => reject(new Error('el servidor terminó antes de escuchar')));
  });
  hijo.kill('SIGTERM');
  const codigo = await new Promise((r) => hijo.once('exit', r));
  assert.strictEqual(codigo, 0);
});
