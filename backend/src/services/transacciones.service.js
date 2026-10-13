const pool = require('../config/db');
const mesasService = require('./mesas.service');

// Tabla transacciones (docs/modelo-er.md): id_transaccion, id_pedido,
// metodo_pago, monto, estado_transaccion, referencia_externa, creado_en.

// Unico estado_transaccion que liquida el pedido. Es tambien el que hace que el
// trigger tr_validar_transaccion_financiera compruebe monto contra el total.
const ESTADO_COBRADO = 'completada';

/**
 * Registra el pago de un pedido y, si con él se liquidó la cuenta, lo marca
 * 'pagado'.
 *
 * Admite **abonos parciales**: se registran y el pedido sigue abierto hasta que
 * el saldo llega a cero. Quién decide eso es la base (obtener_saldo_pendiente),
 * no este archivo.
 *
 * La base es la fuente de verdad y aquí no se replica su lógica:
 * - Que el monto no exceda el total del pedido lo valida el trigger
 *   tr_validar_transaccion_financiera (409 con su mensaje). Ojo: ese trigger
 *   solo rechaza el exceso, no el pago de menos.
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

    // Un cobro efectivo liquida el pedido SOLO si no queda saldo.
    //
    // No basta con que la transacción sea 'completada': el trigger
    // tr_validar_transaccion_financiera únicamente rechaza que se pague de MÁS,
    // así que un abono parcial entra sin problema. Si eso marcara el pedido
    // 'pagado', abonar 1.000 de una cuenta de 56.000 la dejaría como cobrada,
    // liberaría la mesa, invalidaría el QR del grupo y el resto no se volvería
    // a cobrar nunca.
    //
    // El saldo lo calcula la base dentro de esta misma transacción, así que la
    // consulta ya ve el INSERT de arriba. Se compara contra cero en SQL y no en
    // JavaScript: obtener_saldo_pendiente devuelve DECIMAL exacto y pasarlo por
    // un Number sería meter coma flotante en una cuenta.
    //
    // Una transacción 'pendiente', 'fallida' o 'reembolsada' no liquida nada,
    // igual que antes: un pago rechazado no puede cerrar la cuenta.
    let pedidoLiquidado = false;
    if (estado === ESTADO_COBRADO) {
      const saldo = await client.query(
        'SELECT obtener_saldo_pendiente($1) <= 0 AS liquidado',
        [id_pedido]
      );
      pedidoLiquidado = saldo.rows[0].liquidado === true;
    }

    if (pedidoLiquidado) {
      // Que el pedido pueda pasar a 'pagado' lo decide el trigger
      // tr_validar_transicion_estado: solo es legal desde 'entregado'. Cobrar
      // desde otro estado sigue respondiendo 409 con su mensaje.
      await client.query(`UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1`, [id_pedido]);
      await client.query(
        `INSERT INTO historial_estados
          (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones, fecha_cambio)
         VALUES ($1, $2, $3, 'pagado', 'Pago registrado', NOW())`,
        [id_pedido, id_usuario, pedido.estado]
      );
    }

    // El pedido quedó cerrado: si la mesa no tiene otros pedidos abiertos, se
    // libera en esta misma transacción (estado 'disponible' y token_qr en NULL).
    // Con saldo pendiente la mesa sigue ocupada: el grupo no ha terminado.
    let mesaLiberada = false;
    if (pedidoLiquidado) {
      mesaLiberada = await mesasService.liberarSiNoQuedanPedidosAbiertos(client, pedido.id_mesa);
    }

    await client.query('COMMIT');
    // Se devuelve qué pasó, para que el controller avise al socket-server
    // después del commit sin volver a consultar. Un abono parcial no cambió
    // nada que el tiempo real deba anunciar.
    return {
      transaccion: transaccionResult.rows[0],
      pedidoLiquidado,
      mesaLiberada,
      id_mesa: pedido.id_mesa,
    };
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
