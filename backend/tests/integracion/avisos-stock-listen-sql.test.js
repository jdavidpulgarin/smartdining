const test = require('node:test');
const assert = require('node:assert');

/**
 * Avisos de stock contra PostgreSQL REAL: el oyente del canal `inventario`
 * (services/inventario-avisos.js) con su conexión LISTEN de verdad, el
 * notificador real y un socket-server doble (tests/helpers/fake-socket.js).
 *
 * Comprueba que los avisos que ya funcionaban siguen igual ahora que pasan por
 * la cola (services/avisos-stock-cola.js), y el "último gana" de punta a
 * punta: un "agotado" que no llegó no puede pisar un "repuesto" posterior.
 *
 * DATOS PROPIOS: el catálogo de tests/helpers/plato-prueba.js (plato con receta
 * sobre un insumo propio). El stock se mueve con registrar_movimiento_inventario
 * 'ajuste', como en la operación real. El `after` lo borra todo.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.REDIS_URL = '';

const { abrirSonda } = require('../helpers/base-prueba');
const { instalarFakeSocket } = require('../helpers/fake-socket');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');
const avisos = require('../../src/services/inventario-avisos');
const { crearColaAvisos } = require('../../src/services/avisos-stock-cola');
const pool = require('../../src/config/db');

const RUTA_PLATO = '/internal/plato-disponibilidad';
const ESPERA_MAX_MS = 10000;

let sonda = null;
let hayBase = false;
let catalogo = null;
let socket = null;
let socketCaido = false;
const temporizadores = [];
let cola = null;

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  catalogo = await crearCatalogoPrueba(sonda, 'avisos-stock-listen', { receta: true, precio: 10000 });

  // Socket-server doble: contesta bien, o falla como uno caído (error de red).
  socket = instalarFakeSocket(() => {
    if (socketCaido) {
      const err = new TypeError('fetch failed');
      err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return err;
    }
    return { ok: true };
  });

  // Cola con reloj falso: los reintentos se disparan a mano.
  cola = crearColaAvisos({
    reintentos: true,
    aleatorio: () => 0.5,
    programar: (fn, ms) => {
      const t = { fn, ms, vivo: true };
      temporizadores.push(t);
      return t;
    },
    cancelar: (t) => {
      if (t) t.vivo = false;
    },
  });

  // Conexión LISTEN real (misma configuración PG* que el pool) y la carta
  // inicial, como en el arranque del servidor.
  await avisos.iniciar({ cola });
  hayBase = true;
});

test.after(async () => {
  try {
    await avisos.detener();
    if (socket) socket.restaurar();
    if (hayBase) await catalogo.limpiar();
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

const saltar = (t) => {
  if (!hayBase) {
    t.skip('sin base de datos');
    return true;
  }
  return false;
};

/** Deja el stock del insumo en `valor` con un movimiento de ajuste. */
async function fijarStock(valor) {
  const { rows } = await sonda.query('SELECT stock_actual FROM insumos WHERE id_insumo = $1::int', [catalogo.idInsumo]);
  const delta = valor - Number(rows[0].stock_actual);
  if (delta !== 0) {
    await sonda.query(
      'SELECT registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)',
      [catalogo.idInsumo, 'ajuste', delta, `${catalogo.marca} prueba`]
    );
  }
}

/** Los avisos del plato propio que vio el socket-server doble. */
const delPlato = () =>
  socket.todos(RUTA_PLATO).filter((a) => a.cuerpo.id_plato === catalogo.plato.id_plato);

/** Espera (sondeando) a que se cumpla la condición; el NOTIFY llega por la red. */
async function hasta(condicion, que) {
  const limite = Date.now() + ESPERA_MAX_MS;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error(`no llego a tiempo: ${que}`);
    await new Promise((r) => setTimeout(r, 25));
  }
  await cola.drenar();
}

test('al arrancar se emite la carta, con el plato propio disponible', async (t) => {
  if (saltar(t)) return;
  await avisos.esperarCiclo();
  const enCarta = delPlato();
  assert.ok(enCarta.length >= 1, 'el plato propio salio en la carta inicial');
  assert.strictEqual(enCarta[enCarta.length - 1].cuerpo.disponible, true);
});

test('agotar por stock llega como plato:disponibilidad false; reponer, como true', async (t) => {
  if (saltar(t)) return;
  const antes = delPlato().length;

  await fijarStock(0);
  await hasta(() => delPlato().length > antes, 'el agotado');
  assert.strictEqual(delPlato().at(-1).cuerpo.disponible, false);

  const tras = delPlato().length;
  await fijarStock(50);
  await hasta(() => delPlato().length > tras, 'el repuesto');
  assert.strictEqual(delPlato().at(-1).cuerpo.disponible, true);
});

test('el ultimo gana: un agotado que no llego no pisa el repuesto posterior', async (t) => {
  if (saltar(t)) return;
  const antes = delPlato().length;

  // El socket-server se cae y el plato se agota: el aviso falla y queda en cola.
  socketCaido = true;
  await fijarStock(0);
  await hasta(() => delPlato().length > antes, 'el intento del agotado');
  assert.deepStrictEqual(cola.estado().pendientes.filter((c) => c === `plato:${catalogo.plato.id_plato}`).length, 1);

  // Vuelve el socket-server y llega el repuesto: sale en el acto.
  socketCaido = false;
  const tras = delPlato().length;
  await fijarStock(50);
  await hasta(() => delPlato().length > tras, 'el repuesto');

  // Y aunque se disparen todos los reintentos que quedaran, el agotado no vuelve.
  for (const temporizador of temporizadores.filter((x) => x.vivo)) {
    temporizador.vivo = false;
    temporizador.fn();
  }
  await cola.drenar();

  const exitosos = delPlato().slice(tras);
  assert.ok(exitosos.length >= 1);
  assert.strictEqual(exitosos.at(-1).cuerpo.disponible, true, 'lo ultimo que llega es el repuesto');
  assert.ok(!exitosos.some((a) => a.cuerpo.disponible === false), 'el agotado viejo no se reenvio');
  assert.ok(!cola.estado().pendientes.includes(`plato:${catalogo.plato.id_plato}`));
});
