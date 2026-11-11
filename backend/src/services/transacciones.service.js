const pool = require('../config/db');
const mesasService = require('./mesas.service');
const { traducirAutorInexistente } = require('./autor-inexistente');

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
 *   contra transiciones_validas (solo es legal desde 'entregado'); por eso aquí
 *   solo se intenta cuando el pedido ya está entregado, para que cobrar antes
 *   no haga ROLLBACK del pago.
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
  comensal = null,
  id_usuario = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Primera lectura sin bloquear, solo para saber de qué mesa es y poder
    // tomar los bloqueos en el orden correcto (ver más abajo).
    const previo = await client.query('SELECT * FROM pedidos WHERE id_pedido = $1', [id_pedido]);
    if (previo.rows.length === 0) {
      throw { status: 404, message: 'Pedido no encontrado' };
    }

    // ORDEN DE BLOQUEOS, SIEMPRE EL MISMO: primero la mesa, después los pedidos
    // por id. registrarPagoInterno (el pago en línea) hace lo mismo, y dos
    // caminos que bloquean en orden distinto sobre las mismas filas se
    // interbloquean: la caja tendría el pedido esperando la mesa mientras Wompi
    // tiene la mesa esperando el pedido.
    await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [
      previo.rows[0].id_mesa,
    ]);

    // H-01: la fila del pedido se bloquea ANTES de calcular el saldo e insertar.
    // Sin esto, dos cobros simultáneos del mismo pedido leen el mismo saldo y
    // los dos pasan la validación del trigger, que mira "lo pagado hasta ahora":
    // un pedido de 34.000 se podía cobrar dos veces de 20.000. Con el bloqueo el
    // segundo espera, vuelve a leer y el trigger lo rechaza con su 409.
    //
    // Se relee la fila completa estando bloqueada: el estado que había antes de
    // esperar puede haber cambiado, y es ese el que se registra en el historial.
    const pedidoResult = await client.query(
      'SELECT * FROM pedidos WHERE id_pedido = $1 FOR UPDATE',
      [id_pedido]
    );
    if (pedidoResult.rows.length === 0) {
      throw { status: 404, message: 'Pedido no encontrado' };
    }
    const pedido = pedidoResult.rows[0];

    const estado = estado_transaccion || ESTADO_COBRADO;

    // comensal queda NULL en un cobro de la mesa completa (lo normal en caja).
    // Con alias, obtener_cuenta_mesa descuenta el pago del saldo de esa persona.
    const transaccionResult = await client.query(
      `INSERT INTO transacciones
        (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa, comensal, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [id_pedido, metodo_pago, monto, estado, referencia_externa || null, comensal || null]
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

    // REGLA DE CIERRE: un pedido pasa a 'pagado' cuando está entregado Y
    // totalmente pagado, en cualquiera de los dos órdenes.
    //
    // Aquí se resuelve el orden "primero se paga": si la comida todavía no
    // salió, la transacción queda registrada y el estado NO se toca. Antes se
    // intentaba el UPDATE a 'pagado' igualmente y el trigger
    // tr_validar_transicion_estado abortaba con su 409, lo que hacía ROLLBACK de
    // toda la transacción y **se perdía el pago entero** (medido: pedido en
    // 'listo' cobrado completo → 409 y cero filas en transacciones). El otro
    // orden lo cierra pedidosService.actualizarEstado al marcar 'entregado'.
    //
    // Es el mismo criterio que ya aplicaba registrarPagoInterno para el pago en
    // línea; lo que faltaba era que la caja hiciera lo mismo.
    const pedidoCerrado = pedidoLiquidado && pedido.estado === ESTADO_ENTREGADO;

    if (pedidoCerrado) {
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
    // Con saldo pendiente la mesa sigue ocupada: el grupo no ha terminado. Y si
    // se pagó pero la comida no ha salido, tampoco: la mesa se libera al
    // entregar, nunca solo por haber pagado, para no invalidar el QR de alguien
    // que sigue esperando su plato.
    let mesaLiberada = false;
    if (pedidoCerrado) {
      mesaLiberada = await mesasService.liberarSiNoQuedanPedidosAbiertos(client, pedido.id_mesa);
    }

    // Saldo de LA MESA después de este cobro, para el aviso de
    // payment:confirmed (EVENTS.md §8.6: el campo es el de la mesa, no el del
    // pedido, igual que en el payload de Wompi).
    //
    // Se calcula DENTRO de la transacción, con la fila de la mesa todavía
    // bloqueada: así el número es exactamente el de después de este pago. Leerlo
    // tras el COMMIT con el pool podría ver el efecto de un cobro ajeno y
    // anunciar un saldo que no corresponde a este aviso. Es una lectura, no
    // toma bloqueos nuevos ni alarga los que ya hay.
    const saldoMesaCentavos = await saldoDeLaMesaEnCentavos(client, pedido.id_mesa);

    await client.query('COMMIT');
    // Se devuelve qué pasó, para que el controller avise al socket-server
    // después del commit sin volver a consultar. Un abono parcial no cambió
    // el estado de nada, pero sí el saldo: eso también se anuncia.
    return {
      transaccion: transaccionResult.rows[0],
      // Saldo en cero: la cuenta está cubierta. No implica que el pedido haya
      // cambiado de estado.
      pedidoLiquidado,
      // El pedido quedó en 'pagado' ahora mismo. Es lo que mira el controller
      // para anunciar el cambio de estado: anunciar 'pagado' de un pedido que
      // sigue en cocina le diría al comensal y al KDS algo que no pasó.
      pedidoCerrado,
      mesaLiberada,
      id_mesa: pedido.id_mesa,
      saldoMesaCentavos,
      // El estado con el que QUEDÓ la transacción, ya con el valor por omisión
      // aplicado. Lo mira el controller para no anunciar como cobro un pago
      // 'pendiente', 'fallido' o 'reembolsado': ese dinero no entró.
      estadoTransaccion: estado,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    // El AUTOR, otra vez por la misma clave ajena: cuando el cobro liquida la
    // cuenta de un pedido ya entregado, este servicio escribe la linea de
    // historial_estados del paso a 'pagado' con el id del cajero. Si ese
    // usuario ya se borro, el 23503 de fk_historial_usuario salia como el 409
    // generico. Lo demas no cambia: el P0001 de tr_validar_transaccion_financiera
    // -pagar de mas- sigue llegando con el mensaje del trigger.
    throw traducirAutorInexistente(err) || err;
  } finally {
    client.release();
  }
}

// Estado del que el trigger tr_validar_transicion_estado deja pasar a 'pagado'.
// Es la única transición legal hacia pagado (transiciones_validas).
const ESTADO_ENTREGADO = 'entregado';

/**
 * Pedidos de la mesa que cuentan para la cuenta, con su saldo en centavos.
 *
 * Solo los de la VISITA ACTUAL: `mesas.sesion_iniciada_en` (script 17) marca
 * cuándo se sentó el grupo que está ahora. Sin ese filtro, un pedido sin pagar
 * del grupo anterior se mezclaría en la cuenta de este y el pago en línea de
 * alguien que solo debe lo suyo se repartiría hacia una deuda que no es suya.
 *
 * Es el mismo criterio que usan las funciones de Jarrison
 * (obtener_cuenta_mesa, procesar_pago_comensal_mesa), para que la cuenta que se
 * muestra y el pago que se reparte hablen de los mismos pedidos.
 *
 * sesion_iniciada_en en NULL (mesa que nunca se abrió desde el script 17)
 * significa "sin sesión delimitada": entran todos, como antes.
 */
const SQL_PEDIDOS_CON_SALDO = `
  SELECT p.id_pedido, p.estado,
         ROUND(obtener_saldo_pendiente(p.id_pedido) * 100)::bigint AS saldo_centavos
  FROM pedidos p
  JOIN mesas m ON m.id_mesa = p.id_mesa
  WHERE p.id_mesa = $1
    AND p.estado <> 'cancelado'
    AND (m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en)
  ORDER BY p.creado_en ASC, p.id_pedido ASC`;

const SQL_SALDO_DE_LA_MESA = `
  SELECT COALESCE(SUM(ROUND(obtener_saldo_pendiente(p.id_pedido) * 100)::bigint), 0)::bigint
         AS saldo_centavos
  FROM pedidos p
  JOIN mesas m ON m.id_mesa = p.id_mesa
  WHERE p.id_mesa = $1
    AND p.estado <> 'cancelado'
    AND (m.sesion_iniciada_en IS NULL OR p.creado_en >= m.sesion_iniciada_en)`;

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

/** Observación del historial cuando el pago de la mesa llega por Wompi. */
const OBSERVACION_PAGO_EN_LINEA = 'Pago en linea';
/** Observación del historial cuando la caja cobra la mesa. */
const OBSERVACION_PAGO_EN_CAJA = 'Pago en caja';
/** Prefijo de la referencia de un cobro de mesa en caja: no choca con las de Wompi. */
const PREFIJO_REFERENCIA_CAJA = 'caja:';

/** Las únicas observaciones posibles: van como literal en el SQL, así que se cierran aquí. */
const OBSERVACIONES_DE_PAGO = [OBSERVACION_PAGO_EN_LINEA, OBSERVACION_PAGO_EN_CAJA];

/**
 * El INSERT de historial_estados del paso a 'pagado'.
 *
 * Sin autor (Wompi) es EXACTAMENTE la sentencia de siempre —`NULL` y la
 * observación como literales, `estado_anterior` en `$2`—, para que el pago en
 * línea no cambie ni en el SQL que manda. Con autor (la caja), el id va como
 * `$3::int`, de modo que `estado_anterior` sigue en `$2` en los dos casos.
 *
 * La observación se escribe como literal porque no viene de ninguna petición:
 * solo puede ser una de OBSERVACIONES_DE_PAGO, y cualquier otra cosa lanza.
 */
function sqlHistorialPagado(idUsuario, observacion) {
  if (!OBSERVACIONES_DE_PAGO.includes(observacion)) {
    throw new Error('observación de pago desconocida');
  }
  const cabecera = `INSERT INTO historial_estados
          (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones, fecha_cambio)`;
  if (idUsuario === null || idUsuario === undefined) {
    return {
      sql: `${cabecera}
         VALUES ($1, NULL, $2, 'pagado', '${observacion}', NOW())`,
      params: (pedido) => [pedido.id_pedido, pedido.estado],
    };
  }
  return {
    sql: `${cabecera}
         VALUES ($1::int, $3::int, $2::text, 'pagado', '${observacion}', NOW())`,
    params: (pedido) => [pedido.id_pedido, pedido.estado, idUsuario],
  };
}

/**
 * NÚCLEO COMPARTIDO del pago de una MESA: lo usan el pago en línea
 * (registrarPagoInterno, Wompi) y el cobro de mesa en caja (cobrarMesaEnCaja).
 *
 * Recibe el `client` YA dentro de una transacción y no hace BEGIN, COMMIT ni
 * ROLLBACK: eso es de quien llama (`cobrarMesa`). Así los dos caminos reparten
 * exactamente igual y solo difieren en la referencia, el autor del historial y
 * su observación.
 *
 * El pago es **de la mesa**, no de un pedido: se reparte entre los pedidos
 * abiertos de esa mesa, del más antiguo al más nuevo. La base sigue siendo la
 * autoridad: el monto contra el total lo valida tr_validar_transaccion_financiera
 * y la transición a 'pagado' la valida tr_validar_transicion_estado.
 *
 * Todo lo que decide esta función es el reparto y a quién le toca cada peso;
 * ningún total se recalcula en JavaScript. Los montos viajan en centavos
 * enteros y la división por 100 se hace en SQL, para no meter coma flotante en
 * una cuenta.
 *
 * @param {import('pg').PoolClient} client cliente con la transacción abierta.
 * @param {object} pago
 * @param {string} pago.referencia_externa  la de Wompi, o 'caja:' + id_cobro.
 * @param {number} pago.id_mesa
 * @param {string|null} pago.comensal
 * @param {number} pago.monto_centavos      entero > 0.
 * @param {string} pago.metodo_pago
 * @param {number|null} pago.id_usuario     autor de la línea de historial (NULL en Wompi).
 * @param {string} pago.observacion         'Pago en linea' o 'Pago en caja'.
 * @returns { noExiste: true }
 *        | { duplicado: true, saldo_restante_centavos }
 *        | { sinCuenta: true } | { excede: true, saldo_centavos }
 *        | { duplicado: false, saldo_restante_centavos, mesa_liberada, pagados, transacciones }
 */
async function repartirPagoDeMesa(client, {
  referencia_externa,
  id_mesa,
  comensal,
  monto_centavos,
  metodo_pago,
  id_usuario,
  observacion,
}) {
  // La fila de la mesa se bloquea de entrada: dos webhooks de Wompi para la
  // misma mesa (o un webhook y un cobro en caja) se serializan, así no se
  // reparte dos veces sobre el mismo saldo.
  const mesa = await client.query('SELECT id_mesa FROM mesas WHERE id_mesa = $1 FOR UPDATE', [
    id_mesa,
  ]);
  if (mesa.rows.length === 0) return { noExiste: true };

  // Idempotencia: Wompi reintenta el mismo evento, y la caja reintenta el mismo
  // id_cobro. Si la referencia ya está registrada, no se cobra otra vez; se
  // contesta qué saldo hay ahora.
  const yaRegistrada = await client.query(
    'SELECT 1 FROM transacciones WHERE referencia_externa = $1 LIMIT 1',
    [referencia_externa]
  );
  if (yaRegistrada.rows.length > 0) {
    const saldo = await saldoDeLaMesaEnCentavos(client, id_mesa);
    return { duplicado: true, saldo_restante_centavos: saldo };
  }

  // H-01: los pedidos entre los que se va a repartir también se bloquean,
  // ORDENADOS POR id_pedido y después de la mesa. Es el mismo orden que usa
  // registrarPago (mesa primero, pedidos por id), que es lo que evita el
  // interbloqueo entre el cobro en caja y el pago en línea.
  //
  // Sin este bloqueo, dos webhooks sobre mesas distintas que comparten un
  // pedido no pueden chocar, pero un webhook y una caja sobre el MISMO pedido
  // sí: los dos leerían el mismo saldo pendiente.
  await client.query(
    `SELECT id_pedido FROM pedidos
      WHERE id_mesa = $1 AND estado <> 'cancelado'
      ORDER BY id_pedido ASC
      FOR UPDATE`,
    [id_mesa]
  );

  const pedidos = (await client.query(SQL_PEDIDOS_CON_SALDO, [id_mesa])).rows
    .map((p) => ({ ...p, saldo_centavos: Number(p.saldo_centavos) }))
    .filter((p) => p.saldo_centavos > 0);

  if (pedidos.length === 0) return { sinCuenta: true };

  const saldoMesa = pedidos.reduce((s, p) => s + p.saldo_centavos, 0);
  if (monto_centavos > saldoMesa) return { excede: true, saldo_centavos: saldoMesa };

  // Reparto: cada pedido recibe hasta su saldo, empezando por el más viejo.
  let restante = monto_centavos;
  const pagados = [];
  const transacciones = [];
  let filas = 0;

  for (const pedido of pedidos) {
    if (restante <= 0) break;
    const aplicado = Math.min(restante, pedido.saldo_centavos);
    restante -= aplicado;

    // Tipos explícitos en cada parámetro: un mismo $N, siempre el mismo tipo.
    const fila = await client.query(
      `INSERT INTO transacciones
        (id_pedido, metodo_pago, monto, estado_transaccion, referencia_externa, comensal, creado_en)
       VALUES ($1::int, $2::text, ($3::bigint)::numeric / 100, 'completada', $4::text, $5::text, NOW())
       RETURNING id_transaccion, id_pedido, monto, comensal`,
      [
        pedido.id_pedido,
        metodo_pago,
        aplicado,
        referenciaDeFila(referencia_externa, filas),
        comensal,
      ]
    );
    filas += 1;
    // PostgreSQL siempre devuelve la fila; el `|| {}` es para los dobles de
    // pruebas anteriores al RETURNING, que no la traen.
    const t = (fila && fila.rows && fila.rows[0]) || {};
    transacciones.push({
      id_transaccion: t.id_transaccion ?? null,
      id_pedido: t.id_pedido ?? pedido.id_pedido,
      monto_centavos: aplicado,
      comensal: t.comensal ?? comensal ?? null,
    });

    // Un pedido se liquida solo si quedó en cero Y ya está entregado: el
    // trigger no deja pasar a 'pagado' desde otro estado. Si todavía está en
    // cocina, el pago queda registrado y el pedido sigue su curso; al llegar
    // a entregado el saldo ya es 0 y la caja no vuelve a cobrar.
    const liquidado = aplicado === pedido.saldo_centavos;
    if (liquidado && pedido.estado === ESTADO_ENTREGADO) {
      await client.query(`UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1`, [
        pedido.id_pedido,
      ]);
      // El autor: NULL para Wompi (no hay usuario), el del JWT para la caja.
      const historial = sqlHistorialPagado(id_usuario, observacion);
      await client.query(historial.sql, historial.params(pedido));
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

  return { duplicado: false, saldo_restante_centavos, mesa_liberada, pagados, transacciones };
}

/**
 * La TRANSACCIÓN alrededor del núcleo: BEGIN, reparto, COMMIT solo si se cobró,
 * y ROLLBACK en cualquier otro caso. Una carrera con el mismo pago (23505 del
 * índice único de la referencia) cuenta como duplicado; el 23503 del autor del
 * historial se traduce a 409 autor_inexistente, con la transacción deshecha.
 */
async function cobrarMesa(pago) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await repartirPagoDeMesa(client, pago);
    // Las salidas tempranas (sin mesa, duplicado, sin cuenta, excede) no
    // escribieron nada: se cierran con ROLLBACK, como siempre.
    await client.query(r.duplicado === false ? 'COMMIT' : 'ROLLBACK');
    return r;
  } catch (err) {
    await client.query('ROLLBACK');

    // Carrera con otro intento del mismo pago (el mismo evento de Wompi o el
    // mismo id_cobro de la caja): el índice único de la referencia es la
    // última palabra. Cuenta como duplicado, no como error.
    if (err && err.code === '23505') {
      return {
        duplicado: true,
        saldo_restante_centavos: await saldoDeLaMesaEnCentavos(pool, pago.id_mesa),
      };
    }
    // El 23503 de fk_historial_usuario (la caja, con un autor ya borrado) lo
    // atrapa el helper compartido, como en el resto de rutas.
    throw traducirAutorInexistente(err) || err;
  } finally {
    client.release();
  }
}

/**
 * Registra un pago de la pasarela (lo llama el socket-server, EVENTS.md §8.4).
 *
 * Es el núcleo compartido (`repartirPagoDeMesa`) sin autor en el historial y
 * con la observación 'Pago en linea'. Devuelve EXACTAMENTE las mismas claves
 * que antes de extraer el núcleo: la lista de transacciones que también arma el
 * núcleo no sale por aquí.
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
  const r = await cobrarMesa({
    referencia_externa,
    id_mesa,
    comensal,
    monto_centavos,
    metodo_pago,
    id_usuario: null,
    observacion: OBSERVACION_PAGO_EN_LINEA,
  });
  if (r.duplicado !== false) return r;
  const { transacciones, ...igualQueAntes } = r;
  return igualQueAntes;
}

/**
 * Cobro de MESA en caja (POST /transacciones/mesa): la caja cobra un monto a
 * la mesa y se reparte entre sus pedidos con saldo, del más viejo al más
 * nuevo, igual que un pago en línea. El autor del historial es quien cobra (el
 * id del JWT) y la observación, 'Pago en caja'.
 *
 * La referencia es 'caja:' + id_cobro: reutiliza el índice único de las
 * referencias y su idempotencia (el reintento con el mismo id_cobro no cobra),
 * sin chocar nunca con una de Wompi.
 */
async function cobrarMesaEnCaja({ id_mesa, monto_centavos, metodo_pago, comensal = null, id_cobro, id_usuario }) {
  return cobrarMesa({
    referencia_externa: PREFIJO_REFERENCIA_CAJA + id_cobro,
    id_mesa,
    comensal,
    monto_centavos,
    metodo_pago,
    id_usuario,
    observacion: OBSERVACION_PAGO_EN_CAJA,
  });
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
  cobrarMesaEnCaja,
  repartirPagoDeMesa,
  obtenerPorPedido,
  OBSERVACION_PAGO_EN_LINEA,
  OBSERVACION_PAGO_EN_CAJA,
  PREFIJO_REFERENCIA_CAJA,
  referenciaDeFila,
  ESTADO_COBRADO,
  ESTADO_ENTREGADO,
};
