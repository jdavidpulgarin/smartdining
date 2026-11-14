const path = require('path');

/**
 * D-23: dónde se guardan las imágenes subidas y cuánto pueden pesar.
 *
 * Se lee del entorno en CADA llamada, no al cargar el módulo: las pruebas usan
 * un IMAGENES_DIR temporal por caso.
 *
 *   IMAGENES_DIR        carpeta de las imágenes. Por defecto:
 *                         producción: /app/uploads/imagenes (el volumen que
 *                           monta Roberto en el contenedor; nginx lo sirve);
 *                         desarrollo: backend/uploads/imagenes (en .gitignore).
 *   IMAGENES_MAX_BYTES  tamaño máximo del archivo subido. Por defecto 2 MB.
 */

const DIR_PRODUCCION = '/app/uploads/imagenes';
const DIR_DESARROLLO = path.resolve(__dirname, '..', '..', 'uploads', 'imagenes');
const MAX_BYTES_POR_DEFECTO = 2 * 1024 * 1024; // 2097152

/** ¿Producción? Solo ahí el backend NO sirve /imagenes (lo hace nginx). */
function enProduccion(env = process.env) {
  return env.NODE_ENV === 'production';
}

/** Carpeta absoluta de las imágenes. */
function directorioImagenes(env = process.env) {
  if (env.IMAGENES_DIR) return path.resolve(env.IMAGENES_DIR);
  return enProduccion(env) ? DIR_PRODUCCION : DIR_DESARROLLO;
}

/** Tamaño máximo en bytes (entero positivo; si no, el valor por defecto). */
function maxBytesImagen(env = process.env) {
  const n = Number(env.IMAGENES_MAX_BYTES);
  return Number.isInteger(n) && n > 0 ? n : MAX_BYTES_POR_DEFECTO;
}

module.exports = {
  DIR_PRODUCCION,
  DIR_DESARROLLO,
  MAX_BYTES_POR_DEFECTO,
  enProduccion,
  directorioImagenes,
  maxBytesImagen,
};
