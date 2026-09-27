const pool = require('../config/db');
const pedidosService = require('./pedidos.service');

/**
 * Devuelve las comandas activas (recibido, en_preparacion) con sus ítems ya
 * enriquecidos con nombre del plato y categoría, más el número de mesa y los
 * minutos transcurridos desde que se creó el pedido — lo que el frontend-kds
 * necesita para el tablero Kanban y el semáforo de tiempos (>15 min = rojo).
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
     WHERE p.estado IN ('recibido', 'en_preparacion')
     ORDER BY p.creado_en ASC`
  );

  const comandas = [];
  for (const pedido of pedidosResult.rows) {
    const itemsResult = await pool.query(
      `SELECT dp.id_detalle, dp.cantidad, dp.notas_especiales, dp.estado_item,
              pl.nombre AS plato_nombre, pl.tiempo_preparacion_estimado,
              c.nombre AS categoria_nombre
       FROM detalles_pedido dp
       JOIN platos pl ON pl.id_plato = dp.id_plato
       JOIN categorias c ON c.id_categoria = pl.id_categoria
       WHERE dp.id_pedido = $1
       ORDER BY dp.id_detalle ASC`,
      [pedido.id_pedido]
    );
    comandas.push({ ...pedido, items: itemsResult.rows });
  }
  return comandas;
}

/**
 * Cambia el estado de una comanda. La validación de qué transiciones son
 * válidas desde el KDS (solo en_preparacion / listo) vive en el controller.
 */
async function cambiarEstado(pedidoId, estado, observaciones, idUsuario) {
  return pedidosService.actualizarEstado(pedidoId, estado, observaciones, idUsuario);
}

module.exports = { comandasActivas, cambiarEstado };
