/**
 * D-19 parte B: zonas de entrega (`zonas_envio`, script 36).
 *
 * Cotizar NO reimplementa la normalización de barrios: llama a
 * `cotizar_zona(barrio)` de la base, que compara `fn_clave_barrio` contra
 * `fn_clave_barrio` (sin tildes, minúsculas, espacios colapsados). Así
 * "  Los   Álamos " y "los alamos" son el mismo barrio en la app, en la API y
 * en la base, y la regla vive en un solo lugar.
 */

const pool = require('../config/db');

/** Solo las activas, con lo que el contrato publica. */
async function listarActivas(db = pool) {
  const { rows } = await db.query(
    `SELECT id_zona, nombre, barrios, costo_envio, tiempo_estimado_min
       FROM zonas_envio
      WHERE activa
      ORDER BY id_zona`
  );
  return rows;
}

/**
 * La zona de una dirección DEL CLIENTE. Devuelve:
 *   - null si la dirección no existe o no es suya (el controller responde 404);
 *   - `{ zona: null }` si no cae en ninguna zona activa (422);
 *   - `{ zona, costo_envio }` si cae en una.
 */
async function cotizar(idCliente, idDireccion, db = pool) {
  const { rows } = await db.query(
    `SELECT d.id_direccion, z.id_zona, z.nombre, z.costo_envio, z.tiempo_estimado_min
       FROM direcciones d
       LEFT JOIN LATERAL cotizar_zona(d.barrio::text) z ON TRUE
      WHERE d.id_direccion = $1::int AND d.id_cliente = $2::int`,
    [idDireccion, idCliente]
  );
  const fila = rows[0];
  if (!fila) return null;
  if (fila.id_zona === null || fila.id_zona === undefined) return { zona: null };
  return {
    zona: { id_zona: fila.id_zona, nombre: fila.nombre, tiempo_estimado_min: fila.tiempo_estimado_min },
    costo_envio: fila.costo_envio,
  };
}

module.exports = { listarActivas, cotizar };
