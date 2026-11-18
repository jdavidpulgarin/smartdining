/**
 * Qué rutas responden SIEMPRE `{ error, motivo }` y no dejan datos personales
 * en el log del manejador global de errores.
 *
 *   - D-19 parte B: las de los clientes de la app (solo en /api/v1).
 *   - D-20a: despacho de domicilios, zonas del admin y la lista de
 *     repartidores (en /api y en /api/v1). Manejan nombres y teléfonos de
 *     clientes y direcciones de entrega.
 *
 * En ellas TODO error lleva `motivo` (también los genéricos) y el log solo
 * lleva el código, el método y el camino (docs/api-spec.md, "Errores de las
 * rutas de clientes", "Datos personales" y "D-20a · Despacho y repartidor").
 */

const PREFIJOS_CLIENTES = Object.freeze(['/api/v1/auth/clientes', '/api/v1/clientes', '/api/v1/zonas']);

/** D-20a. Cada uno en los dos prefijos de la API. */
const PREFIJOS_DESPACHO = Object.freeze(
  ['/domicilios', '/zonas-envio', '/usuarios/repartidores'].flatMap((r) => [`/api${r}`, `/api/v1${r}`])
);

/** El camino sin la query, en minúsculas (Express no distingue mayúsculas al enrutar). */
const caminoDe = (url) => String(url || '').split('?')[0].toLowerCase();

const bajo = (prefijos, url) => {
  const camino = caminoDe(url);
  return prefijos.some((p) => camino === p || camino.startsWith(`${p}/`));
};

/** ¿Es una ruta de clientes? `/api/v1/zonasX` no lo es; `/api/v1/zonas/cotizar` sí. */
function esRutaDeClientes(url) {
  return bajo(PREFIJOS_CLIENTES, url);
}

/** ¿Es una ruta de despacho, zonas del admin o repartidores (D-20a)? */
function esRutaDeDespacho(url) {
  return bajo(PREFIJOS_DESPACHO, url);
}

/** ¿Responde siempre con motivo y sin datos en el log? */
function esRutaConMotivo(url) {
  return esRutaDeClientes(url) || esRutaDeDespacho(url);
}

module.exports = {
  PREFIJOS_CLIENTES,
  PREFIJOS_DESPACHO,
  esRutaDeClientes,
  esRutaDeDespacho,
  esRutaConMotivo,
  caminoDe,
};
