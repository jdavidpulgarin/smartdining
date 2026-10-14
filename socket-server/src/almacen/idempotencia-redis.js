const { PREFIJO } = require('./redis');

/**
 * Registro de eventos ya procesados en Redis: `sd:idem:{clave}` con EX.
 * La clave la arma quien llama e incluye el ámbito (rol, tipo de evento, mesa
 * o pedido), igual que con el registro en memoria.
 *
 * `reservar` es la operación que importa: SET NX es atómico en Redis, así que
 * si dos instancias (o dos reintentos simultáneos) procesan el mismo eventId,
 * solo una obtiene la reserva y la otra lo trata como duplicado.
 */
function crearRegistroIdempotenciaRedis({ cliente, ttlMs = 10 * 60 * 1000 }) {
  const ttlSeg = Math.max(1, Math.ceil(ttlMs / 1000));
  const llave = (clave) => `${PREFIJO}idem:${clave}`;
  return {
    async obtener(clave) {
      const v = await cliente.get(llave(clave));
      return v === null ? undefined : JSON.parse(v);
    },
    async guardar(clave, respuesta) {
      await cliente.set(llave(clave), JSON.stringify(respuesta), { EX: ttlSeg });
    },
    /** Quita una reserva: el evento se podrá procesar de nuevo (reintento tras un fallo). */
    async liberar(clave) {
      await cliente.del(llave(clave));
    },
    /** true si esta llamada reservó la clave; false si ya estaba (duplicado). */
    async reservar(clave, respuesta = true) {
      return (await cliente.set(llave(clave), JSON.stringify(respuesta), { EX: ttlSeg, NX: true })) === 'OK';
    },
  };
}

module.exports = { crearRegistroIdempotenciaRedis };
