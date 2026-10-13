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

async function listarActivos() {
  const result = await pool.query(
    `SELECT * FROM pedidos WHERE estado IN ('recibido', 'en_preparacion') ORDER BY creado_en ASC`
  );
  return result.rows;
}

async function obtenerConDetalles(id) {
  const pedido = await pool.query('SELECT * FROM pedidos WHERE id_pedido = $1', [id]);
  if (pedido.rows.length === 0) return null;
  const detalles = await detallesDePedidos([pedido.rows[0].id_pedido]);
  return { ...pedido.rows[0], detalles };
}

// Estados en los que un pedido deja de ocupar la mesa.
const ESTADOS_CIERRE = ['pagado', 'cancelado'];

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

    // Si el pedido se cerró y la mesa no tiene otros pedidos abiertos, la mesa
    // se libera en esta misma transacción: el QR impreso deja de valer y las
    // sesiones de comensal de ese grupo caen.
    const pedido = result.rows[0];
    let mesaLiberada = false;
    if (ESTADOS_CIERRE.includes(estado)) {
      mesaLiberada = await mesasService.liberarSiNoQuedanPedidosAbiertos(client, pedido.id_mesa);
    }

    await client.query('COMMIT');
    // estado_anterior no es una columna de pedidos: se agrega al resultado
    // porque lo necesitan el payload de order:status y quien audite el cambio.
    return { ...pedido, estado_anterior: estadoAnterior, mesaLiberada };
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
  generarCodigoPedido,
  detallesDePedidos,
  agruparDetalles,
  crearConDetalles,
  listarActivos,
  obtenerConDetalles,
  actualizarEstado,
  listarPorMesa,
};
