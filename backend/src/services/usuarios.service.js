const pool = require('../config/db');

// Tabla usuarios (docs/modelo-er.md): id_usuario, nombre, email, password_hash,
// rol, activo, creado_en. No tiene telefono.

async function buscarPorEmail(email) {
  const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
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

module.exports = { buscarPorEmail, crear };
