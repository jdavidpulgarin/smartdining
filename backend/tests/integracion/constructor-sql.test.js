const test = require('node:test');
const assert = require('node:assert');

/**
 * El 23503 del AUTOR al editar una opción del constructor, contra PostgreSQL
 * real (review de #144).
 *
 * Cambiar el `precio_extra` de un ingrediente dispara
 * `tr_historial_precio_ingrediente` (database/scripts/26_configuracion.sql),
 * que escribe en `historial_precios` con el autor que sale de
 * `app.id_usuario`. Esa tabla tiene su propia `fk_historial_precios_usuario`
 * contra `usuarios`: con un id que no existe, el UPDATE falla con 23503 y antes
 * salía como el **409 genérico** de clave ajena, sin decir que el problema era
 * la sesión de quien editaba.
 *
 * Es el gemelo de la prueba de `platos-sql.test.js`, sobre la otra tabla que
 * escribe el mismo trigger. Se SALTA sola si no hay base:
 *
 *   npm run test:integracion
 */

const B = require('path').resolve(__dirname, '../..');
require('dotenv').config({ path: `${B}/.env` });

const { abrirSonda } = require('../helpers/base-prueba');
const pool = require('../../src/config/db');
const constructorService = require('../../src/services/constructor.service');
const autorInexistente = require('../../src/services/autor-inexistente');

let sonda = null;
let hayBase = false;
let opcion = null;
/** Ultimo id de historial_precios de la opcion al empezar: lo de despues es nuestro. */
let historialDesde = 0;
/** Insumos que crean las pruebas (b), para borrarlos aunque una falle. */
const insumosCreados = [];

test.before(async () => {
  // Sin base configurada salta; configurada y sin responder, falla (#165).
  sonda = await abrirSonda();
  if (!sonda) return;
  const r = await sonda.query(
    'SELECT id_ingrediente, nombre, precio_extra FROM ingredientes ORDER BY id_ingrediente LIMIT 1'
  );
  opcion = r.rows[0] || null;
  hayBase = opcion !== null;
  if (hayBase) {
    const h = await sonda.query(
      `SELECT COALESCE(MAX(id), 0) AS ultimo FROM historial_precios
        WHERE tipo = 'ingrediente' AND id_referencia = $1`,
      [opcion.id_ingrediente]
    );
    historialDesde = Number(h.rows[0].ultimo);
  }
});

test.after(async () => {
  try {
    if (hayBase && opcion) {
      // Se deja el precio_extra como estaba: la prueba del caso bueno lo cambia.
      await sonda.query('UPDATE ingredientes SET precio_extra = $1 WHERE id_ingrediente = $2', [
        opcion.precio_extra,
        opcion.id_ingrediente,
      ]);
      // Y el historial que dejaron el cambio y esta misma restauracion (review
      // de #146): tr_historial_precio_ingrediente escribe una fila por cada
      // UPDATE del precio, tambien por el de la linea de arriba. Solo lo que
      // vino despues de la marca del before: lo anterior no es nuestro.
      await sonda.query(
        `DELETE FROM historial_precios
          WHERE tipo = 'ingrediente' AND id_referencia = $1 AND id > $2`,
        [opcion.id_ingrediente, historialDesde]
      );
    }
    if (hayBase && insumosCreados.length) {
      // Los insumos de las pruebas (b), con su libro: antes se borraban al
      // final de la propia prueba, asi que una asercion fallida los dejaba.
      await sonda.query('DELETE FROM movimientos_inventario WHERE id_insumo = ANY($1::int[])', [
        insumosCreados,
      ]);
      await sonda.query('DELETE FROM insumos WHERE id_insumo = ANY($1::int[])', [insumosCreados]);
    }
  } finally {
    if (sonda) await sonda.end();
    await pool.end();
  }
});

/** Un id de usuario que seguro no existe. */
async function idFantasma() {
  const { rows } = await sonda.query(
    'SELECT COALESCE(MAX(id_usuario), 0) + 1000 AS inexistente FROM usuarios'
  );
  return Number(rows[0].inexistente);
}

