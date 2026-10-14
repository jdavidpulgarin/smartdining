const pool = require('../config/db');
const pedidosService = require('./pedidos.service');

/**
 * Ítems de varias comandas con lo que el tablero necesita por ítem: plato,
 * categoría, tiempo estimado, quién lo pidió y sus ingredientes con porción.
 *
 * Los ingredientes van ordenados por pasos_constructor.orden para que la cocina
 * los lea en el orden en que se arma el plato. precio_aplicado no se incluye: a
 * la cocina no le sirve el precio, y así no se pasea por pantallas de más.
 */
const SQL_ITEMS_DE_COMANDAS = `
  SELECT dp.id_detalle, dp.id_pedido, dp.cantidad, dp.notas_especiales, dp.estado_item,
         dp.comensal, pl.nombre AS plato_nombre, pl.tiempo_preparacion_estimado,
         pl.personalizable, c.nombre AS categoria_nombre,
         COALESCE(json_agg(
           json_build_object(
             'id_ingrediente', i.id_ingrediente,
             'nombre', i.nombre,
             'porcion', di.porcion,
             'id_paso', pc.id_paso,
             'paso', pc.nombre
           ) ORDER BY pc.orden ASC, i.id_ingrediente ASC
         ) FILTER (WHERE di.id_ingrediente IS NOT NULL), '[]'::json) AS ingredientes
  FROM detalles_pedido dp
  JOIN platos pl ON pl.id_plato = dp.id_plato
  JOIN categorias c ON c.id_categoria = pl.id_categoria
  LEFT JOIN detalles_ingredientes di ON di.id_detalle = dp.id_detalle
  LEFT JOIN ingredientes i ON i.id_ingrediente = di.id_ingrediente
  LEFT JOIN pasos_constructor pc ON pc.id_paso = i.id_paso
  WHERE dp.id_pedido = ANY($1::int[])
  GROUP BY dp.id_detalle, pl.nombre, pl.tiempo_preparacion_estimado, pl.personalizable, c.nombre
  ORDER BY dp.id_detalle ASC`;

/**
 * Estados que siguen siendo asunto de la cocina y por tanto aparecen en el
 * tablero: las tres columnas del KDS.
 *
 * 'listo' se incluye aunque la cocina ya terminó: la comanda sigue en el pase
 * esperando que el mesero la recoja y la marque 'entregado'. Si no viniera en
 * esta consulta, la columna "Listas" se vaciaría en cada recarga del KDS y la
 * cocina perdería de vista lo que está esperando salir. Sale del tablero con
 * 'entregado', 'pagado' o 'cancelado'.
 */
const ESTADOS_EN_EL_TABLERO = ['recibido', 'en_preparacion', 'listo'];

/**
 * Cuánto tiempo sigue una comanda 'listo' en el tablero.
 *
 * Si el mesero nunca la marca 'entregado', se queda ahí para siempre y el pase
 * acaba lleno de comandas de días pasados que tapan las de hoy. Doce horas
 * cubren un turno completo con margen: lo que lleve más que eso no es una
 * comanda pendiente, es un pedido que nadie cerró.
 *
 * El recorte es SOLO para 'listo'. Un 'recibido' o 'en_preparacion' viejo
 * aparece igual, por antiguo que sea: eso sí es trabajo pendiente de cocina y
 * esconderlo sería peor (es el caso de ORD-001 del seed).
 */
const HORAS_VISIBLES_LISTO = 12;

/**
 * Devuelve las comandas del tablero (recibido, en_preparacion, listo) con sus
 * ítems ya enriquecidos con nombre del plato, categoría, quién pidió cada ítem
 * y sus ingredientes, más el número de mesa y los minutos transcurridos desde
 * que se creó el pedido — lo que el frontend-kds necesita para el tablero
 * Kanban y el semáforo de tiempos.
 *
 * Nombres de columnas según docs/modelo-er.md.
 */
