const { PREFIJO } = require('./redis');

// Un pedido pasa de recibido a listo en minutos; 24 h cubre cualquier demora
// sin dejar datos para siempre.
const TTL_DUENOS_SEG = 24 * 60 * 60;
const MAX_PEDIDOS_MEMORIA = 5000;

/**
 * Quiénes pidieron cada pedido (alias de comensal), para que el push de
 * "¡Tu plato está listo!" le llegue solo a ellos.
 *   Redis: sd:pedido:{id}:duenos → JSON ["Ana", "Beto"]
 */
function crearDuenosMemoria({ ahora = Date.now } = {}) {
  const pedidos = new Map(); // id -> { duenos, expira }
  return {
    guardar(idPedido, duenos) {
      pedidos.set(idPedido, { duenos: [...duenos], expira: ahora() + TTL_DUENOS_SEG * 1000 });
      // Tope de memoria: se descartan los más viejos (Map conserva el orden).
      while (pedidos.size > MAX_PEDIDOS_MEMORIA) pedidos.delete(pedidos.keys().next().value);
    },
    obtener(idPedido) {
      const p = pedidos.get(idPedido);
      if (!p || p.expira <= ahora()) return [];
      return [...p.duenos];
    },
  };
}

function crearDuenosRedis({ cliente }) {
  const llave = (id) => `${PREFIJO}pedido:${id}:duenos`;
  return {
    async guardar(idPedido, duenos) {
      await cliente.set(llave(idPedido), JSON.stringify([...duenos]), { EX: TTL_DUENOS_SEG });
    },
    async obtener(idPedido) {
      const v = await cliente.get(llave(idPedido));
      return v ? JSON.parse(v) : [];
    },
  };
}

module.exports = { crearDuenosMemoria, crearDuenosRedis, TTL_DUENOS_SEG };
