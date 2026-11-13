/**
 * D-19 parte B: qué rutas son "de clientes" (las de la app, solo en /api/v1).
 *
 * En ellas TODO error responde `{ error, motivo }`, también los genéricos, y
 * el log no lleva datos del cliente (docs/api-spec.md, "Errores de las rutas de
 * clientes" y "Datos personales"). Lo usa el manejador global de errores.
 */

const PREFIJOS_CLIENTES = Object.freeze(['/api/v1/auth/clientes', '/api/v1/clientes', '/api/v1/zonas']);

/** El camino sin la query, en minúsculas (Express no distingue mayúsculas al enrutar). */
const caminoDe = (url) => String(url || '').split('?')[0].toLowerCase();

/** ¿Es una ruta de clientes? `/api/v1/zonasX` no lo es; `/api/v1/zonas/cotizar` sí. */
function esRutaDeClientes(url) {
  const camino = caminoDe(url);
  return PREFIJOS_CLIENTES.some((p) => camino === p || camino.startsWith(`${p}/`));
}

module.exports = { PREFIJOS_CLIENTES, esRutaDeClientes, caminoDe };
