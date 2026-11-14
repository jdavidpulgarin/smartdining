const test = require('node:test');
const assert = require('node:assert');

/**
 * T5: el `disponible` de cada faltante del 409 sin_stock, contra PostgreSQL
 * REAL: la fórmula de fn_consumo_detalle (27_inventario.sql) y el stock de
 * verdad.
 *
 * DATOS PROPIOS (patrón del #218): el catálogo de tests/helpers/plato-prueba.js
 * (con receta y plato del constructor, sobre un insumo propio), un segundo
 * insumo y un segundo plato propios, y una mesa de su rango. El stock se fija
 * con movimientos (registrar_movimiento_inventario 'ajuste'), como en la
 * operación real. El `after` lo borra todo.
 *
 * Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

process.env.SOCKET_URL = '';
process.env.REDIS_URL = '';

const crypto = require('node:crypto');
const request = require('supertest');
const { abrirSonda } = require('../helpers/base-prueba');
const { tokenStaff } = require('../helpers/fake-db');
const { crearCatalogoPrueba } = require('../helpers/plato-prueba');
const app = require('../../server');
const pool = require('../../src/config/db');

const MARCA = `prueba-t5-${crypto.randomBytes(4).toString('hex')}`;
const MARCA_MESA = 'PRUEBA sin-stock-disponible-sql';
const conNumeroDeMesa = require('../helpers/mesa-prueba').numerosDeMesa('sin-stock-disponible-sql');

let sonda = null;
let hayBase = false;
let catalogo = null; // insumo X, plato P (X:1) y armable A (base X:1, extra X:1)
let idInsumoY = null;
let idPlatoQ = null; // X:1 + Y:1
let idMesa = null;
let token = null;

async function limpiarPropio() {
  const { rows: ms } = await sonda.query('SELECT id_mesa FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
  const ids = ms.map((r) => r.id_mesa);
  if (ids.length) {
    await sonda.query(
      `DELETE FROM movimientos_inventario
        WHERE id_detalle IN (SELECT dp.id_detalle FROM detalles_pedido dp
                               JOIN pedidos p ON p.id_pedido = dp.id_pedido WHERE p.id_mesa = ANY($1::int[]))`,
      [ids]
    );
    await sonda.query('DELETE FROM pedidos WHERE id_mesa = ANY($1::int[])', [ids]);
  }
  await sonda.query('DELETE FROM platos WHERE nombre = $1::text', [`${MARCA} plato Q`]);
  await sonda.query(
    `DELETE FROM auditoria_cambios WHERE tabla_afectada = 'platos'
       AND COALESCE(datos_nuevos->>'nombre', datos_anteriores->>'nombre') = $1::text`,
    [`${MARCA} plato Q`]
  );
}

async function limpiarInsumoY() {
  const { rows } = await sonda.query('SELECT id_insumo FROM insumos WHERE nombre = $1::text', [`${MARCA} insumo Y`]);
  for (const { id_insumo: id } of rows) {
    await sonda.query('DELETE FROM movimientos_inventario WHERE id_insumo = $1::int', [id]);
    await sonda.query('DELETE FROM insumos WHERE id_insumo = $1::int', [id]);
  }
  await sonda.query('DELETE FROM mesas WHERE ubicacion = $1::text', [MARCA_MESA]);
}

test.before(async () => {
  sonda = await abrirSonda();
  if (!sonda) return;
  await limpiarPropio();
  await limpiarInsumoY();
  const admin = await sonda.query("SELECT id_usuario FROM usuarios WHERE rol = 'admin' AND activo ORDER BY id_usuario LIMIT 1");
  token = tokenStaff(admin.rows[0].id_usuario, 'admin');
  catalogo = await crearCatalogoPrueba(sonda, 'sin-stock-disponible', { receta: true, conConstructor: true, precio: 10000 });

  const y = await sonda.query(`INSERT INTO insumos (nombre, unidad) VALUES ($1::text, 'unidad') RETURNING id_insumo`, [`${MARCA} insumo Y`]);
  idInsumoY = y.rows[0].id_insumo;
  const q = await sonda.query(
    `INSERT INTO platos (id_categoria, nombre, precio, disponible) VALUES ($1::int, $2::text, 10000, TRUE) RETURNING id_plato`,
    [catalogo.idCategoria, `${MARCA} plato Q`]
  );
  idPlatoQ = q.rows[0].id_plato;
  await sonda.query(
    `INSERT INTO recetas_plato (id_plato, id_insumo, cantidad) VALUES ($1::int, $2::int, 1), ($1::int, $3::int, 1)`,
    [idPlatoQ, catalogo.idInsumo, idInsumoY]
  );
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
      await limpiarPropio();
      await catalogo.limpiar();
      await limpiarInsumoY();
    }
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

/** Deja el stock de un insumo en `valor` con un movimiento de ajuste (el libro cuadra). */
async function fijarStock(idInsumo, valor) {
  const { rows } = await sonda.query('SELECT stock_actual FROM insumos WHERE id_insumo = $1::int', [idInsumo]);
  const delta = valor - Number(rows[0].stock_actual);
  if (delta !== 0) {
    await sonda.query(
      'SELECT registrar_movimiento_inventario($1::int, $2::varchar, $3::numeric, $4::text)',
      [idInsumo, 'ajuste', delta, `${MARCA} prueba`]
    );
  }
}