test('review-144: cambiar el precio de una opcion con un autor inexistente da 409 autor_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const nuevo = Number(opcion.precio_extra) + 500;
  // El await va FUERA de la funcion que recibe assert.rejects, que no es async.
  const fantasma = await idFantasma();

  await assert.rejects(
    () => constructorService.actualizarIngrediente(
      opcion.id_ingrediente,
      { nombre: opcion.nombre, precio_extra: nuevo },
      undefined,
      { idUsuario: fantasma }
    ),
    (err) => {
      assert.strictEqual(err.status, 409, 'traducido, no el 500 ni el generico');
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      assert.strictEqual(err.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // Y la opcion se quedo como estaba: la transaccion se deshizo.
  const { rows } = await sonda.query(
    'SELECT precio_extra FROM ingredientes WHERE id_ingrediente = $1',
    [opcion.id_ingrediente]
  );
  assert.strictEqual(Number(rows[0].precio_extra), Number(opcion.precio_extra));
});

test('review-144: con un usuario que existe, el cambio entra y queda en el historial', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const { rows: usuarios } = await sonda.query(
    'SELECT id_usuario FROM usuarios ORDER BY id_usuario LIMIT 1'
  );
  const nuevo = Number(opcion.precio_extra) + 700;

  const { ingrediente } = await constructorService.actualizarIngrediente(
    opcion.id_ingrediente,
    { nombre: opcion.nombre, precio_extra: nuevo },
    undefined,
    { idUsuario: usuarios[0].id_usuario }
  );

  assert.strictEqual(Number(ingrediente.precio_extra), nuevo);

  const { rows: historial } = await sonda.query(
    `SELECT id_usuario, precio_anterior, precio_nuevo FROM historial_precios
      WHERE tipo = 'ingrediente' AND id_referencia = $1 ORDER BY id DESC LIMIT 1`,
    [opcion.id_ingrediente]
  );
  assert.strictEqual(historial[0].id_usuario, usuarios[0].id_usuario);
  assert.strictEqual(Number(historial[0].precio_nuevo), nuevo);
});

/**
 * EXTENSIÓN (a) del review de #144: el mismo bug en `PUT /api/configuracion`.
 *
 * `tr_configuracion_actualizada` escribe `actualizado_por` con el id del JWT y
 * la columna tiene `fk_configuracion_actualizado_por` contra `usuarios`.
 * Comprobado contra PostgreSQL real: con un id inexistente el error es ese
 * 23503 y antes salía como el 409 genérico.
 */
test('review-144 (a): el PUT de configuracion con el autor borrado da 409 autor_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const configuracionService = require('../../src/services/configuracion.service');
  const antes = await configuracionService.obtener();
  const fantasma = await idFantasma();

  await assert.rejects(
    () => configuracionService.actualizar({ nombre: 'Prueba autor' }, { idUsuario: fantasma }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      assert.strictEqual(err.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // Y la fila se quedo como estaba.
  const despues = await configuracionService.obtener();
  assert.strictEqual(despues.nombre, antes.nombre);
});

/**
 * EXTENSIÓN (b) del review de #144: el mismo bug al mover stock.
 *
 * `movimientos_inventario.id_usuario` tiene su FK contra `usuarios` y el nombre
 * lo generó PostgreSQL: **`movimientos_inventario_id_usuario_fkey`**, que no
 * sigue el patrón `fk_…` de las otras. Comprobado con un `\d` sobre la base
 * desechable antes de escribirlo.
 */
test('review-144 (b): un movimiento con el autor borrado da 409 autor_inexistente', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const inventarioService = require('../../src/services/inventario.service');
  const fantasma = await idFantasma();

  // El insumo se crea SIN autor (null es válido: la FK lo admite).
  const { insumo } = await inventarioService.crearInsumo(
    { nombre: `AUTOR144 ${Date.now()}`, stock_inicial: 10 },
    { idUsuario: null }
  );
  insumosCreados.push(insumo.id_insumo);

  await assert.rejects(
    () => inventarioService.registrarMovimiento(
      insumo.id_insumo, { tipo: 'entrada', cantidad: 5 }, { idUsuario: fantasma }
    ),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      assert.strictEqual(err.message, autorInexistente.MENSAJE_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // El stock se quedo como estaba: la transaccion se deshizo, y el libro cuadra.
  const leido = await inventarioService.obtenerInsumo(insumo.id_insumo);
  assert.strictEqual(Number(leido.stock_actual), 10);

  const { rows } = await sonda.query(
    `SELECT COALESCE(SUM(cantidad), 0) AS suma FROM movimientos_inventario WHERE id_insumo = $1`,
    [insumo.id_insumo]
  );
  assert.strictEqual(Number(rows[0].suma), 10, 'SUM(cantidad) = stock_actual');
  // El insumo y su libro los borra el after, falle o no esta prueba.
});

test('review-144 (b): crear un insumo con stock inicial y autor borrado, igual', async (t) => {
  if (!hayBase) return t.skip('sin base de datos');

  const inventarioService = require('../../src/services/inventario.service');
  const fantasma = await idFantasma();
  const nombre = `AUTOR144b ${Date.now()}`;

  await assert.rejects(
    () => inventarioService.crearInsumo({ nombre, stock_inicial: 7 }, { idUsuario: fantasma }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.motivo, autorInexistente.MOTIVO_AUTOR_INEXISTENTE);
      return true;
    }
  );

  // Y el insumo NO quedo a medias.
  const { rows } = await sonda.query('SELECT count(*)::int AS n FROM insumos WHERE nombre = $1', [nombre]);
  assert.strictEqual(rows[0].n, 0, 'la transaccion se deshizo entera');
});
