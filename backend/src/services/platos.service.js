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

async function actualizar(id, datos) {
  const result = await pool.query(
    `UPDATE platos SET id_categoria = $1, nombre = $2, descripcion = $3, precio = $4,
      url_imagen = $5, disponible = $6, tiempo_preparacion_estimado = $7
     WHERE id_plato = $8 RETURNING *`,
    [
      datos.id_categoria,
      datos.nombre,
      datos.descripcion,
      datos.precio,
      datos.url_imagen,
      datos.disponible,
      datos.tiempo_preparacion_estimado,
      id,
    ]
  );
  return result.rows[0] || null;
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

module.exports = { listar, obtenerPorId, crear, actualizar, cambiarDisponibilidad, eliminar };
