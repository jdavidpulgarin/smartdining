const express = require('express');
const routes = require('./index');
const rutasSoloV1 = require('./solo-v1');

/**
 * D-19 parte A: la API se monta en DOS prefijos, `/api/v1` y `/api`, con el
 * MISMO router agregador (src/routes/index.js). No hay rutas duplicadas: v1 es
 * una segunda puerta al mismo código.
 *
 * `/api` sigue igual y es compatible hacia atrás: la PWA, el panel y el KDS no
 * cambian. `/api/v1` es la base de los clientes nuevos (la app móvil, D-19).
 *
 * Lo que aplica igual en los dos, porque está antes o dentro del router:
 * helmet, CORS, el límite global, express.json(), la autenticación y los roles
 * de cada ruta, el 404 y el manejador de errores (todos en server.js o en las
 * propias rutas).
 *
 * LÍMITES DE PETICIONES COMPARTIDOS. No se pueden duplicar usando los dos
 * prefijos:
 *   - el GLOBAL va a nivel de app (server.js) y su clave es solo la IP: la ruta
 *     no entra en la clave, así que /api/x y /api/v1/x gastan el mismo cupo;
 *   - los de LOGIN y QR se crean UNA vez, al cargar auth.routes.js y
 *     mesas.routes.js, y su clave es "IP:email" o la IP, sin la ruta. Como v1
 *     monta la MISMA instancia del router (no una copia), es la misma instancia
 *     del limitador, con el mismo contador. Por eso aquí se reutiliza `routes`
 *     en vez de volver a requerir o construir los routers.
 *
 * FUERA DE v1: el canal interno servidor-a-servidor (las rutas con un segmento
 * `internal` o `interno`: POST /transacciones/internal, GET
 * /mesas/:id/cuenta/interno, POST /mesas/:id/token-qr/interno y POST
 * /pagos/intentos-fallidos/interno). Las llama el socket-server con una URL
 * FIJA configurada en su lado y la clave x-internal-key; no son API de clientes
 * y no tienen versión. Publicarlas también en v1 solo duplicaría la superficie
 * que hay que vigilar y daría dos URLs para el mismo canal. En v1 responden el
 * 404 de siempre. (Webhooks de pasarela no hay en el backend: el de Wompi lo
 * recibe el socket-server, que después llama a /api/transacciones/internal.)
 */

/** Segmentos de ruta del canal interno, en las dos grafías que existen. */
const SEGMENTOS_SOLO_API = new Set(['internal', 'interno']);

/** ¿Esta ruta es del canal interno (y por tanto no va en v1)? */
function esCanalInterno(ruta) {
  return String(ruta || '')
    .toLowerCase()
    .split('/')
    .some((segmento) => SEGMENTOS_SOLO_API.has(segmento));
}

/**
 * El router de `/api/v1`: el agregador compartido, sin el canal interno, MÁS
 * las rutas que solo existen en v1 (D-19 parte B: las de los clientes de la
 * app, src/routes/solo-v1.js). Una ruta interna sale del router con
 * next('router') y termina en el 404 global de server.js, con el mismo cuerpo
 * que cualquier ruta que no existe.
 *
 * Las de solo v1 van ANTES del agregador compartido: sus prefijos
 * (/auth/clientes, /clientes, /zonas) no chocan con ninguna ruta compartida,
 * y así una petición de cliente no recorre la API entera antes de llegar.
 */
function crearRouterV1(rutas = routes, soloV1 = rutasSoloV1) {
  const v1 = express.Router();
  v1.use((req, res, next) => (esCanalInterno(req.path) ? next('router') : next()));
  v1.use(soloV1);
  v1.use(rutas);
  return v1;
}

/**
 * Monta la API en la app. `/api/v1` va ANTES que `/api`: si fuera después, una
 * petición a /api/v1/x entraría primero al router de /api como "/v1/x", lo
 * recorrería sin coincidir y solo entonces llegaría a v1. Así cada prefijo va
 * directo a su router.
 *
 * `/api` monta SOLO el agregador compartido: las rutas de clientes no existen
 * ahí (404).
 */
function montarApi(app, rutas = routes, soloV1 = rutasSoloV1) {
  app.use('/api/v1', crearRouterV1(rutas, soloV1));
  app.use('/api', rutas);
}

module.exports = { montarApi, crearRouterV1, esCanalInterno, SEGMENTOS_SOLO_API };
