/**
 * Lee las rutas REALES que registra backend/src/routes, recorriendo la pila de
 * capas de Express.
 *
 * Existe para que la matriz de roles no se quede atrás: si alguien añade una
 * ruta y no la declara en la tabla, `matriz-roles.test.js` falla. Una tabla
 * escrita a mano que nadie compara contra el código envejece en silencio, y una
 * ruta que nace sin guarda es exactamente lo que la matriz quiere evitar.
 *
 * Se apoya en detalles internos de Express 4 (`router.stack`, `layer.route`,
 * `layer.regexp`). Es deliberado: la alternativa era mantener la lista a mano,
 * que es justo el problema. El prefijo se recupera con operaciones de cadena y
 * no con otra expresión regular, para que se pueda leer.
 */

const router = require('../../src/routes');

// Cola que Express 4 añade a la expresión de un `router.use('/algo', …)`.
const COLA_USE = '\\/?(?=\\/|$)';
// Cola de un `router.get('/algo', …)` exacto.
const COLA_EXACTA = '\\/?$';

/**
 * Recupera el prefijo con el que está montado un sub-router a partir de su
 * expresión regular. Para `router.use('/auth', …)` Express guarda
 * `/^\/auth\/?(?=\/|$)/i`, de donde sale `/auth`.
 */
function prefijoDeCapa(regexp) {
  let fuente = regexp.source;
  if (fuente.startsWith('^')) fuente = fuente.slice(1);
  if (fuente.endsWith(COLA_USE)) fuente = fuente.slice(0, -COLA_USE.length);
  else if (fuente.endsWith(COLA_EXACTA)) fuente = fuente.slice(0, -COLA_EXACTA.length);
  return fuente.split('\\/').join('/');
}

/**
 * Todas las rutas montadas bajo /api, como `'GET /api/pedidos/:id'`.
 * Ordenadas y sin repetidos, para poder compararlas con una tabla.
 */
function rutasRegistradas() {
  const encontradas = new Set();

  const anotar = (metodos, ruta) => {
    for (const metodo of Object.keys(metodos)) {
      encontradas.add(`${metodo.toUpperCase()} ${ruta}`);
    }
  };

  for (const capa of router.stack) {
    if (capa.route) {
      anotar(capa.route.methods, `/api${capa.route.path}`);
      continue;
    }
    // Sub-router montado con router.use('/algo', …)
    if (capa.handle && Array.isArray(capa.handle.stack)) {
      const prefijo = prefijoDeCapa(capa.regexp);
      for (const subcapa of capa.handle.stack) {
        if (!subcapa.route) continue;
        const cola = subcapa.route.path === '/' ? '' : subcapa.route.path;
        anotar(subcapa.route.methods, `/api${prefijo}${cola}`);
      }
    }
  }

  return [...encontradas].sort();
}

module.exports = { rutasRegistradas, prefijoDeCapa };
