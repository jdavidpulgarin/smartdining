import { API_URL } from '../config.js';

const PATRON_RUTA = /^\/imagenes\/[0-9a-f-]{36}\.webp$/;
const PATRON_ORIGEN = /^(https?:\/\/[^/?#]+)/i;
// oxlint-disable-next-line eslint/no-control-regex, no-control-regex
const PATRON_HTTPS = /^https:\/\/[^\s/?#\x00-\x1f\x7f]+(?:[/?#][^\s\x00-\x1f\x7f]*)?$/;

/**
 * Resuelve la URL pública de una imagen según su origen con lista blanca.
 */
export function resolverUrlImagen(url, apiBase) {
  if (url === null || url === undefined || typeof url !== 'string') {
    return null;
  }

  const limpia = url.trim();
  if (limpia.length === 0) {
    return null;
  }

  let origenApi = null;
  if (typeof apiBase === 'string') {
    const m = PATRON_ORIGEN.exec(apiBase.trim());
    if (m) {
      origenApi = m[1];
    }
  }

  // 1. Ruta relativa /imagenes/<uuid>.webp que cumple PATRON_RUTA exacto
  if (PATRON_RUTA.test(limpia)) {
    if (!origenApi) return null;
    return `${origenApi}${limpia}`;
  }

  // 2. Ya resuelta con el origen de la API (idempotente)
  if (origenApi && limpia.startsWith(`${origenApi}/`)) {
    const path = limpia.slice(origenApi.length);
    if (PATRON_RUTA.test(path)) {
      return limpia;
    }
    return null;
  }

  // 3. Cualquier otra https:// bien formada (sin espacios ni caracteres de control)
  if (PATRON_HTTPS.test(limpia)) {
    return limpia;
  }

  // 4. Todo lo demás es inválido o no permitido
  return null;
}

export function urlImagen(url) {
  return resolverUrlImagen(url, API_URL);
}

export default urlImagen;
