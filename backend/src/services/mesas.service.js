const pool = require('../config/db');

// Tabla mesas (docs/modelo-er.md): id_mesa, numero, capacidad, ubicacion,
// estado, token_qr, actualizado_en.
//
// El token_qr lo genera y firma Roberto (socket-server); este servicio solo
// lee/expone lo que ya quedó guardado en la columna token_qr de la mesa. La
// vigencia (TTL) del token vive en Redis, del lado de Roberto — este servicio
// solo confirma que el token corresponde a una mesa existente.

// Valores exactos del CHECK de mesas.estado en el schema.sql de Jarrison.
const ESTADOS_MESA = ['disponible', 'ocupada', 'reservada', 'mantenimiento'];
const ESTADO_MESA_LIBRE = 'disponible';

async function listar() {
  const result = await pool.query('SELECT * FROM mesas ORDER BY numero ASC');
  return result.rows;
}

async function obtenerPorId(id) {
  const result = await pool.query('SELECT * FROM mesas WHERE id_mesa = $1', [id]);
  return result.rows[0] || null;
}

async function obtenerPorToken(token) {
  const result = await pool.query('SELECT * FROM mesas WHERE token_qr = $1', [token]);
  return result.rows[0] || null;
}

async function crear({ numero, capacidad, ubicacion, estado, token_qr }) {
  // capacidad, ubicacion y actualizado_en tienen DEFAULT en el schema: si no
  // vienen, se deja que la base ponga el suyo.
  const result = await pool.query(
    `INSERT INTO mesas (numero, capacidad, ubicacion, estado, token_qr)
     VALUES ($1, COALESCE($2, 4), COALESCE($3, 'Principal'), $4, $5) RETURNING *`,
    [numero, capacidad ?? null, ubicacion || null, estado || ESTADO_MESA_LIBRE, token_qr || null]
  );
  return result.rows[0];
}

async function actualizarEstado(id, estado) {
  // actualizado_en y version_control los maneja el trigger tr_control_concurrencia_mesa.
  const result = await pool.query(
    `UPDATE mesas SET estado = COALESCE($1, estado) WHERE id_mesa = $2 RETURNING *`,
    [estado, id]
  );
  return result.rows[0] || null;
}

async function eliminar(id) {
  const result = await pool.query(
    'DELETE FROM mesas WHERE id_mesa = $1 RETURNING id_mesa',
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  ESTADOS_MESA,
  ESTADO_MESA_LIBRE,
  listar,
  obtenerPorId,
  obtenerPorToken,
  crear,
  actualizarEstado,
  eliminar,
};
