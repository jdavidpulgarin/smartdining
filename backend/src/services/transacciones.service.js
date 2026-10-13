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

// Estado del que el trigger tr_validar_transicion_estado deja pasar a 'pagado'.
// Es la única transición legal hacia pagado (transiciones_validas).
const ESTADO_ENTREGADO = 'entregado';

// Pedidos que ya no cuentan para la cuenta de la mesa.
const SQL_PEDIDOS_CON_SALDO = `
  SELECT p.id_pedido, p.estado,
         ROUND(obtener_saldo_pendiente(p.id_pedido) * 100)::bigint AS saldo_centavos
  FROM pedidos p
  WHERE p.id_mesa = $1 AND p.estado <> 'cancelado'
  ORDER BY p.creado_en ASC, p.id_pedido ASC`;

const SQL_SALDO_DE_LA_MESA = `
  SELECT COALESCE(SUM(ROUND(obtener_saldo_pendiente(p.id_pedido) * 100)::bigint), 0)::bigint
         AS saldo_centavos
  FROM pedidos p
  WHERE p.id_mesa = $1 AND p.estado <> 'cancelado'`;

/** Saldo de la mesa en centavos, con el ejecutor que se le pase. */
async function saldoDeLaMesaEnCentavos(ejecutor, idMesa) {
  const r = await ejecutor.query(SQL_SALDO_DE_LA_MESA, [idMesa]);
  return Number(r.rows[0].saldo_centavos);
}

/**
 * Referencia de cada fila del reparto.
 *
 * `transacciones.referencia_externa` tiene un índice único
 * (uq_transacciones_referencia_externa), así que un pago que se reparte entre
 * varios pedidos no puede repetir la referencia de la pasarela. La primera fila
 * la lleva tal cual —es la que se busca para la idempotencia y la que cuadra
 * con el extracto de Wompi— y las siguientes llevan `referencia#2`,
 * `referencia#3`… El sufijo es un detalle del almacenamiento, no del contrato.
 */
function referenciaDeFila(referencia, indice) {
  return indice === 0 ? referencia : `${referencia}#${indice + 1}`;
}

/**
 * Registra un pago de la pasarela (lo llama el socket-server, EVENTS.md §8.4).
 *
 * El pago es **de la mesa**, no de un pedido: Wompi cobra un monto y aquí se
 * reparte entre los pedidos abiertos de esa mesa, del más antiguo al más nuevo,
 * en UNA sola transacción. La base sigue siendo la autoridad: el monto contra
 * el total lo valida tr_validar_transaccion_financiera y la transición a
 * 'pagado' la valida tr_validar_transicion_estado.
 *
 * Todo lo que decide esta función es el reparto y a quién le toca cada peso;
 * ningún total se recalcula en JavaScript. Los montos viajan en centavos
 * enteros y la división por 100 se hace en SQL, para no meter coma flotante en
 * una cuenta.
 *
 * @returns { noExiste: true }
 *        | { duplicado: true, saldo_restante_centavos }
 *        | { sinCuenta: true } | { excede: true, saldo_centavos }
 *        | { duplicado: false, saldo_restante_centavos, mesa_liberada, pagados }
 */
async function registrarPagoInterno({
  referencia_externa,
  id_mesa,
  comensal = null,
  monto_centavos,
  metodo_pago = 'online',
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // La fila de la mesa se bloquea de entrada: dos webhooks de Wompi para la
    // misma mesa (o un webhook y un cobro en caja) se serializan, así no se
    // reparte dos veces sobre el mismo saldo.
    const mesa = await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [
      id_mesa,
    ]);
    if (mesa.rows.length === 0) {
      await client.query('ROLLBACK');
      return { noExiste: true };
    }

    // Idempotencia: Wompi reintenta el mismo evento. Si la referencia ya está
    // registrada, no se cobra otra vez; se contesta qué saldo hay ahora.
    const yaRegistrada = await client.query(
      'SELECT 1 FROM transacciones WHERE referencia_externa = $1 LIMIT 1',
      [referencia_externa]
    );
    if (yaRegistrada.rows.length > 0) {
      const saldo = await saldoDeLaMesaEnCentavos(client, id_mesa);
      await client.query('ROLLBACK');
      return { duplicado: true, saldo_restante_centavos: saldo };
    }

    const pedidos = (await client.query(SQL_PEDIDOS_CON_SALDO, [id_mesa])).rows
      .map((p) => ({ ...p, saldo_centavos: Number(p.saldo_centavos) }))
      .filter((p) => p.saldo_centavos > 0);

    if (pedidos.length === 0) {
      await client.query('ROLLBACK');
      return { sinCuenta: true };
    }

    const saldoMesa = pedidos.reduce((s, p) => s + p.saldo_centavos, 0);
    if (monto_centavos > saldoMesa) {
      await client.query('ROLLBACK');
      return { excede: true, saldo_centavos: saldoMesa };
    }

    // Reparto: cada pedido recibe hasta su saldo, empezando por el más viejo.
    let restante = monto_centavos;
    const pagados = [];
    let filas = 0;

    for (const pedido of pedidos) {
      if (restante <= 0) break;
      const aplicado = Math.min(restante, pedido.saldo_centavos);
      restante -= aplicado;

      await client.query(
        `INSERT INTO transacciones
          (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa, comensal, creado_en)
         VALUES ($1, $2, ($3::bigint)::numeric / 100, 'completada', $4, $5, NOW())`,
        [
          pedido.id_pedido,
          metodo_pago,
          aplicado,
          referenciaDeFila(referencia_externa, filas),
          comensal,
        ]
      );
      filas += 1;

      // Un pedido se liquida solo si quedó en cero Y ya está entregado: el
      // trigger no deja pasar a 'pagado' desde otro estado. Si todavía está en
      // cocina, el pago queda registrado y el pedido sigue su curso; al llegar
      // a entregado el saldo ya es 0 y la caja no vuelve a cobrar.
      const liquidado = aplicado === pedido.saldo_centavos;
      if (liquidado && pedido.estado === ESTADO_ENTREGADO) {
        await client.query(`UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1`, [
          pedido.id_pedido,
        ]);
        await client.query(
          `INSERT INTO historial_estados
            (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones, fecha_cambio)
           VALUES ($1, NULL, $2, 'pagado', 'Pago en linea', NOW())`,
          [pedido.id_pedido, pedido.estado]
        );
        pagados.push({ id_pedido: pedido.id_pedido, estado_anterior: pedido.estado });
      }
    }

    // Si esta pasada cerró el último pedido abierto, la mesa se libera en la
    // misma transacción (igual que al cobrar en caja).
    let mesa_liberada = false;
    if (pagados.length > 0) {
      mesa_liberada = await mesasService.liberarSiNoQuedanPedidosAbiertos(client, id_mesa);
    }

    const saldo_restante_centavos = await saldoDeLaMesaEnCentavos(client, id_mesa);

    await client.query('COMMIT');
    return { duplicado: false, saldo_restante_centavos, mesa_liberada, pagados };
  } catch (err) {
    await client.query('ROLLBACK');

    // Carrera con otro webhook del mismo evento: el índice único de la
    // referencia es la última palabra. Cuenta como duplicado, no como error.
    if (err && err.code === '23505') {
      return {
        duplicado: true,
        saldo_restante_centavos: await saldoDeLaMesaEnCentavos(pool, id_mesa),
      };
    }
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

module.exports = {
  registrarPago,
  registrarPagoInterno,
  obtenerPorPedido,
  referenciaDeFila,
  ESTADO_COBRADO,
  ESTADO_ENTREGADO,
};
