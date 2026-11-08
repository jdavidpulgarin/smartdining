const pool = require('../config/db');

// Tabla platos (docs/modelo-er.md): id_plato, id_categoria, nombre, descripcion,
// precio, url_imagen, disponible, tiempo_preparacion_estimado, creado_en.
// El modelo NO tiene personalizaciones ni alergenos.

async function listar(idCategoria) {
  const result = idCategoria
    ? await pool.query('SELECT * FROM platos WHERE id_categoria = $1 ORDER BY id_plato', [idCategoria])
    : await pool.query('SELECT * FROM platos ORDER BY id_plato');
  return result.rows;
}

async function obtenerPorId(id) {
  const result = await pool.query('SELECT * FROM platos WHERE id_plato = $1', [id]);
  return result.rows[0] || null;
}

async function crear(p) {
  const result = await pool.query(
    `INSERT INTO platos
      (id_categoria, nombre, descripcion, precio, url_imagen, disponible,
       tiempo_preparacion_estimado, creado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      p.id_categoria,
      p.nombre,
      p.descripcion || null,
      p.precio,
      p.url_imagen || null,
      p.disponible ?? true,
      p.tiempo_preparacion_estimado ?? null,
    ]
  );
  return result.rows[0];
}

/**
 * Actualiza un plato. En una TRANSACCIÓN por el historial de precios (D-16 B).
 *
 * El trigger `tr_historial_precio_plato` (database/scripts/26_configuracion.sql)
 * registra cada cambio de `precio` en `historial_precios`, y el autor lo saca de
 * `app.id_usuario` con `fn_usuario_de_sesion()`. Ese valor se fija con
 * `set_config(..., true)`, que vive **solo hasta el fin de la transacción**: con
 * el `pool.query` de antes, el `set_config` y el `UPDATE` podían salir por
 * conexiones distintas y el historial quedaba con `id_usuario` NULL. De ahí la
 * transacción: no es por atomicidad —es un solo UPDATE— sino para que el
 * `set_config` y el `UPDATE` compartan conexión y transacción.
 *
 * `set_config` y no `SET LOCAL` porque solo la primera admite parámetros ($1).
 *
 * `personalizable` y `calorias` también se escriben aquí: las columnas ya
 * existían (13_constructor.sql) pero el UPDATE no las tocaba, así que un PUT que
 * las mandara las perdía en silencio.
 *
 * @param {number|string} id
 * @param {object} datos la fila completa ya mezclada por el controller.
 * @param {{idUsuario?: number|null}} contexto quién hace el cambio, para el historial.
 */
async function actualizar(id, datos, { idUsuario = null } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // El autor del cambio de precio, para el trigger del historial.
    await client.query('SELECT set_config($1, $2, true)', [
      'app.id_usuario',
      idUsuario === null || idUsuario === undefined ? '' : String(idUsuario),
    ]);

    const result = await client.query(
      `UPDATE platos SET id_categoria = $1, nombre = $2, descripcion = $3, precio = $4,
        url_imagen = $5, disponible = $6, tiempo_preparacion_estimado = $7,
        personalizable = COALESCE($8, personalizable), calorias = COALESCE($9, calorias)
       WHERE id_plato = $10 RETURNING *`,
      [
        datos.id_categoria,
        datos.nombre,
        datos.descripcion,
        datos.precio,
        datos.url_imagen,
        datos.disponible,
        datos.tiempo_preparacion_estimado,
        datos.personalizable ?? null,
        datos.calorias ?? null,
        id,
      ]
    );

    await client.query('COMMIT');
    return result.rows[0] || null;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ya estaba cerrada: no hay nada que deshacer.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Agota (`false`) o repone (`true`) un plato — D-05, PATCH /platos/:id/disponible.
 *
 * Igual que actualizarIngrediente del constructor: una transacción con la fila
 * BLOQUEADA (`FOR UPDATE`), para que dos pulsaciones a la vez desde el panel y
 * desde el KDS no se pisen y el valor anterior que se devuelve sea el de verdad.
 * El UPDATE toca SOLO `disponible`: a diferencia de actualizar(), aquí no se
 * reescribe la fila entera, así que agotar un plato no puede perder por el
 * camino un precio o una descripción que otro acabara de guardar.
 *
 * @returns {Promise<{plato: object, anterior: object}|null>} null si no existe.
 */
async function cambiarDisponibilidad(id, disponible) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query(
      'SELECT * FROM platos WHERE id_plato = $1 FOR UPDATE',
      [id]
    );
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const r = await client.query(
      'UPDATE platos SET disponible = $1 WHERE id_plato = $2 RETURNING *',
      [disponible, id]
    );

    await client.query('COMMIT');
    return { plato: r.rows[0], anterior: actual.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function eliminar(id) {
  const result = await pool.query(
    'DELETE FROM platos WHERE id_plato = $1 RETURNING id_plato',
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Tope de filas del historial. Es defensivo, no una regla de negocio: un plato
 * con miles de cambios de precio no debería devolver una respuesta de megas.
 */
const MAX_HISTORIAL = 500;

/**
 * Cambios de precio de un plato, los más recientes primero (D-16 B, P2).
 *
 * Sale de `historial_precios`, que llenan los triggers. El índice
 * `idx_historial_precios_referencia` es exactamente `(tipo, id_referencia,
 * cambiado_en DESC)`, así que este orden no cuesta un sort.
 *
 * `id_usuario` puede ser NULL: un cambio hecho antes de D-16 B, por una
 * consulta a mano, o por un usuario que después se borró (la FK es
 * `ON DELETE SET NULL`). Se devuelve tal cual; quien lo muestre decide qué
 * poner.
 */
async function historialPrecios(id, { limite = 100 } = {}) {
  const tope = Math.min(Math.max(Number(limite) || 100, 1), MAX_HISTORIAL);
  const result = await pool.query(
    `SELECT id, tipo, id_referencia, precio_anterior, precio_nuevo, id_usuario, cambiado_en
       FROM historial_precios
      WHERE tipo = 'plato' AND id_referencia = $1
      ORDER BY cambiado_en DESC, id DESC
      LIMIT $2`,
    [id, tope]
  );
  return result.rows;
}

module.exports = {
  listar,
  obtenerPorId,
  crear,
  actualizar,
  cambiarDisponibilidad,
  eliminar,
  historialPrecios,
  MAX_HISTORIAL,
};
