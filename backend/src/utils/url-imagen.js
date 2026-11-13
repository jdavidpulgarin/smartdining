const { z } = require('zod');

/**
 * D-23: qué se acepta como `url_imagen` de un plato o de un ingrediente del
 * constructor. Dos formas, y nada más:
 *
 *   1. Una URL ABSOLUTA **https** (una imagen alojada fuera). http NO: en
 *      producción la CSP de app. y staff. solo permite `img-src https:` (PR de
 *      Roberto), así que una foto http quedaría bloqueada por el navegador SIN
 *      aviso: el plato se vería sin imagen y nadie sabría por qué. Mejor un 400
 *      al guardarla. El esquema no distingue mayúsculas (`HTTPS://` vale): se
 *      compara el `protocol` que normaliza `new URL`.
 *   2. Una ruta RELATIVA de una imagen subida con POST /api/imagenes:
 *      exactamente `/imagenes/<uuid>.webp`, con el uuid en minúsculas tal como
 *      lo genera crypto.randomUUID(). Sin `..`, sin otras carpetas, sin otra
 *      extensión: el patrón está anclado en los dos extremos.
 *
 * Máximo 255 caracteres (la columna es VARCHAR(255)).
 *
 * Antes `platos` usaba `z.string().url()`, que también deja pasar esquemas
 * como `javascript:`, `ftp:` o `http:`; ahora solo https.
 */

const MAX_URL_IMAGEN = 255;

const PATRON_RUTA_IMAGEN =
  /^\/imagenes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

const MENSAJE_URL_IMAGEN =
  'url_imagen debe ser una URL https o una ruta /imagenes/<uuid>.webp (máximo 255 caracteres)';

/**
 * ¿Es una URL absoluta https? `new URL` pasa el esquema a minúsculas, así que
 * `HTTPS://` vale y `HTTP://` no. Solo https por la CSP de producción (arriba).
 */
function esUrlHttps(valor) {
  try {
    return new URL(valor).protocol === 'https:';
  } catch {
    return false;
  }
}

/** ¿`valor` es una url_imagen válida (cualquiera de las dos formas)? */
function esUrlImagenValida(valor) {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > MAX_URL_IMAGEN) return false;
  return PATRON_RUTA_IMAGEN.test(valor) || esUrlHttps(valor);
}

/** El esquema zod de una url_imagen con valor (sin null ni vacío). */
const urlImagenSchema = z
  .string()
  .max(MAX_URL_IMAGEN, MENSAJE_URL_IMAGEN)
  .refine(esUrlImagenValida, MENSAJE_URL_IMAGEN);

module.exports = {
  MAX_URL_IMAGEN,
  PATRON_RUTA_IMAGEN,
  MENSAJE_URL_IMAGEN,
  esUrlImagenValida,
  urlImagenSchema,
};
