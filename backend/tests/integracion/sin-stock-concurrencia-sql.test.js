const test = require('node:test');
const assert = require('node:assert');

/**
 * T5 (review de #236): 50 pedidos A LA VEZ por las últimas 10 porciones,
 * contra PostgreSQL REAL y con el pool de verdad del backend.
 *
 * El fallo que encontró Jarrison: el `disponible` del 409 sin_stock se leía
 * pidiendo OTRA conexión al pool mientras el pedido rechazado seguía con la
 * suya. Con 50 a la vez y `max` 10, las 10 conexiones quedaban en manos de
 * rechazos que esperaban una 11.ª, las peticiones en cola vencían el
 * connectionTimeout y salían 30 × 500. Ahora la lectura va por la conexión del
 * pedido, antes de soltarla.
 *
 * Se espera: 10 creados (201), 40 rechazados con 409 sin_stock y `disponible`
 * en el faltante, 0 × 500 (ni ningún otro código), y el pool sin nadie
 * esperando y con todas sus conexiones devueltas al final.
 *
 * El pool se fija aquí en los valores por omisión de src/config/db.js (max 10,
 * connectionTimeout 5 s) ANTES de cargarlo, para que la prueba reproduzca el
 * escenario aunque el entorno traiga otro PG_POOL_MAX.
 *
 * DATOS PROPIOS: catálogo de tests/helpers/plato-prueba.js (plato con receta
 * 1 × insumo propio) y una mesa de su rango. El `after` lo borra todo.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';
process.env.PG_POOL_MAX = '10';
process.env.PG_CONNECTION_TIMEOUT_MS = '5000';

const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { tokenStaff } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');

const PEDIDOS = 50;
const PORCIONES = 10;
const MARCA_MESA = 'PRUEBA sin-stock-concurrencia-sql';
const conNumeroDeMesa = require('../helpers/mesa-prueba').numerosDeMesa('sin-stock-concurrencia-sql');

let sonda = null;
let hayBase = false;
let catalogo = null;
let idMesa = null;
let token = null;

async function limpiarMesas() {
  const { rows } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = rows.map((r) => r.id_mesa);
  if (ids.length) {
    await sonda.query(
      `DELETE FROM movimientos_inventario
        WHERE id_detalle IN (SELECT dp.id_detalle FROM detalles_pedido dp
                               JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = ANY($1::int[]))`,
      [ids]
    );
    await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  }
  await sonda.query('DELETE FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
}

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  await limpiarMesas();
  const admin = await sonda.query(
    "SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1"
  );
  token = tokenStaff(admin.rows[0].id_usuario, 'admin');
  catalogo = await crearCatalogoPrueba(sonda, 'sin-stock-concurrencia', { receta: true });

  // El stock queda en exactamente PORCIONES con un ajuste en el libro.
  const { rows } = await sonda.query('SELECT stock_actual FROM insumos WHERE id_insumo = $1::int', [
    catalogo.idInsumo,
  ]);
  const delta = PORCIONES - Number(rows[0].stock_actual);
  if (delta !== 0) {
    await sonda.query('SELECT registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)', [
      catalogo.idInsumo,
      'ajuste',
      delta,
      `${catalogo.marca} prueba`,
    ]);
  }

  const m = await conNumeroDeMesa((numero) =>
    sonda.query(
      `INSERT INTO mesas (numero, capacidad, ubicacion, estado) VALUES ($1::int, 4, $2::text, 'ocupada') RETURNING id_mesa`,
      [numero, MARCA_MESA]
    )
  );
  idMesa = m.rows[0].id_mesa;
  hayBase = true;
});

test.after(async () => {
  try {
    if (hayBase) {
      await limpiarMesas();
      await catalogo.limpiar();
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

test(`${PEDIDOS} pedidos simultáneos por ${PORCIONES} porciones: ${PORCIONES} entran, el resto 409 sin_stock con disponible, 0 × 500 y el pool no se agota`, async (t) => {
  if (!hayBase) {
    t.skip('sin base de datos');
    return;
  }
  assert.strictEqual(pool.options.max, 10, 'el pool de la prueba es el de por omisión');

  const idPlato = catalogo.plato.id_plato;
  const cuerpo = { id_mesa: idMesa, items: [{ id_plato: idPlato, cantidad: 1 }] };
  let esperaMaxima = 0;
  const vigia = setInterval(() => {
    esperaMaxima = Math.max(esperaMaxima, pool.waitingCount);
  }, 5);

  let respuestas;
  try {
    respuestas = await Promise.all(
      Array.from({ length: PEDIDOS }, () =>
        request(app).post('/api/pedidos').set('Authorization', `Bearer ${token}`).send(cuerpo)
      )
    );
  } finally {
    clearInterval(vigia);
  }

  const resumen = respuestas.reduce((acc, r) => {
    const k = `${r.status}${r.body && r.body.motivo ? ` ${r.body.motivo}` : ''}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const creados = respuestas.filter((r) => r.status === 201);
  const sinStock = respuestas.filter((r) => r.status === 409 && r.body.motivo === 'sin_stock');
  const errores500 = respuestas.filter((r) => r.status >= 500);

  assert.strictEqual(errores500.length, 0, `ningún 5xx: ${JSON.stringify(resumen)}`);
  assert.strictEqual(creados.length, PORCIONES, JSON.stringify(resumen));
  assert.strictEqual(sinStock.length, PEDIDOS - PORCIONES, JSON.stringify(resumen));

  // Cada 409 trae el plato como faltante y CON `disponible` (lo que quedaba al
  // leerlo: un entero entre 0 y las porciones iniciales), sin nada de bodega.
  for (const r of sinStock) {
    assert.strictEqual(r.body.faltantes.length, 1, JSON.stringify(r.body));
    const [f] = r.body.faltantes;
    assert.strictEqual(f.tipo, 'plato');
    assert.strictEqual(f.id, idPlato);
    assert.deepStrictEqual(Object.keys(f).sort(), ['disponible', 'id', 'nombre', 'tipo'], JSON.stringify(f));
    assert.ok(Number.isInteger(f.disponible) && f.disponible >= 0 && f.disponible <= PORCIONES, JSON.stringify(f));
  }

  // El pool no se agotó: al terminar nadie espera y todas las conexiones
  // volvieron (ninguna quedó retenida por un rechazo).
  assert.strictEqual(pool.waitingCount, 0, 'nadie esperando conexión al final');
  assert.ok(pool.totalCount <= pool.options.max, `total ${pool.totalCount} <= max ${pool.options.max}`);
  assert.strictEqual(pool.idleCount, pool.totalCount, 'todas las conexiones devueltas al pool');
  t.diagnostic(`resumen ${JSON.stringify(resumen)}; cola máxima del pool durante la prueba: ${esperaMaxima}`);

  // En la base: el stock en 0, nunca negativo, y exactamente PORCIONES reservas.
  const { rows } = await sonda.query(
    `SELECT s.stock_actual::numeric AS stock,
            (SELECT MIN(stock_resultante) FROM movimientos_inventario WHERE id_insumo = s.id_insumo) AS minimo,
            (SELECT COUNT(*)::int FROM movimientos_inventario WHERE id_insumo = s.id_insumo AND tipo = 'reserva') AS reservas
       FROM insumos s WHERE s.id_insumo = $1::int`,
    [catalogo.idInsumo]
  );
  assert.strictEqual(Number(rows[0].stock), 0);
  assert.ok(Number(rows[0].minimo) >= 0, `mínimo del libro ${rows[0].minimo}`);
  assert.strictEqual(rows[0].reservas, PORCIONES);
});
