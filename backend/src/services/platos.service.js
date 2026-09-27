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

async function eliminar(id) {
  const result = await pool.query(
    'DELETE FROM platos WHERE id_plato = $1 RETURNING id_plato',
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { listar, obtenerPorId, crear, actualizar, eliminar };
