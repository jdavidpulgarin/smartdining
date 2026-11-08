/**
 * Crea un deduplicador en memoria con capacidad finita (buffer circular).
 *
 * @param {object} [opciones]
 * @param {number} [opciones.capacidad=200] - Cantidad máxima de IDs en memoria
 * @returns {{ visto: (eventId: string|null|undefined) => boolean }}
 */
export function crearDeduplicador({ capacidad = 200 } = {}) {
  const limite = Math.max(1, Number(capacidad) || 200);
  const conjunto = new Set();
  const orden = [];

  function visto(eventId) {
    if (!eventId) return false;
    const id = String(eventId);
    if (conjunto.has(id)) {
      return true;
    }

    if (orden.length >= limite) {
      const masViejo = orden.shift();
      conjunto.delete(masViejo);
    }

    orden.push(id);
    conjunto.add(id);
    return false;
  }

  return { visto };
}

export default crearDeduplicador;
