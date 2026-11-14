// Lo compartido por presencia-inicial*.test.js. Se dividió en tres archivos
// (al conectar e índice, retraso real, mesa:presencia:solicitar) para que
// ninguno se acerque al límite de 10 s por archivo del CI (antes: 11,8 s).
const assert = require('node:assert');
const { randomUUID } = require('node:crypto');
const { io: cliente } = require('socket.io-client');
const {
  levantar, emitir, tokenComensal, tokenPantalla, CLAVE_INTERNA,
} = require('./helpers');
const { crearConexionRedis } = require('../src/almacen/redis');
const { crearEstadoMesasRedis, TTL_CUENTA_SEG } = require('../src/almacen/mesas-redis');
const { crearEstadoMesasMemoria } = require('../src/sala');
const { crearRedisFalso } = require('./redis-falso');

const silencioso = { info() {}, error() {} };
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const REDIS_URL = process.env.REDIS_URL;
const DIA_MS = TTL_CUENTA_SEG * 1000;
// Retraso corto para las pruebas que solo miran QUÉ llega (el real es 500 ms);
// las del retraso real están más abajo.
const RETRASO_PRUEBA_MS = 50;
// Lo que se espera que haya llegado: se espera bastante más que lo que tarda.
const ESPERA_MS = 300;
/** Espera (hasta 2 s) a que se cumpla `cond`: lo que debe llegar no depende de la carga de la máquina. */
async function hasta(cond, ms = 2000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await pausa(20); // eslint-disable-line no-await-in-loop
}

/**
 * Conecta con el listener de mesa:presencia YA puesto: el servidor la manda
 * justo al conectar y un listener agregado después del 'connect' podría
 * perderla (el panel real registra sus listeners antes de conectar).
 */
function conectarEscuchando(s, token) {
  const c = cliente(s.url, {
    auth: { token }, transports: ['websocket'], reconnection: false, autoConnect: false,
  });
  const recibidas = [];
  c.on('mesa:presencia', (p) => recibidas.push(p));
  return new Promise((resolve, reject) => {
    c.on('connect', () => resolve({ c, recibidas }));
    c.on('connect_error', reject);
    c.connect();
  });
}

const agregarSinCelular = (s, idMesa, alias) => fetch(`${s.url}/internal/mesa-comensal`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
  body: JSON.stringify({
    id_mesa: idMesa, alias, accion: 'agregar', eventId: randomUUID(),
  }),
});
const liberar = (s, idMesa) => fetch(`${s.url}/internal/mesa-liberada`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-key': CLAVE_INTERNA },
  body: JSON.stringify({ id_mesa: idMesa }),
});
/** Solo las mesas de esta prueba: en Redis real otras pruebas escriben a la vez. */
const deEstas = (recibidas, mesas) => recibidas.filter((p) => mesas.includes(p.id_mesa));

/**
 * Mesas (con ids propios de cada corrida para Redis real):
 * - A: Ana sentada con celular;
 * - B: un "sin celular" y NINGÚN socket (ni comensal ni tablet);
 * - C: alguien que pagó y ningún socket;
 * - D: solo la tablet conectada (mesa vacía o cerrada): no se envía.
 */
async function escenario(t, deps = {}, base = 10, retrasoInicialMs = RETRASO_PRUEBA_MS) {
  const s = await levantar({}, { presencia: { ventanaMs: 30, retrasoInicialMs }, ...deps });
  const mesas = { A: base + 1, B: base + 2, C: base + 3, D: base + 4 };
  const abiertos = [];
  t.after(async () => {
    for (const c of abiertos) c.close();
    for (const id of Object.values(mesas)) await s.estadoMesas.limpiarMesa(id);
    await s.cerrar();
  });
  const ana = await s.conectar(tokenComensal(mesas.A, 'Ana'));
  await emitir(ana, 'join:table', {});
  assert.strictEqual((await agregarSinCelular(s, mesas.B, 'Abuela')).status, 200);
  await s.estadoMesas.marcarPago(mesas.C, 'Beto');
  await s.conectar(tokenPantalla(mesas.D));
  await pausa(100); // se cierran las ventanas de presencia de los cambios de arriba
  const conectar = async (token) => {
    const r = await conectarEscuchando(s, token);
    abiertos.push(r.c);
    return r;
  };
  return { s, mesas, conectar };
}

const esperadas = (m) => [
  { id_mesa: m.A, comensales: ['Ana'], total: 1, pagaron: [], sin_celular: [] },
  { id_mesa: m.B, comensales: ['Abuela'], total: 1, pagaron: [], sin_celular: ['Abuela'] },
  { id_mesa: m.C, comensales: [], total: 0, pagaron: ['Beto'], sin_celular: [] },
];

const ALMACENES = {
  memoria: async () => ({}),
  'Redis falso': async () => {
    const falso = crearRedisFalso();
    const redis = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
    await redis.conectar();
    return { redis };
  },
};


function almacenesConReloj() {
  let ms = 1_000_000;
  const reloj = { ahora: () => ms, avanzar: (d) => { ms += d; } };
  const falso = crearRedisFalso({ ahora: reloj.ahora });
  const conexion = crearConexionRedis({ url: 'redis://falso:6379', crearCliente: falso.crearCliente, log: silencioso });
  return {
    reloj,
    memoria: crearEstadoMesasMemoria({ ahora: reloj.ahora }),
    redis: crearEstadoMesasRedis({ cliente: conexion.cliente, ahora: reloj.ahora }),
    conectar: () => conexion.conectar(),
  };
}

/**
 * Como el panel real: socket creado con autoConnect (useSocket.js) y listener
 * registrado DESPUÉS, en un useEffect (useSocketListener.js).
 */
async function abrirComoElPanel(s, token, listenerTrasMs) {
  const c = cliente(s.url, { auth: { token }, transports: ['websocket', 'polling'], reconnection: false });
  const recibidas = [];
  await pausa(listenerTrasMs);
  c.on('mesa:presencia', (p) => recibidas.push(p));
  return { c, recibidas };
}

/** Escenario sin envío automático en el tiempo de la prueba: solo se ve el ack. */
const escenarioSolicitar = (t, deps) => escenario(t, deps, 10, 60_000);

module.exports = {
  silencioso, pausa, REDIS_URL, DIA_MS, RETRASO_PRUEBA_MS, ESPERA_MS, hasta, conectarEscuchando, agregarSinCelular, liberar, deEstas,
  escenario, esperadas, ALMACENES, almacenesConReloj, abrirComoElPanel, escenarioSolicitar,
};
