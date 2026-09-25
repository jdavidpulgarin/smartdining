const pool = require('../config/db');

// Tabla categorias (docs/modelo-er.md): id_categoria, nombre, descripcion,
// orden_visualizacion, activo.

async function listar() {
  const result = await pool.query(
    'SELECT * FROM categorias ORDER BY orden_visualizacion ASC, id_categoria ASC'
  );
  return result.rows;
}

async function obtenerPorId(id) {
  const result = await pool.query('SELECT * FROM categorias WHERE id_categoria = $1', [id]);
  return result.rows[0] || null;
}

async function crear({ nombre, descripcion, orden_visualizacion, activo }) {
  const result = await pool.query(
    `INSERT INTO categorias (nombre, descripcion, orden_visualizacion, activo)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [nombre, descripcion || null, orden_visualizacion ?? 0, activo ?? true]
  );
  return result.rows[0];
}

async function actualizar(id, datos) {
  const result = await pool.query(
    `UPDATE categorias
       SET nombre = $1, descripcion = $2, orden_visualizacion = $3, activo = $4
     WHERE id_categoria = $5 RETURNING *`,
    [datos.nombre, datos.descripcion, datos.orden_visualizacion, datos.activo, id]
  );
  return result.rows[0] || null;
}

async function eliminar(id) {
  const result = await pool.query(
    'DELETE FROM categorias WHERE id_categoria = $1 RETURNING id_categoria',
    [id]
  );
  return result.rows[0] || null;
}

module.exports = { listar, obtenerPorId, crear, actualizar, eliminar };
