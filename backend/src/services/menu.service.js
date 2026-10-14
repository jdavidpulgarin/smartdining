const pool = require('../config/db');
const cache = require('./cache');

/**
 * Menú digital completo. La forma del JSON la define la base
 * (database/scripts/13_constructor.sql, función obtener_menu_completo): sale
 * categorías activas -> platos disponibles (con personalizable, calorias) ->
 * pasos -> ingredientes. El backend NO rearma ni filtra nada: la base es la
 * fuente de verdad, incluidos los ingredientes agotados, que vienen con
 * disponible = false para que el constructor los muestre deshabilitados.
 */

const CLAVE_CACHE = 'cache:menu';
const TTL_SEGUNDOS = 60;

/** SELECT a la función del constructor. Devuelve el arreglo de categorías. */
async function consultarBase() {
  const result = await pool.query('SELECT obtener_menu_completo() AS menu');
  return result.rows[0] ? result.rows[0].menu : [];
}

/**
 * Menú con cache-aside: se intenta Redis, y si no hay nada se lee de la base y
 * se guarda con TTL de 60 s. Si Redis no responde, el cache se salta en
 * silencio (ver services/cache.js) y la respuesta sale igual desde la base.
 *
 * @returns {Promise<{menu: any[], desdeCache: boolean}>}
 */
async function obtenerMenu() {
  const enCache = await cache.leerJson(CLAVE_CACHE);
  if (enCache) return { menu: enCache, desdeCache: true };

  const menu = await consultarBase();
  await cache.guardarJson(CLAVE_CACHE, menu, TTL_SEGUNDOS);
  return { menu, desdeCache: false };
}

/**
 * Borra el menú cacheado. La llaman las rutas que modifican platos o
 * categorías, para que un cambio de la carta se vea sin esperar el TTL.
 *
 * Nunca lanza: con Redis caído no hay cache que invalidar, así que el POST/PUT
 * /DELETE que la llamó no debe fallar por eso.
 */
async function invalidarMenu() {
  return cache.borrar(CLAVE_CACHE);
}

module.exports = { obtenerMenu, invalidarMenu, CLAVE_CACHE, TTL_SEGUNDOS };
