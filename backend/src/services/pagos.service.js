const pool = require('../config/db');

/**
 * Intentos de pago que la pasarela no dejó pasar, o que el socket-server
 * descartó al reverificarlos con Wompi (EVENTS.md §8.5).
 *
 * Es una bitácora para que el personal revise: aquí no se cobra nada ni se
 * toca la cuenta de la mesa, y tampoco se avisa a ninguna mesa — un intento
 * fallido no cambia la cuenta de nadie.
 *
 * Por eso se guarda lo que llegue y se degrada a NULL lo que no quepa, en vez
 * de rechazar la petición: la mesa puede no existir (referencia desconocida),
 * la moneda puede no ser COP (que es justo la alerta) y el monto puede faltar.
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
 * Importante para entender por qué esto es tan permisivo: el socket-server
 * **solo reintenta ante 5xx o error de red**. Un 4xx lo da por resuelto y la
 * alerta se pierde para siempre, así que rechazar un cuerpo raro es peor que
 * guardarlo incompleto.
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
    // otra instalación no tiene por qué existir aquí. Si llega null no se
    // consulta nada (ahorra un viaje y evita un SELECT con id_mesa = NULL, que
    // nunca devuelve filas); si llega un id inexistente se degrada a NULL para
    // no romper la FK fk_intento_mesa.
    let idMesaGuardado = null;
    if (id_mesa !== null && id_mesa !== undefined) {
      const mesa = await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1', [id_mesa]);
      idMesaGuardado = mesa.rows.length > 0 ? mesa.rows[0].id_mesa : null;
    }

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
    // no en JavaScript, y si viene NULL la división también da NULL (la CHECK
    // de la tabla exige monto > 0, así que 0 no se puede guardar).
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
        pasarela ?? null,
        // La moneda se guarda tal como llegó, sea COP o no: el motivo
        // ('moneda_distinta') es lo que explica la alerta, y perder el dato
        // dejaría al personal sin saber en qué moneda intentaron cobrar.
        moneda ?? null,
        metodo_pago,
        monto_centavos ?? null,
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
