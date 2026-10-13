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
            EXTRACT(EPOCH FROM (NOW() - p.creado_en)) / 60 AS minutos_transcurridos
     FROM pedidos p
     JOIN mesas m ON m.id_mesa = p.id_mesa
     WHERE p.estado = ANY($1::text[])
     ORDER BY p.creado_en ASC`,
    [ESTADOS_EN_EL_TABLERO]
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
 * Cambia el estado de una comanda. La validación de qué transiciones son
 * válidas desde el KDS (solo en_preparacion / listo) vive en el controller.
 */
async function cambiarEstado(pedidoId, estado, observaciones, idUsuario) {
  return pedidosService.actualizarEstado(pedidoId, estado, observaciones, idUsuario);
}

module.exports = { comandasActivas, cambiarEstado, ESTADOS_EN_EL_TABLERO };
