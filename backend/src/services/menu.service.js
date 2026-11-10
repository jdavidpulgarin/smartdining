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

/**
 * Versión del menú, para la carrera entre una lectura y una invalidación.
 *
 * El problema: una petición empieza a leer la base, mientras tanto el stock
 * cambia y se invalida la caché, y la lectura —que ya traía el menú VIEJO—
 * termina después y lo guarda. La caché queda con datos anteriores al cambio y
 * el TTL de 60 s los mantiene ahí: es exactamente el fallo que se viene a
 * arreglar, pero por la ventana contraria.
 *
 * La solución es la mínima que sirve: un contador que `invalidarMenu`
 * incrementa, y `obtenerMenu` guarda SOLO si no cambió mientras leía. Si cambió,
 * la respuesta sale igual (es la que acaba de leer, y como mucho está un instante
 * desfasada) pero no se guarda, y la siguiente petición lee de nuevo.
 *
 * Un contador en memoria basta porque el backend corre en UN proceso; nada de
 * esto necesita Redis. Si algún día hay varias instancias, la invalidación ya
 * borra la clave compartida y lo único que se perdería es esta guarda, que
 * volvería a dejar la ventana de la carrera.
 */
let version = 0;

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

  // La versión se anota ANTES de leer: si alguien invalida mientras la base
  // responde, este menú ya es viejo y no se guarda.
  const versionAlLeer = version;
  const menu = await consultarBase();

  if (version === versionAlLeer) {
    await cache.guardarJson(CLAVE_CACHE, menu, TTL_SEGUNDOS);
  } else {
    console.error('[menu] el menu cambio mientras se leia: no se cachea esta lectura');
  }

  return { menu, desdeCache: false };
}

/**
 * Borra el menú cacheado y sube la versión.
 *
 * Quién la llama:
 *   - las rutas REST que editan la carta (platos, categorías, constructor);
 *   - el oyente del canal `inventario` ante un aviso de **disponibilidad**, que
 *     es cómo se enteran los cambios por STOCK: un pedido que consume, un
 *     movimiento, una receta nueva o un insumo desactivado cambian la
 *     disponibilidad DENTRO de la base y no pasan por ninguna ruta;
 *   - las rutas de inventario que escriben, después del COMMIT, para no
 *     depender del orden de llegada del NOTIFY.
 *
 * La versión se incrementa SIEMPRE, incluso si el borrado falla: lo que
 * protege es la lectura en vuelo, y eso no depende de Redis.
 *
 * Nunca lanza: con Redis caído no hay caché que invalidar y `cache.borrar`
 * devuelve false, así que la operación que la llamó no debe fallar por eso.
 */
async function invalidarMenu() {
  version += 1;
  return cache.borrar(CLAVE_CACHE);
}

/** La versión actual. Es para las pruebas: en producción nadie la mira. */
function versionActual() {
  return version;
}

module.exports = { obtenerMenu, invalidarMenu, versionActual, CLAVE_CACHE, TTL_SEGUNDOS };
