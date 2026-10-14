// Doble de Redis. Las pruebas corren sin servidor Redis: este helper sustituye
// connectRedis del módulo src/config/redis por un cliente en memoria que
// registra cada operación, y permite simular un Redis caído o que falla en una
// operación concreta.
//
// También fija REDIS_URL, así las pruebas no dependen del .env de quien corra
// la suite (sin REDIS_URL el cache queda apagado a propósito).

const redis = require('../../src/config/redis');

const URL_FALSA = 'redis://redis-de-prueba:6379';

/** El error típico de un Redis que no está levantado. */
function errorRedisCaido() {
  return new Error('connect ECONNREFUSED 127.0.0.1:6379');
}

/**
 * @param {{caido?: boolean, falloEn?: string[], inicial?: Record<string,any>}} opciones
 *   caido: connectRedis rechaza, como si no hubiera servidor.
 *   falloEn: operaciones ('get' | 'setEx' | 'del') que lanzan aunque conecte.
 *   inicial: valores ya presentes en el cache (se guardan como JSON).
 */
function instalarFakeRedis(opciones = {}) {
  const connectOriginal = redis.connectRedis;
  const urlPrevia = process.env.REDIS_URL;
  process.env.REDIS_URL = URL_FALSA;

  const almacen = new Map();
  const operaciones = [];
  const falloEn = opciones.falloEn || [];

  for (const [clave, valor] of Object.entries(opciones.inicial || {})) {
    almacen.set(clave, { valor: JSON.stringify(valor), ttl: null });
  }

  const fallar = (op) => {
    if (falloEn.includes(op)) throw errorRedisCaido();
  };

  const cliente = {
    isOpen: true,
    async get(clave) {
      operaciones.push({ op: 'get', clave });
      fallar('get');
      const guardado = almacen.get(clave);
      return guardado ? guardado.valor : null;
    },
    async setEx(clave, ttlSegundos, valor) {
      operaciones.push({ op: 'setEx', clave, ttl: ttlSegundos });
      fallar('setEx');
      almacen.set(clave, { valor, ttl: ttlSegundos });
      return 'OK';
    },
    async del(clave) {
      operaciones.push({ op: 'del', clave });
      fallar('del');
      return almacen.delete(clave) ? 1 : 0;
    },
    // Hash (alias de comensal por mesa): el valor guardado es un objeto campo -> texto.
    async hSetNX(clave, campo, valor) {
      operaciones.push({ op: 'hSetNX', clave, campo });
      fallar('hSetNX');
      const guardado = almacen.get(clave) || { valor: '{}', ttl: null };
      const hash = JSON.parse(guardado.valor);
      if (Object.prototype.hasOwnProperty.call(hash, campo)) return false;
      hash[campo] = valor;
      almacen.set(clave, { ...guardado, valor: JSON.stringify(hash) });
      return true;
    },
    async expire(clave, ttlSegundos) {
      operaciones.push({ op: 'expire', clave, ttl: ttlSegundos });
      fallar('expire');
      const guardado = almacen.get(clave);
      if (!guardado) return false;
      almacen.set(clave, { ...guardado, ttl: ttlSegundos });
      return true;
    },
  };

  redis.connectRedis = async () => {
    if (opciones.caido) throw errorRedisCaido();
    return cliente;
  };

  return {
    operaciones,
    /** true si la clave está guardada en el cache simulado. */
    tiene(clave) {
      return almacen.has(clave);
    },
    /** Valor guardado, ya parseado. */
    valorDe(clave) {
      const guardado = almacen.get(clave);
      return guardado ? JSON.parse(guardado.valor) : null;
    },
    /** TTL en segundos con el que se guardó la clave. */
    ttlDe(clave) {
      const guardado = almacen.get(clave);
      return guardado ? guardado.ttl : null;
    },
    /** Todas las operaciones de ese tipo. */
    todas(op) {
      return operaciones.filter((o) => o.op === op);
    },
    restaurar() {
      redis.connectRedis = connectOriginal;
      if (urlPrevia === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = urlPrevia;
    },
  };
}

/** Un Redis caído: conectar falla siempre. */
function redisCaido() {
  return instalarFakeRedis({ caido: true });
}

module.exports = { instalarFakeRedis, redisCaido, URL_FALSA };
