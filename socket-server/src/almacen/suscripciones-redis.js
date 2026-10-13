const { PREFIJO } = require('./redis');

// Las suscripciones son de la sesión de mesa: si la mesa nunca se libera,
// que no queden para siempre. Se renueva en cada alta.
const TTL_SUSCRIPCIONES_SEG = 24 * 60 * 60;
const MAX_REINTENTOS = 10;

/**
 * Suscripciones Web Push por mesa en un hash `sd:push:{mesa}`:
 * campo = endpoint (dar de alta dos veces el mismo navegador reemplaza, no
 * duplica), valor = suscripción en JSON. Misma interfaz que la de memoria.
 */
function crearAlmacenSuscripcionesRedis({ cliente, maxPorMesa }) {
  const llave = (idMesa) => `${PREFIJO}push:${idMesa}`;

  return {
    /** false si la mesa llegó al máximo (y el endpoint es nuevo). */
    async agregar(idMesa, suscripcion) {
      const k = llave(idMesa);
      // El tope se comprueba y se escribe en una transacción vigilada: sin
      // WATCH, dos altas simultáneas podrían pasar ambas el chequeo de tamaño.
      for (let i = 0; i < MAX_REINTENTOS; i += 1) {
        try {
          return await cliente.executeIsolated(async (iso) => {
            await iso.watch(k);
            const existe = await iso.hExists(k, suscripcion.endpoint);
            if (!existe && (await iso.hLen(k)) >= maxPorMesa) {
              await iso.unwatch();
              return false;
            }
            await iso.multi()
              .hSet(k, suscripcion.endpoint, JSON.stringify(suscripcion))
              .expire(k, TTL_SUSCRIPCIONES_SEG)
              .exec();
            return true;
          });
        } catch (err) {
          if (!err || err.name !== 'WatchError') throw err;
        }
      }
      throw new Error(`Conflicto persistente al suscribir en la mesa ${idMesa}`);
    },
    async quitar(idMesa, endpoint) {
      return (await cliente.hDel(llave(idMesa), endpoint)) > 0;
    },
    async listar(idMesa) {
      return (await cliente.hVals(llave(idMesa))).map((v) => JSON.parse(v));
    },
    async limpiarMesa(idMesa) {
      await cliente.del(llave(idMesa));
    },
  };
}

module.exports = { crearAlmacenSuscripcionesRedis, TTL_SUSCRIPCIONES_SEG };
