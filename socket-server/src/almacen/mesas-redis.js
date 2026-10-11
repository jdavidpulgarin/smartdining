const { PREFIJO } = require('./redis');

// La marca de "cuenta pedida" es de la sesión de mesa; si la mesa nunca se
// libera, que no quede para siempre.
const TTL_CUENTA_SEG = 24 * 60 * 60;

/**
 * Estado de sala por mesa en Redis (misma interfaz que crearEstadoMesasMemoria
 * en sala.js). Va en Redis y no en memoria del proceso para que el límite de
 * llamadas al mesero valga aunque haya varias instancias detrás de Nginx.
 */
function crearEstadoMesasRedis({ cliente }) {
  const llave = (idMesa, cosa) => `${PREFIJO}mesa:${idMesa}:${cosa}`;
  return {
    /** Marca sd:mesa:{ID}:cuenta = 1. */
    async marcarCuenta(idMesa) {
      await cliente.set(llave(idMesa, 'cuenta'), '1', { EX: TTL_CUENTA_SEG });
    },
    async cuentaSolicitada(idMesa) {
      return (await cliente.get(llave(idMesa, 'cuenta'))) === '1';
    },
    /** La sesión de mesa terminó: nada de su estado de sala pasa al grupo siguiente. */
    async limpiarMesa(idMesa) {
      await cliente.del([llave(idMesa, 'cuenta'), llave(idMesa, 'llamada')]);
    },
    /** true si la mesa puede llamar ahora (y deja la marca por `segundos`). */
    async reservarLlamada(idMesa, segundos) {
      return (await cliente.set(llave(idMesa, 'llamada'), '1', { NX: true, EX: segundos })) === 'OK';
    },
  };
}

module.exports = { crearEstadoMesasRedis, TTL_CUENTA_SEG };
