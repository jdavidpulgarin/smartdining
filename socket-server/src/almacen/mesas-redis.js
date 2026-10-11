const { PREFIJO } = require('./redis');

/**
 * Estado de sala por mesa en Redis (misma interfaz que crearEstadoMesasMemoria
 * en sala.js). Va en Redis y no en memoria del proceso para que el límite de
 * llamadas al mesero valga aunque haya varias instancias detrás de Nginx.
 */
function crearEstadoMesasRedis({ cliente }) {
  const llave = (idMesa, cosa) => `${PREFIJO}mesa:${idMesa}:${cosa}`;
  return {
    /** true si la mesa puede llamar ahora (y deja la marca por `segundos`). */
    async reservarLlamada(idMesa, segundos) {
      return (await cliente.set(llave(idMesa, 'llamada'), '1', { NX: true, EX: segundos })) === 'OK';
    },
  };
}

module.exports = { crearEstadoMesasRedis };
