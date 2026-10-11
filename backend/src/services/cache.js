const redis = require('../config/redis');

/**
 * Envoltura de Redis para cache de lectura. NINGUNA función de aquí lanza.
 *
 * Regla de diseño (igual que socket.notifier): el cache es un extra, no parte
 * del contrato. Si Redis está caído, lento o sin configurar, se registra y se
 * devuelve null / false, y el llamador sigue su camino leyendo de la base. Un
 * endpoint público nunca debe dar 500 por culpa del cache.
 *
 * Se accede a `redis.connectRedis` en cada llamada (no se desestructura) para
 * que las pruebas puedan sustituirlo por un doble.
 */

/** Cliente conectado, o null si Redis no está disponible. */
async function cliente() {
  if (!process.env.REDIS_URL) return null; // cache apagado: no es un error
  try {
    return await redis.connectRedis();
  } catch (err) {
    console.error('[cache] Redis no esta disponible:', err.message);
    return null;
  }
}

/**
 * Lee una clave y la parsea como JSON.
 * @returns {Promise<any|null>} null si no está, si Redis falla o si el valor
 *          guardado no es JSON válido (se trata como fallo de cache).
 */
async function leerJson(clave) {
  const conexion = await cliente();
  if (!conexion) return null;

  try {
    const crudo = await conexion.get(clave);
    if (!crudo) return null;
    return JSON.parse(crudo);
  } catch (err) {
    console.error(`[cache] no se pudo leer ${clave}:`, err.message);
    return null;
  }
}

/**
 * Guarda un valor como JSON con TTL en segundos.
 * @returns {Promise<boolean>} false si no se pudo guardar.
 */
async function guardarJson(clave, valor, ttlSegundos) {
  const conexion = await cliente();
  if (!conexion) return false;

  try {
    await conexion.setEx(clave, ttlSegundos, JSON.stringify(valor));
    return true;
  } catch (err) {
    console.error(`[cache] no se pudo guardar ${clave}:`, err.message);
    return false;
  }
}

/**
 * Borra una clave.
 * @returns {Promise<boolean>} false si no se pudo borrar (Redis caído). Es
 *          seguro: si el cache no está vivo, tampoco hay nada servido desde él.
 */
async function borrar(clave) {
  const conexion = await cliente();
  if (!conexion) return false;

  try {
    await conexion.del(clave);
    return true;
  } catch (err) {
    console.error(`[cache] no se pudo borrar ${clave}:`, err.message);
    return false;
  }
}

module.exports = { leerJson, guardarJson, borrar };
