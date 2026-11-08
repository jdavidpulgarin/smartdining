const { createClient } = require('redis');
require('dotenv').config();

/**
 * Cliente Redis para caché de sesiones activas y del menú.
 *
 * OJO: coordinar con Roberto el prefijo de llaves (ej. "session:") para no
 * chocar con el TTL de tokens QR que maneja su socket-server.
 *
 * REDIS NUNCA DEBE COLGAR UNA PETICIÓN. Con la estrategia de reconexión por
 * omisión de node-redis, `connect()` reintenta para siempre y **no rechaza
 * nunca**: con Redis apagado, `await connectRedis()` no volvía, así que los
 * try/catch de usuario-activo.js, cache.js y alias-comensal.js jamás llegaban a
 * ejecutarse y la petición se quedaba colgada. Aquí se arregla con tres piezas:
 *
 * 1. `connectTimeout` corto, para que un Redis que no contesta (en vez de
 *    rechazar la conexión) no retenga la petición más de ~1,5 s.
 * 2. Una `reconnectStrategy` que SE RINDE: devuelve un Error, y entonces
 *    `connect()` rechaza en vez de reintentar en segundo plano. Quien llama
 *    recibe el fallo y decide, que es justo lo que esperan los tres llamadores.
 * 3. Un ENFRIAMIENTO: tras un fallo, durante unos segundos `connectRedis()`
 *    rechaza al instante sin tocar la red. Sin esto, con Redis apagado cada
 *    petición pagaría el intento de conexión otra vez.
 *
 * RECUPERACIÓN SOLA: pasado el enfriamiento, la siguiente petición vuelve a
 * intentarlo, y la misma instancia de cliente se puede reconectar (comprobado
 * con node-redis 4.7), así que cuando Redis vuelve la caché se reactiva sin
 * reiniciar el backend y sin recrear el cliente que exporta este módulo.
 *
 * Con Redis sano no cambia nada: ni llaves, ni TTLs, ni el camino feliz.
 */

/** Espera máxima por la conexión. Configurable con REDIS_CONNECT_TIMEOUT_MS. */
const TIMEOUT_POR_DEFECTO_MS = 1500;

/** Cuánto se deja de intentar tras un fallo. Configurable con REDIS_ENFRIAMIENTO_MS. */
const ENFRIAMIENTO_POR_DEFECTO_MS = 15000;

/** Un aviso por minuto como máximo: con Redis apagado el log se inundaba. */
const SILENCIO_ENTRE_AVISOS_MS = 60000;

/** Entero positivo de una variable de entorno, o el valor por defecto. */
function enteroDe(valor, porDefecto) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const timeoutMs = (env = process.env) =>
  enteroDe(env.REDIS_CONNECT_TIMEOUT_MS, TIMEOUT_POR_DEFECTO_MS);

const enfriamientoMs = (env = process.env) =>
  enteroDe(env.REDIS_ENFRIAMIENTO_MS, ENFRIAMIENTO_POR_DEFECTO_MS);

/**
 * El fallo que ve quien llama. Tiene nombre propio para que un catch pueda
 * distinguir "no hay caché" de un error de programación, y para que el mensaje
 * del log se lea sin stack.
 */
class RedisNoDisponible extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'RedisNoDisponible';
  }
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: timeoutMs(),
    // Se rinde en el primer fallo a propósito: ver el punto 2 de arriba. El
    // reintento lo hace la siguiente petición, pasado el enfriamiento.
    reconnectStrategy: () => new RedisNoDisponible('Redis no responde'),
  },
});

/** Estado del enfriamiento y del log. Reiniciable desde las pruebas. */
const estado = { enfriadoHasta: 0, enVuelo: null, ultimoAviso: 0, caido: false };

/**
 * Deja constancia sin inundar el log.
 *
 * `redisClient.on('error')` se dispara en cada intento: con Redis apagado eso
 * eran decenas de líneas por minuto (35 en 15 s, medido), cada una con su
 * stack, que tapaban cualquier otro error del servidor. Ahora se avisa del
 * primer fallo y luego como mucho uno por minuto, con una línea corta; y se
 * avisa también de la recuperación, que es lo que de verdad interesa ver.
 */
function avisar(mensaje, { siempre = false } = {}) {
  const ahora = Date.now();
  if (!siempre && ahora - estado.ultimoAviso < SILENCIO_ENTRE_AVISOS_MS) return;
  estado.ultimoAviso = ahora;
  console.error(mensaje);
}

redisClient.on('error', (err) => {
  // Solo el mensaje: el stack de un ECONNREFUSED no aporta nada y es ruido.
  avisar(`[redis] no disponible (${err && err.message}); se sigue sin cache`);
});

/**
 * Cliente conectado, o rechaza rápido si Redis no está disponible.
 *
 * Nunca se queda colgado: o conecta, o rechaza dentro del timeout, o rechaza al
 * instante si está en enfriamiento. Las llamadas concurrentes comparten el
 * mismo intento, para no abrir una conexión por petición.
 *
 * El cliente entra por parámetro para poder probar el enfriamiento y la
 * recuperación sin un Redis de verdad; los llamadores no pasan nada.
 *
 * @param {{cliente?: typeof redisClient}} opciones
 * @returns {Promise<typeof redisClient>}
 * @throws {RedisNoDisponible}
 */
async function connectRedis({ cliente = redisClient } = {}) {
  if (cliente.isOpen && cliente.isReady) {
    if (estado.caido) {
      estado.caido = false;
      avisar('[redis] disponible de nuevo: la cache vuelve a usarse', { siempre: true });
    }
    return cliente;
  }

  const ahora = Date.now();
  if (ahora < estado.enfriadoHasta) {
    // Sin tocar la red: es lo que evita que cada petición pague el timeout.
    throw new RedisNoDisponible('Redis no disponible (en enfriamiento)');
  }

  // Varias peticiones a la vez comparten el intento en vuelo.
  if (estado.enVuelo) return estado.enVuelo;

  estado.enVuelo = (async () => {
    try {
      await cliente.connect();
      estado.enfriadoHasta = 0;
      if (estado.caido) {
        estado.caido = false;
        avisar('[redis] disponible de nuevo: la cache vuelve a usarse', { siempre: true });
      }
      return cliente;
    } catch (err) {
      estado.enfriadoHasta = Date.now() + enfriamientoMs();
      const primeraVez = !estado.caido;
      estado.caido = true;
      avisar(
        `[redis] no se pudo conectar (${err && err.message}); se sigue sin cache `
          + `y no se reintenta por ${Math.round(enfriamientoMs() / 1000)} s`,
        { siempre: primeraVez }
      );
      throw err instanceof RedisNoDisponible
        ? err
        : new RedisNoDisponible(`Redis no disponible: ${err && err.message}`);
    } finally {
      estado.enVuelo = null;
    }
  })();

  return estado.enVuelo;
}

/** Borra el enfriamiento y el estado del log. Para las pruebas. */
function reiniciarEstado() {
  estado.enfriadoHasta = 0;
  estado.enVuelo = null;
  estado.ultimoAviso = 0;
  estado.caido = false;
}

module.exports = {
  redisClient,
  connectRedis,
  RedisNoDisponible,
  reiniciarEstado,
  estado,
  timeoutMs,
  enfriamientoMs,
  TIMEOUT_POR_DEFECTO_MS,
  ENFRIAMIENTO_POR_DEFECTO_MS,
  SILENCIO_ENTRE_AVISOS_MS,
};
