const pool = require('../config/db');

/**
 * Intentos de pago que la pasarela no dejó pasar, o que el socket-server
 * descartó al reverificarlos con Wompi (EVENTS.md §8.5).
 *
 * Es una bitácora para que el personal revise: aquí no se cobra nada ni se
 * toca la cuenta de la mesa. Por eso un intento fallido nunca debe hacer
 * fallar al socket-server — si la mesa de la referencia no existe, se guarda
 * el intento con id_mesa en NULL en vez de perderlo.
 */

/**
 * Guarda un intento fallido si no estaba ya.
 *
 * Idempotente por (referencia_externa, id_transaccion_pasarela,
 * razon_rechazo): Wompi reintenta el mismo evento y el webhook lo reenvía, pero
 * la alerta es la misma. No hay índice único para esa terna, así que la
 * comprobación se hace aquí, dentro de una transacción con la fila bloqueada
 * por el SELECT para que dos reintentos a la vez no inserten dos filas.
 *
 * `monto_esperado_centavos` se valida en el controller pero NO se guarda:
 * intentos_pago_fallidos no tiene columna para él (ver reporte).
 *
 * @returns {Promise<{duplicado: boolean, id_intento: number|null}>}
 */
async function registrarIntentoFallido({
  referencia_externa,
  id_transaccion_pasarela,
  pasarela,
  id_mesa,
  motivo,
  monto_centavos,
  moneda,
  metodo_pago,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // La mesa es solo contexto de la alerta: una referencia desconocida o de
    // otra instalación no tiene por qué existir aquí.
    const mesa = await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1', [id_mesa]);
    const idMesaGuardado = mesa.rows.length > 0 ? mesa.rows[0].id_mesa : null;

    const yaEsta = await client.query(
      `SELECT id_intento FROM intentos_pago_fallidos
       WHERE referencia_externa = $1 AND id_transaccion_pasarela = $2 AND razon_rechazo = $3
       LIMIT 1
       FOR UPDATE`,
      [referencia_externa, id_transaccion_pasarela, motivo]
    );
    if (yaEsta.rows.length > 0) {
      await client.query('COMMIT');
      return { duplicado: true, id_intento: yaEsta.rows[0].id_intento };
    }

    // id_pedido queda NULL: el pago es de la mesa y una referencia rechazada
    // puede no corresponder a ningún pedido. El monto se divide por 100 en SQL,
    // no en JavaScript.
    const insertado = await client.query(
      `INSERT INTO intentos_pago_fallidos
        (id_pedido, id_usuario, id_mesa, referencia_externa, id_transaccion_pasarela,
         pasarela, moneda, metodo_pago, monto, razon_rechazo)
       VALUES (NULL, NULL, $1, $2, $3, $4, $5, $6, ($7::bigint)::numeric / 100, $8)
       RETURNING id_intento`,
      [
        idMesaGuardado,
        referencia_externa,
        id_transaccion_pasarela,
        pasarela,
        moneda,
        metodo_pago,
        monto_centavos,
        motivo,
      ]
    );

    await client.query('COMMIT');
    return { duplicado: false, id_intento: insertado.rows[0].id_intento };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { registrarIntentoFallido };
