const pool = require('../config/db');

// Tabla mesas (docs/modelo-er.md): id_mesa, numero, capacidad, ubicacion,
// estado, token_qr, actualizado_en.
//
// Este servicio solo lee/expone lo que está guardado en la columna token_qr.
// El socket-server de Roberto no usa Redis ni esta columna: emite tokens QR
// firmados con HMAC, con la expiración dentro del propio token. Los dos modelos
// conviven por ahora; la decisión de cuál queda es del equipo (docs/api-spec.md).

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
