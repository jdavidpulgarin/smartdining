const crypto = require('crypto');
const pool = require('../config/db');
const mesasService = require('./mesas.service');

/**
 * Dominio del CHECK de pedidos.estado. Se usa solo para validar que el body
 * traiga un estado existente (trabajo del backend); QUE transiciones son
 * legales lo decide el trigger tr_validar_transicion_estado contra la tabla
 * transiciones_validas, no este archivo.
 */
const ESTADOS_VALIDOS = ['recibido', 'en_preparacion', 'listo', 'entregado', 'pagado', 'cancelado'];

const MAX_INTENTOS_CODIGO = 5;

/**
 * Detalles con el nombre del plato y los ingredientes elegidos de cada ítem.
 *
 * Los ingredientes se traen en el mismo viaje con json_agg en vez de una
 * consulta por detalle: así leer un pedido es una sola consulta por más ítems
 * que tenga. Van ordenados por pasos_constructor.orden (Base, Proteína,
 * Toppings, Salsa) para que el KDS y la cuenta los muestren como se armaron, no
 * en el orden en que el cliente los mandó.
 *
 * precio_aplicado y precio_extras salen tal como los dejó la base; aquí no se
 * suma nada. FILTER evita que un ítem sin ingredientes traiga [null].
 *
 * Lo usan crearConDetalles (payload de order:created), obtenerConDetalles
 * (GET /pedidos/:id) y el KDS, que pasa una lista de pedidos.
 */
const SQL_DETALLES_CON_INGREDIENTES = `
  SELECT dp.*, pl.nombre AS plato_nombre, pl.personalizable,
         COALESCE(json_agg(
           json_build_object(
             'id_ingrediente', i.id_ingrediente,
             'nombre', i.nombre,
             'porcion', di.porcion,
             'precio_aplicado', di.precio_aplicado,
             'id_paso', pc.id_paso,
             'paso', pc.nombre
           ) ORDER BY pc.orden ASC, i.id_ingrediente ASC
         ) FILTER (WHERE di.id_ingrediente IS NOT NULL), '[]'::json) AS ingredientes
  FROM detalles_pedido dp
  JOIN platos pl ON pl.id_plato = dp.id_plato
  LEFT JOIN detalles_ingredientes di ON di.id_detalle = dp.id_detalle
  LEFT JOIN ingredientes i ON i.id_ingrediente = di.id_ingrediente
  LEFT JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
  WHERE dp.id_pedido = ANY($1::int[])
  GROUP BY dp.id_detalle, pl.nombre, pl.personalizable
  ORDER BY dp.id_detalle ASC`;

/**
 * codigo_pedido es VARCHAR(16) UNIQUE en el schema de Jarrison:
 * 'PED-' (4) + AAMMDD (6) + '-' (1) + 5 hex = 16 caracteres exactos.
 */
function generarCodigoPedido(fecha = new Date()) {
  const dia = fecha.toISOString().slice(2, 10).replace(/-/g, '');
  const aleatorio = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return `PED-${dia}-${aleatorio}`;
}

/**
 * Lee los detalles (con ingredientes) de uno o varios pedidos en una sola
 * consulta. Recibe el ejecutor para poder usarse dentro de una transacción
 * (crearConDetalles) o sobre el pool (lecturas sueltas y KDS).
 */
async function detallesDePedidos(idsPedido, ejecutor = pool) {
  if (idsPedido.length === 0) return [];
  const result = await ejecutor.query(SQL_DETALLES_CON_INGREDIENTES, [idsPedido]);
  return result.rows;
}

