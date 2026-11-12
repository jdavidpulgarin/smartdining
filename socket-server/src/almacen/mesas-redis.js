const { PREFIJO } = require('./redis');

// La marca de "cuenta pedida" es de la sesión de mesa; si la mesa nunca se
// libera, que no quede para siempre.
const TTL_CUENTA_SEG = 24 * 60 * 60;

/**
 * Estado de sala por mesa en Redis (misma interfaz que crearEstadoMesasMemoria
 * en sala.js). Va en Redis y no en memoria del proceso para que el límite de
 * llamadas al mesero valga aunque haya varias instancias detrás de Nginx.
 *
 * Índice sd:mesas:con-estado (hash id_mesa -> ms en que vence): las mesas con
 * pagos o sin celular anotados en esta sesión. Sirve para mandar la presencia
 * de TODAS al panel que se conecta (EVENTS.md §5.2), incluida una mesa sin
 * ningún socket. Cada mesa vence a las 24 h de su última anotación, como
 * pagaron y sin_celular, y la llave entera también: si una mesa nunca se
 * libera, no queda basura.
 */
function crearEstadoMesasRedis({ cliente, ahora = Date.now }) {
  const llave = (idMesa, cosa) => `${PREFIJO}mesa:${idMesa}:${cosa}`;
  const INDICE = `${PREFIJO}mesas:con-estado`;
  async function anotarEnIndice(idMesa) {
    await cliente.hSet(INDICE, String(idMesa), String(ahora() + TTL_CUENTA_SEG * 1000));
    await cliente.expire(INDICE, TTL_CUENTA_SEG);
  }
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
      await cliente.hDel(INDICE, String(idMesa));
    },
    /** Anota que `alias` pagó en esta sesión (hash sd:mesa:{ID}:pagaron, idempotente). */
    async marcarPago(idMesa, alias) {
      const k = llave(idMesa, 'pagaron');
      await cliente.hSet(k, alias, alias);
      await cliente.expire(k, TTL_CUENTA_SEG);
      await anotarEnIndice(idMesa);
    },
    /** Deshace un marcarPago que llegó tarde a una mesa ya liberada (ver anotarPagoEnSesion en pagos.js). */
    async desmarcarPago(idMesa, alias) {
      await cliente.hDel(llave(idMesa, 'pagaron'), alias);
      // Sin nada anotado, la mesa sale del índice (como al liberarla).
      const quedan = (await cliente.hLen(llave(idMesa, 'pagaron'))) + (await cliente.hLen(llave(idMesa, 'sin_celular')));
      if (quedan === 0) await cliente.hDel(INDICE, String(idMesa));
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
      // node-redis arma la respuesta de HGETALL con Object.create(null): se
      // copia a un objeto normal para devolver lo mismo que el almacén en memoria.
      return { ...(await cliente.hGetAll(llave(idMesa, 'sin_celular'))) };
    },
    /** HSETNX: false si esa clave ya estaba (otro alias con la misma clave). */
    async agregarSinCelular(idMesa, clave, alias) {
      const k = llave(idMesa, 'sin_celular');
      const nuevo = await cliente.hSetNX(k, clave, alias);
      if (nuevo) {
        await cliente.expire(k, TTL_CUENTA_SEG);
        await anotarEnIndice(idMesa);
      }
      return Boolean(nuevo);
    },
    /** true si había un alias con esa clave y se quitó. */
    async quitarSinCelular(idMesa, clave) {
      return (await cliente.hDel(llave(idMesa, 'sin_celular'), clave)) > 0;
    },
    /** Mesas del índice que no han vencido, en orden; borra las vencidas. */
    async mesasConEstado() {
      const todas = await cliente.hGetAll(INDICE);
      const vigentes = [];
      for (const [id, vence] of Object.entries(todas)) {
        if (Number(vence) > ahora()) vigentes.push(Number(id));
        else await cliente.hDel(INDICE, id);
      }
      return vigentes.filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
    },
    /** true si la mesa puede llamar ahora (y deja la marca por `segundos`). */
    async reservarLlamada(idMesa, segundos) {
      return (await cliente.set(llave(idMesa, 'llamada'), '1', { NX: true, EX: segundos })) === 'OK';
    },
  };
}

module.exports = { crearEstadoMesasRedis, TTL_CUENTA_SEG };
