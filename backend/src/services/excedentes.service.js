const pool = require('../config/db');

/**
 * Excedentes de pagos en línea de mesa (T4, script 44, EVENTS.md §8.7): lo que
 * sobró de un pago que Wompi aprobó y que la Caja devuelve en efectivo.
 *
 * Los registra transacciones.service (registrarPagoEnLinea) en la misma
 * transacción del pago. Aquí solo se listan y se marcan como devueltos.
 * Es aparte de pagos_por_devolver (script 36, pagos anticipados de domicilio).
 */

const ESTADOS = Object.freeze(['pendiente', 'devuelto']);

/** Una fila tal como sale en la API: los montos en centavos, como números. */
function vista(f) {
  return {
    id: f.id,
    id_mesa: f.id_mesa,
    comensal: f.comensal,
    referencia_externa: f.referencia_externa,
    id_transaccion: f.id_transaccion,
    monto_centavos: Number(f.monto_centavos),
    aplicado_centavos: Number(f.aplicado_centavos),
    excedente_centavos: Number(f.excedente_centavos),
    motivo: f.motivo,
    estado: f.estado,
    devuelto_por: f.devuelto_por,
    devuelto_en: f.devuelto_en,
    creado_en: f.creado_en,
  };
}

/** Los excedentes de un estado, del más viejo al más nuevo (idx_excedentes_estado). */
async function listar({ estado }) {
  const { rows } = await pool.query(
    `SELECT id, id_mesa, comensal, referencia_externa, id_transaccion,
            monto_centavos, aplicado_centavos, excedente_centavos, motivo, estado,
            devuelto_por, devuelto_en, creado_en
       FROM excedentes_pago_en_linea
      WHERE estado = $1::text
      ORDER BY creado_en ASC, id ASC`,
    [estado]
  );
  return rows.map(vista);
}

/**
 * Marca un excedente como devuelto en efectivo, con quién y cuándo.
 *
 * UPDATE condicional (solo si sigue 'pendiente'): dos cajeros a la vez no lo
 * marcan dos veces; el segundo ve que ya estaba devuelto.
 *
 * @returns {Promise<{noExiste: true} | {yaDevuelto: true, excedente: object} | {excedente: object}>}
 */
async function marcarDevuelto(id, idUsuario) {
  const { rows } = await pool.query(
    `UPDATE excedentes_pago_en_linea
        SET estado = 'devuelto', devuelto_por = $2::int, devuelto_en = now()
      WHERE id = $1::int AND estado = 'pendiente'
      RETURNING id, id_mesa, comensal, referencia_externa, id_transaccion,
                monto_centavos, aplicado_centavos, excedente_centavos, motivo, estado,
                devuelto_por, devuelto_en, creado_en`,
    [id, idUsuario]
  );
  if (rows[0]) return { excedente: vista(rows[0]) };

  const actual = await pool.query(
    `SELECT id, id_mesa, comensal, referencia_externa, id_transaccion,
            monto_centavos, aplicado_centavos, excedente_centavos, motivo, estado,
            devuelto_por, devuelto_en, creado_en
       FROM excedentes_pago_en_linea WHERE id = $1::int`,
    [id]
  );
  if (!actual.rows[0]) return { noExiste: true };
  return { yaDevuelto: true, excedente: vista(actual.rows[0]) };
}

module.exports = { ESTADOS, listar, marcarDevuelto };