/**
 * Crea un pedido y sus detalles en una sola transacción.
 *
 * La base de datos es la fuente de verdad y aquí NO se replica su lógica:
 * - precio_unitario se congela leyendo platos.precio en el propio INSERT, así el
 *   precio histórico lo fija la base y nunca el body.
 * - subtotal lo calcula el trigger tr_validar_detalle_pedido.
 * - pedidos.total lo recalcula el trigger tr_actualizar_total_pedido, por eso el
 *   pedido se vuelve a leer al final en vez de sumar nada en JavaScript.
 * - que el plato exista y esté disponible lo valida tr_validar_disponibilidad_plato
 *   (responde 409 con su mensaje vía el manejador central de errores).
 *
 * El pedido pertenece a la mesa: id_usuario solo alimenta la auditoría de
 * historial_estados y va null cuando lo crea un comensal.
 */
async function crearConDetalles({ id_mesa, id_usuario = null, items, notas_generales = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // codigo_pedido es único: si choca con uno existente se reintenta con otro
    // sin abortar la transacción completa.
    let pedido = null;
    for (let intento = 0; intento < MAX_INTENTOS_CODIGO && !pedido; intento++) {
      await client.query('SAVEPOINT intento_codigo');
      try {
        const pedidoResult = await client.query(
          `INSERT INTO pedidos (id_mesa, codigo_pedido, notas_generales)
           VALUES ($1, $2, $3) RETURNING *`,
          [id_mesa, generarCodigoPedido(), notas_generales]
        );
        pedido = pedidoResult.rows[0];
      } catch (err) {
        if (err.code !== '23505') throw err;
        await client.query('ROLLBACK TO SAVEPOINT intento_codigo');
      }
    }
    if (!pedido) {
      throw { status: 500, message: 'No se pudo generar un codigo_pedido único' };
    }

    for (const item of items) {
      const detalle = await client.query(
        `INSERT INTO detalles_pedido
          (id_pedido, id_plato, cantidad, precio_unitario, notas_especiales, comensal)
         VALUES ($1, $2, $3, (SELECT precio FROM platos WHERE id_plato = $2), $4, $5)
         RETURNING id_detalle`,
        [
          pedido.id_pedido,
          item.id_plato,
          item.cantidad,
          // Solo la nota del ítem: el alias del comensal va en su propia columna.
          item.notas || null,
          item.comensal || null,
        ]
      );
      const idDetalle = detalle.rows[0].id_detalle;

      // precio_aplicado NO se manda: lo fija tr_validar_detalle_ingrediente
      // según la porción (solo 'extra' cobra ingredientes.precio_extra). Ese
      // mismo trigger rechaza un ingrediente que no sea del plato, uno agotado o
      // un pedido que ya salió de 'recibido', con un RAISE EXCEPTION que el
      // manejador central traduce a 409.
      for (const ingrediente of item.ingredientes || []) {
        await client.query(
          `INSERT INTO detalles_ingredientes (id_detalle, id_ingrediente, porcion)
           VALUES ($1, $2, $3)`,
          [idDetalle, ingrediente.id_ingrediente, ingrediente.porcion]
        );
      }

      // min_sel/max_sel de cada paso solo se pueden revisar cuando ya están
      // TODAS las selecciones del ítem, por eso es una llamada aparte y no un
      // trigger por fila. Va en esta misma transacción: si falta un paso
      // obligatorio, el error aborta todo y no queda pedido a medio armar.
      // Un plato no personalizable sale por el RETURN temprano de la función.
      await client.query('SELECT validar_selecciones_detalle($1)', [idDetalle]);
    }

    await client.query(
      `INSERT INTO historial_estados
        (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
       VALUES ($1, $2, NULL, 'recibido', 'Pedido creado')`,
      [pedido.id_pedido, id_usuario]
    );

    // El total y los subtotales los dejaron los triggers: se releen, no se calculan.
    const conTotal = await client.query('SELECT * FROM pedidos WHERE id_pedido = $1', [
      pedido.id_pedido,
    ]);

    // Los detalles ya enriquecidos se devuelven junto al pedido: los necesita el
    // payload de order:created (socket-server/EVENTS.md) y así se leen dentro de
    // la misma transacción, sin una consulta extra después del COMMIT.
    const detalles = await detallesDePedidos([pedido.id_pedido], client);

    await client.query('COMMIT');
    return { ...conTotal.rows[0], detalles };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Estados que el panel de sala considera "activo": el pedido sigue vivo para
 * alguien. Se queda fuera 'pagado' (ya se cobró y la mesa se liberó) y
 * 'cancelado' (se anuló).
 *
 * 'listo' y 'entregado' SÍ entran, y antes no: un pedido listo es justo el que
 * el mesero tiene que llevar, y uno entregado es el que hay que cobrar. Sin
 * ellos el panel perdía de vista los pedidos en el tramo donde más falta hace
 * verlos.
 */
const ESTADOS_ACTIVOS = ['recibido', 'en_preparacion', 'listo', 'entregado'];

/**
 * Pedidos activos para el panel del restaurante.
 *
 * `p.*` y no una lista de columnas: así todo lo que ya devolvía sigue estando
 * (compatible hacia atrás) y lo nuevo se agrega al lado.
 *
 * Se une con mesas para dar `mesa_numero`, que es lo que el panel muestra: el
 * número que el personal ve en el salón, no el id interno. Es un JOIN y no un
 * LEFT JOIN porque pedidos.id_mesa es NOT NULL con FK a mesas: todo pedido
 * tiene su mesa. Mismo alias y mismo nombre de campo que kds.service, para que
 * el panel y el KDS hablen igual.
 */
const SQL_PEDIDOS_ACTIVOS = `
  SELECT p.*, m.numero AS mesa_numero
  FROM pedidos p
  JOIN mesas m ON m.id_mesa = p.id_mesa
  WHERE p.estado = ANY($1::text[])
  ORDER BY p.creado_en ASC`;

/**
 * Lista los pedidos activos con sus ítems, en el MISMO formato que
 * GET /pedidos/:id y listarPorMesa: dos consultas fijas (pedidos + detalles de
 * todos ellos), no una por pedido, y el reparto lo hace agruparDetalles.
 */
async function listarActivos() {
  const result = await pool.query(SQL_PEDIDOS_ACTIVOS, [ESTADOS_ACTIVOS]);

  // Sin pedidos no hay nada que buscar: detallesDePedidos con lista vacía sería
  // una consulta de más (y un `= ANY('{}')` que nunca devuelve nada).
  if (result.rows.length === 0) return [];

  return agruparDetalles(result.rows, await detallesDePedidos(result.rows.map((p) => p.id_pedido)));
}

async function obtenerConDetalles(id) {
  const pedido = await pool.query('SELECT * FROM pedidos WHERE id_pedido = $1', [id]);
  if (pedido.rows.length === 0) return null;
  const detalles = await detallesDePedidos([pedido.rows[0].id_pedido]);
  return { ...pedido.rows[0], detalles };
}

// Estados en los que un pedido deja de ocupar la mesa.
const ESTADOS_CIERRE = ['pagado', 'cancelado'];

const ESTADO_ENTREGADO = 'entregado';
const ESTADO_PAGADO = 'pagado';

// Valor de pedidos.estado_pago (script 22) que significa cuenta cubierta. Esa
// columna la mantiene el trigger tr_sincronizar_estado_pago_pedido sobre
// transacciones; aquí solo se lee.
const ESTADO_PAGO_CUBIERTO = 'pagado';

/**
 * Estados cuyo cambio puede acabar tocando la tabla mesas, y que por eso tienen
 * que bloquear la mesa ANTES del pedido.
 *
 * 'entregado' está en la lista desde que marcar entregado puede cerrar el pedido
 * en 'pagado' y liberar la mesa (ver la regla de cierre más abajo). Sin esto el
 * camino iría pedido -> mesa mientras los pagos van mesa -> pedido, que es
 * exactamente el interbloqueo que se midió en 19 de 20 intentos.
 */
const ESTADOS_QUE_BLOQUEAN_LA_MESA = [...ESTADOS_CIERRE, ESTADO_ENTREGADO];

/**
 * Cambia el estado del pedido y lo registra en historial_estados.
 *
 * No valida la transición: si no está en transiciones_validas, el trigger
 * tr_validar_transicion_estado aborta el UPDATE con un RAISE EXCEPTION y el
 * manejador central lo devuelve como 409. actualizado_en también lo pone ese
 * trigger. id_usuario va null si el cambio lo hizo un comensal.
 */
async function actualizarEstado(id, estado, observaciones, id_usuario = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actual = await client.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [id]);
    if (actual.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const estadoAnterior = actual.rows[0].estado;

    // ORDEN DE BLOQUEOS: la mesa ANTES del pedido, igual que en los pagos.
    //
    // Un estado de cierre acaba llamando a liberarSiNoQuedanPedidosAbiertos,
    // que bloquea la mesa. Si el UPDATE del pedido fuera primero, este camino
    // iría pedido -> mesa mientras registrarPago va mesa -> pedido, y dos
    // operaciones simultáneas sobre el mismo pedido se interbloquean: medido en
    // 19 de 20 intentos (SQLSTATE 40P01) antes de este cambio.
    //
    // Solo para los estados que pueden tocar la mesa: una transición del KDS
    // (en_preparacion/listo) no la toca en ningún momento, así que bloquearla
    // ahí sería serializar las comandas de una mesa sin motivo.
    //
    // La mesa se identifica con una subconsulta en la misma sentencia, para no
    // leer y después bloquear (entre las dos cosas el pedido podría cambiar de
    // mesa, y además ahorra un viaje).
    if (ESTADOS_QUE_BLOQUEAN_LA_MESA.includes(estado)) {
      await client.query(
        `SELECT m.id_mesa FROM mesas m
          WHERE m.id_mesa = (SELECT p.id_mesa FROM pedidos p WHERE p.id_pedido = $1)
          FOR UPDATE`,
        [id]
      );
    }

    const result = await client.query(
      'UPDATE pedidos SET estado = $1 WHERE id_pedido = $2 RETURNING *',
      [estado, id]
    );

    await client.query(
      `INSERT INTO historial_estados
        (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, id_usuario, estadoAnterior, estado, observaciones || null]
    );

    let pedido = result.rows[0];

    // REGLA DE CIERRE: un pedido pasa a 'pagado' cuando está entregado Y
    // totalmente pagado, en cualquiera de los dos órdenes. Aquí se resuelve el
    // orden "primero se paga, después sale la comida", que es el del pago en
    // línea: el cobro ya ocurrió y dejó la cuenta en cero sin poder mover el
    // estado (el trigger solo deja pasar a 'pagado' desde 'entregado'), así que
    // el pedido se cierra en el momento en que el mesero lo entrega.
    //
    // Sin esto la mesa se quedaba ocupada para siempre: el pedido nunca volvía a
    // 'pagado', liberarSiNoQuedanPedidosAbiertos lo seguía contando como abierto
    // y ni el mesero ni la caja podían cerrar la mesa (medido: 409 "pedidos
    // abiertos" incluso después de entregar).
    //
    // Se mira estado_pago, que mantiene el trigger del script 22, y se confirma
    // con obtener_saldo_pendiente antes de cerrar: estado_pago se recalcula al
    // tocar transacciones, así que es la columna la que podría quedarse atrás
    // respecto del total, nunca el saldo. Dos fuentes de acuerdo para mover
    // dinero; con una sola se podría cerrar un pedido con saldo vivo.
    let cerradoPorPago = false;
    if (estado === ESTADO_ENTREGADO && pedido.estado_pago === ESTADO_PAGO_CUBIERTO) {
      const saldo = await client.query('SELECT obtener_saldo_pendiente($1) <= 0 AS liquidado', [id]);
      if (saldo.rows[0]?.liquidado === true) {
        const cerrado = await client.query(
          `UPDATE pedidos SET estado = 'pagado' WHERE id_pedido = $1 RETURNING *`,
          [id]
        );
        pedido = { ...pedido, ...(cerrado.rows[0] || {}), estado: ESTADO_PAGADO };
        await client.query(
          `INSERT INTO historial_estados
            (id_pedido, id_usuario, estado_anterior, estado_nuevo, observaciones)
           VALUES ($1, $2, $3, 'pagado', 'Cuenta ya cubierta al entregar')`,
          [id, id_usuario, ESTADO_ENTREGADO]
        );
        cerradoPorPago = true;
      }
    }

    // Si el pedido se cerró y la mesa no tiene otros pedidos abiertos, la mesa
    // se libera en esta misma transacción: el QR impreso deja de valer y las
    // sesiones de comensal de ese grupo caen. Se mira el estado FINAL, que con
    // la regla de cierre puede no ser el que pidió quien llamó.
    let mesaLiberada = false;
    if (ESTADOS_CIERRE.includes(pedido.estado)) {
      mesaLiberada = await mesasService.liberarSiNoQuedanPedidosAbiertos(client, pedido.id_mesa);
    }

    await client.query('COMMIT');
    // estado_anterior no es una columna de pedidos: se agrega al resultado
    // porque lo necesitan el payload de order:status y quien audite el cambio.
    // Es el estado del que se venía, aunque en medio se haya pasado por
    // 'entregado' camino de 'pagado'.
    return { ...pedido, estado_anterior: estadoAnterior, mesaLiberada, cerradoPorPago };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Pedidos de una mesa — reemplaza el viejo historial por cliente.
 *
 * Trae los ítems con sus ingredientes porque con esto se pinta la cuenta de la
 * mesa, y dividirla por persona necesita saber qué pidió cada comensal. Son dos
 * consultas fijas (pedidos + detalles de todos ellos), no una por pedido.
 *
 * Solo los de la VISITA ACTUAL (mesas.sesion_iniciada_en, script 17). Lo usa el
 * comensal desde su sesión de QR: sin este filtro vería lo que pidió el grupo
 * anterior sentado en su mesa, con sus alias y sus platos, que no es asunto
 * suyo. Mismo criterio que obtener_cuenta_mesa y que el reparto de pagos.
 *
 * El `>=` incluye un pedido creado en el instante exacto de la apertura: si se
 * excluyera, el primer pedido de una mesa que se abre y pide de inmediato
 * quedaría fuera de su propia cuenta.
 *
 * COALESCE sobre la comparación resuelve el caso sin sesión: con
 * sesion_iniciada_en en NULL, `creado_en >= NULL` da NULL y se traduce a TRUE,
 * o sea entran todos los pedidos, como antes del script 17.
 */
async function listarPorMesa(idMesa) {
  const result = await pool.query(
    `SELECT * FROM pedidos WHERE id_mesa = $1
       AND COALESCE(
             creado_en >= (SELECT m.sesion_iniciada_en FROM mesas m WHERE m.id_mesa = $1),
             TRUE
           )
     ORDER BY creado_en DESC`,
    [idMesa]
  );
  return agruparDetalles(result.rows, await detallesDePedidos(result.rows.map((p) => p.id_pedido)));
}

/** Reparte una lista plana de detalles entre sus pedidos, sin consultas extra. */
function agruparDetalles(pedidos, detalles) {
  const porPedido = new Map(pedidos.map((p) => [p.id_pedido, []]));
  for (const detalle of detalles) porPedido.get(detalle.id_pedido)?.push(detalle);
  return pedidos.map((p) => ({ ...p, detalles: porPedido.get(p.id_pedido) || [] }));
}

module.exports = {
  ESTADOS_VALIDOS,
  ESTADOS_ACTIVOS,
  generarCodigoPedido,
  detallesDePedidos,
  agruparDetalles,
  crearConDetalles,
  listarActivos,
  obtenerConDetalles,
  actualizarEstado,
  listarPorMesa,
};
