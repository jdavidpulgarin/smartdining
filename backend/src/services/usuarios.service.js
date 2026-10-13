const pool = require('../config/db');

// Tabla usuarios (docs/modelo-er.md): id_usuario, nombre, email, password_hash,
// rol, activo, creado_en. No tiene telefono.

async function buscarPorEmail(email) {
  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
  return result.rows[0] || null;
}

/**
 * Lee lo mínimo para decidir si un token sigue sirviendo (H-09).
 *
 * Se piden solo tres columnas y no `SELECT *`: esto se consulta en cada
 * petición del personal (con caché, pero igual), y el hash de la contraseña no
 * tiene por qué pasearse por ahí.
 */
async function buscarPorId(idUsuario) {
  const result = await pool.query(
    'SELECT id_usuario, rol, activo FROM usuarios WHERE id_usuario = $1',
    [idUsuario]
  );
  return result.rows[0] || null;
}

async function crear({ nombre, email, password_hash, rol }) {
  const result = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, creado_en)
     VALUES ($1, $2, $3, $4, true, NOW())
     RETURNING id_usuario, nombre, email, rol, activo`,
    [nombre, email, password_hash, rol]
  );
  return result.rows[0];
}

module.exports = { buscarPorEmail, buscarPorId, crear };