async function comandasActivas() {
  const pedidosResult = await pool.query(
    `SELECT p.id_pedido, p.codigo_pedido, p.id_mesa, p.estado, p.notas_generales,
            p.creado_en, m.numero AS mesa_numero,
            EXTRACT(EPOCH FROM (NOW() - p.creado_en)) / 60 AS minutos_transcurridos,
            -- Cuándo pasó a 'listo': con esto el KDS cuenta el tiempo EN EL PASE
            -- y no el total desde que se pidió, que son dos cosas distintas.
            -- pedidos.actualizado_en no sirve: cambia con cualquier UPDATE.
            h.fecha_cambio AS listo_en
     FROM pedidos p
     JOIN mesas m ON m.id_mesa = p.id_mesa
     LEFT JOIN LATERAL (
       SELECT he.fecha_cambio
       FROM historial_estados he
       WHERE he.id_pedido = p.id_pedido AND he.estado_nuevo = 'listo'
       ORDER BY he.fecha_cambio DESC
       LIMIT 1
     ) h ON TRUE
     WHERE p.estado = ANY($1::text[])
       -- Las 'listo' solo mientras sigan siendo del turno; el resto sin límite.
       -- Si no hay fila de historial no se puede saber cuándo quedó lista, y
       -- esconderla por un dato que falta sería peor que mostrarla: se muestra.
       AND (
         p.estado <> 'listo'
         OR h.fecha_cambio IS NULL
         OR h.fecha_cambio > NOW() - ($2 || ' hours')::interval
       )
     ORDER BY p.creado_en ASC`,
    [ESTADOS_EN_EL_TABLERO, String(HORAS_VISIBLES_LISTO)]
  );

  const pedidos = pedidosResult.rows;
  if (pedidos.length === 0) return [];

  // Una sola consulta de ítems para TODAS las comandas (antes era una por
  // pedido: en hora pico el KDS refrescando cada pocos segundos multiplicaba
  // viajes a la base sin necesidad). Trae los ingredientes y su porción, que es
  // lo que la cocina tiene que leer para armar un plato personalizable.
  const detalles = await pool.query(SQL_ITEMS_DE_COMANDAS, [pedidos.map((p) => p.id_pedido)]);

  const porPedido = new Map(pedidos.map((p) => [p.id_pedido, []]));
  for (const item of detalles.rows) porPedido.get(item.id_pedido)?.push(item);

  return pedidos.map((pedido) => ({ ...pedido, items: porPedido.get(pedido.id_pedido) || [] }));
}

/**
 * Espacio de nombres de los advisory locks del KDS, para no chocar con otro
 * código que use locks con la misma clave numérica.
 */
const LOCK_KDS = 4209;

/**
 * Cambia el estado de una comanda desde el KDS.
 *
 * Qué transiciones puede pedir el KDS (solo en_preparacion / listo) lo decide el
 * controller, y si la transición es legal lo decide el trigger de la base. Lo
 * que se resuelve aquí es otra cosa: **no repetir trabajo**.
 *
 * Si la comanda YA está en el estado pedido no se toca nada. Dos toques
 * seguidos en la pantalla, o el reintento de una petición cuya respuesta se
 * perdió, dejarían si no dos filas en historial_estados y dos en kds_metricas
 * (el trigger de transiciones no se queja de pasar a 'listo' estando en
 * 'listo'), y las métricas de cocina quedarían infladas.
 *
 * SERIALIZACIÓN: la comprobación y el cambio ocurren bajo un advisory lock de
 * PostgreSQL por id_pedido. No se usa SELECT ... FOR UPDATE porque el UPDATE lo
 * hace pedidosService.actualizarEstado en su PROPIA transacción: mantener aquí
 * el lock de la fila la bloquearía a sí misma. El advisory lock sí cruza
 * transacciones y conexiones.
 *
 * ALCANCE REAL: serializa a quien tome el mismo lock, o sea las peticiones del
 * KDS entre sí (también entre instancias del backend, porque el lock es del
 * servidor de base de datos). Un PATCH /api/pedidos/:id/estado del panel de sala
 * no lo toma, así que esa carrera concreta sigue existiendo; cerrarla del todo
 * pide mover el guard dentro de la transacción de actualizarEstado, que es
 * compartida con los demás endpoints, o un UPDATE condicional en database/.
 *
 * @returns null si la comanda no existe · { ...pedido, sin_cambios: true } si ya
 *          estaba en ese estado · { ...pedido, sin_cambios: false } si cambió
 */
async function cambiarEstado(pedidoId, estado, observaciones, idUsuario) {
  const id = Number(pedidoId);
  // Un id que no es un entero positivo no puede existir: se contesta como
  // "no encontrada" en vez de dejar que la base falle con un error de sintaxis.
  if (!Number.isInteger(id) || id <= 0) return null;

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [LOCK_KDS, id]);

    const actual = await client.query('SELECT estado FROM pedidos WHERE id_pedido = $1', [id]);
    if (actual.rows.length === 0) return null;

    if (actual.rows[0].estado === estado) {
      // Ya está donde se pedía: se devuelve la comanda como está, sin UPDATE,
      // sin historial, sin métricas y sin aviso al socket (eso lo mira el
      // controller con sin_cambios).
      const pedido = await client.query('SELECT * FROM pedidos WHERE id_pedido = $1', [id]);
      const fila = pedido.rows[0] || { id_pedido: id, estado };
      return { ...fila, estado_anterior: estado, sin_cambios: true };
    }

    const pedido = await pedidosService.actualizarEstado(id, estado, observaciones, idUsuario);
    return pedido ? { ...pedido, sin_cambios: false } : null;
  } finally {
    // El unlock va en el finally y se traga su propio error: si falla, la
    // sesión se cierra al liberar el client y PostgreSQL suelta el lock igual.
    try {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_KDS, id]);
    } catch {
      // Nada que hacer: el lock muere con la conexión.
    }
    client.release();
  }
}

module.exports = {
  comandasActivas,
  cambiarEstado,
  ESTADOS_EN_EL_TABLERO,
  HORAS_VISIBLES_LISTO,
  LOCK_KDS,
};