const pedir = (items) =>
  request(app).post('/api/pedidos').set('Authorization', `Bearer ${token}`).send({ id_mesa: idMesa, items });

const faltante = (res, tipo, id) => res.body.faltantes.find((f) => f.tipo === tipo && f.id === id);

test('stock para 1 y pedir 2 -> 409 con disponible 1; pedir 1 entra', async (t) => {
  if (saltar(t)) return;
  await fijarStock(catalogo.idInsumo, 1);
  const res = await pedir([{ id_plato: catalogo.plato.id_plato, cantidad: 2 }]);
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(res.body.motivo, 'sin_stock');
  assert.deepStrictEqual(faltante(res, 'plato', catalogo.plato.id_plato), {
    tipo: 'plato', id: catalogo.plato.id_plato, nombre: `${catalogo.marca} plato`, disponible: 1,
  });
  assert.ok(!JSON.stringify(res.body).includes('insumo'), 'nada del inventario en la respuesta');

  const ok = await pedir([{ id_plato: catalogo.plato.id_plato, cantidad: 1 }]);
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
});

test('plato agotado (stock 0) -> 409 con disponible 0', async (t) => {
  if (saltar(t)) return;
  await fijarStock(catalogo.idInsumo, 0);
  const res = await pedir([{ id_plato: catalogo.plato.id_plato, cantidad: 1 }]);
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(faltante(res, 'plato', catalogo.plato.id_plato).disponible, 0);
});

test('plato con dos insumos (uno alcanza para 3, otro para 1) -> disponible 1 (el mínimo)', async (t) => {
  if (saltar(t)) return;
  await fijarStock(catalogo.idInsumo, 3);
  await fijarStock(idInsumoY, 1);
  const res = await pedir([{ id_plato: idPlatoQ, cantidad: 2 }]);
  assert.strictEqual(res.status, 409, JSON.stringify(res.body));
  assert.strictEqual(faltante(res, 'plato', idPlatoQ).disponible, 1);
});

test('armable: la opción que alcanza para 2 -> disponible 2 en porción normal; en extra (factor 1,5) -> 1', async (t) => {
  if (saltar(t)) return;
  const [base] = catalogo.constructor.ingredientes; // paso obligatorio, receta X:1
  await fijarStock(catalogo.idInsumo, 2);

  const normal = await pedir([{
    id_plato: catalogo.constructor.id_plato, cantidad: 3,
    ingredientes: [{ id_ingrediente: base.id_ingrediente, porcion: 'normal' }],
  }]);
  assert.strictEqual(normal.status, 409, JSON.stringify(normal.body));
  assert.deepStrictEqual(faltante(normal, 'ingrediente', base.id_ingrediente), {
    tipo: 'ingrediente', id: base.id_ingrediente, nombre: `${catalogo.marca} opción base`, disponible: 2,
  });

  const extra = await pedir([{
    id_plato: catalogo.constructor.id_plato, cantidad: 2,
    ingredientes: [{ id_ingrediente: base.id_ingrediente, porcion: 'extra' }],
  }]);
  assert.strictEqual(extra.status, 409, JSON.stringify(extra.body));
  assert.strictEqual(faltante(extra, 'ingrediente', base.id_ingrediente).disponible, 1, 'floor(2 / (1 x 1,5)) = 1');

  // Y "Ajustar a 2" en porción normal entra.
  const ajustado = await pedir([{
    id_plato: catalogo.constructor.id_plato, cantidad: 2,
    ingredientes: [{ id_ingrediente: base.id_ingrediente, porcion: 'normal' }],
  }]);
  assert.strictEqual(ajustado.status, 201, JSON.stringify(ajustado.body));
});
