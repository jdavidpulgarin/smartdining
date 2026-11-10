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
      await cliente.del([llave(idMesa, 'cuenta'), llave(idMesa, 'llamada'), llave(idMesa, 'pagaron'), llave(idMesa, 'sin_celular')]);
    },
    /** Anota que `alias` pagó en esta sesión (hash sd:mesa:{ID}:pagaron, idempotente). */
    async marcarPago(idMesa, alias) {
      const k = llave(idMesa, 'pagaron');
      await cliente.hSet(k, alias, alias);
      await cliente.expire(k, TTL_CUENTA_SEG);
    },
    /** Alias que ya pagaron en esta sesión, ordenados. */
    async pagaron(idMesa) {
      return (await cliente.hVals(llave(idMesa, 'pagaron'))).sort((a, b) => a.localeCompare(b));
    },
    /**
     * Comensales sin celular (EVENTS.md §6.4): hash sd:mesa:{ID}:sin_celular,
     * clave del alias -> alias guardado, TTL de 24 h como pagaron.
     */
    async sinCelular(idMesa) {
      return cliente.hGetAll(llave(idMesa, 'sin_celular'));
    },
    /** HSETNX: false si esa clave ya estaba (otro alias con la misma clave). */
    async agregarSinCelular(idMesa, clave, alias) {
      const k = llave(idMesa, 'sin_celular');
      const nuevo = await cliente.hSetNX(k, clave, alias);
      if (nuevo) await cliente.expire(k, TTL_CUENTA_SEG);
      return Boolean(nuevo);
    },
    /** true si había un alias con esa clave y se quitó. */
    async quitarSinCelular(idMesa, clave) {
      return (await cliente.hDel(llave(idMesa, 'sin_celular'), clave)) > 0;
    },
    /** true si la mesa puede llamar ahora (y deja la marca por `segundos`). */
    async reservarLlamada(idMesa, segundos) {
      return (await cliente.set(llave(idMesa, 'llamada'), '1', { NX: true, EX: segundos })) === 'OK';
    },
  };
}

module.exports = { crearEstadoMesasRedis, TTL_CUENTA_SEG };
