const express = require('express');
const { directorioImagenes, enProduccion } = require('../config/imagenes');
const { PATRON_RUTA_IMAGEN } = require('../utils/url-imagen');

/**
 * D-23: GET /imagenes/<uuid>.webp en DESARROLLO.
 *
 * En PRODUCCIÓN esta ruta NO se monta: las imágenes las sirve nginx directo
 * desde el volumen (PR de Roberto: volumen, nginx, CSP y respaldos). Que el
 * backend no las sirva allí es a propósito: nginx es más rápido para archivos
 * estáticos y así una imagen nunca pasa por Node.
 *
 * En desarrollo (NODE_ENV !== 'production') la PWA y el panel cargan las
 * imágenes desde el backend:
 *   - SOLO `/<uuid>.webp`, con el mismo patrón que valida url_imagen: nada de
 *     `..`, subcarpetas, otras extensiones ni los temporales `.xxx.tmp`;
 *   - sin listar el directorio (index: false) y sin redirecciones;
 *   - `X-Content-Type-Options: nosniff` (helmet ya lo pone; se repite aquí por
 *     si este router se usara sin helmet) y `Cross-Origin-Resource-Policy:
 *     cross-origin`: helmet pone same-origin, y la PWA en otro puerto no
 *     podría mostrar la imagen.
 *
 * @returns {express.Router|null} null en producción.
 */
function servirImagenesLocales(env = process.env) {
  if (enProduccion(env)) return null;

  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).json({ error: 'Ruta no encontrada' });
    if (!PATRON_RUTA_IMAGEN.test(`/imagenes${req.path}`)) return res.status(404).json({ error: 'Ruta no encontrada' });
    return next();
  });
  // El directorio se resuelve en cada petición (las pruebas cambian IMAGENES_DIR).
  router.use((req, res, next) => express.static(directorioImagenes(env), {
    index: false,
    redirect: false,
    dotfiles: 'deny',
    fallthrough: false,
    setHeaders(respuesta) {
      respuesta.setHeader('X-Content-Type-Options', 'nosniff');
      respuesta.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  })(req, res, (err) => {
    if (err && err.status === 404) return res.status(404).json({ error: 'Ruta no encontrada' });
    return next(err);
  }));
  return router;
}

module.exports = { servirImagenesLocales };
