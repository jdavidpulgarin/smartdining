const pool = require('../config/db');

// Tabla transacciones (docs/modelo-er.md): id_transaccion, id_pedido,
// metodo_pago, monto, estado_transaccion, referencia_externa, creado_en.

// Unico estado_transaccion que liquida el pedido. Es tambien el que hace que el
// trigger tr_validar_transaccion_financiera compruebe monto contra el total.
const ESTADO_COBRADO = 'completada';

/**
 * Registra el pago de un pedido y, si el cobro fue efectivo, lo marca 'pagado'.
 *
 * La base es la fuente de verdad y aquí no se replica su lógica:
 * - Que el monto no exceda el total del pedido lo valida el trigger
 *   tr_validar_transaccion_financiera (409 con su mensaje).
 * - Que el pedido pueda pasar a 'pagado' lo valida tr_validar_transicion_estado
 *   contra transiciones_validas (solo es legal desde 'entregado').
 * - Liberar la mesa y rotar su token_qr lo hace el trigger tr_regenerar_token_qr
 *   al ver el pedido en 'pagado': por eso aquí ya NO se toca la tabla mesas.
 *
 * id_usuario es el cajero/admin que cobra, y queda en historial_estados.
 */
async function registrarPago({
  id_pedido,
  monto,
  metodo_pago,
  referencia_externa,
  estado_transaccion,
  id_usuario = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const pedidoResult = await client.query('SELECT * FROM pedidos WHERE id_pedido = $1', [id_pedido]);
    if (pedidoResult.rows.length === 0) {
      throw { status: 404, message: 'Pedido no encontrado' };
    }
    const pedido = pedidoResult.rows[0];

    const estado = estado_transaccion || ESTADO_COBRADO;

    const transaccionResult = await client.query(
      `INSERT INTO transacciones
        (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa, creado_en)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [id_pedido, metodo_pago, monto, estado, referencia_externa || null]
    );

    // Solo un cobro efectivo liquida el pedido. Una transacción 'pendiente' o
    // 'fallida' queda registrada, pero el pedido NO pasa a 'pagado': si pasara,
    // un pago rechazado liberaría la mesa (vía tr_regenerar_token_qr) y dejaría
    // la cuenta como cobrada.
    if (estado === ESTADO_COBRADO) {
      await client.query(`UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1`, [id_pedido]);
      await client.query(
        `INSERT INTO historial_estados
          (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones, fecha_cambio)
         VALUES ($1, $2, $3, 'pagado', 'Pago registrado', NOW())`,
        [id_pedido, id_usuario, pedido.estado]
      );
    }

    await client.query('COMMIT');
    return transaccionResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function obtenerPorPedido(idPedido) {
  const result = await pool.query(
    'SELECT * FROM transacciones WHERE id_pedido = $1 ORDER BY creado_en ASC',
    [idPedido]
  );
  return result.rows;
}

module.exports = { registrarPago, obtenerPorPedido, ESTADO_COBRADO };
