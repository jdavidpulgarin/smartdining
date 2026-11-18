import { API_URL } from '../config.js';

const PATRON_RUTA = /^\/imagenes\/[0-9a-f-]{36}\.webp$/;
const PATRON_ORIGEN = /^(https?:\/\/[^/?#]+)/i;
// oxlint-disable-next-line eslint/no-control-regex, no-control-regex
const PATRON_HTTPS = /^https:\/\/[^\s/?#\x00-\x1f\x7f]+(?:[/?#][^\s\x00-\x1f\x7f]*)?$/;

/**
 * Resuelve la URL pública de una imagen según su origen con lista blanca.
 * Si apiBase es una ruta relativa (empieza por '/'), devuelve la ruta tal cual
 * para que el servidor de desarrollo la sirva mediante su proxy de mismo origen.
 */
export function resolverUrlImagen(url, apiBase = API_URL) {
  if (url === null || url === undefined || typeof url !== 'string') {
    return null;
  }

  const limpia = url.trim();
  if (limpia.length === 0) {
    return null;
  }

  const apiTrim = typeof apiBase === 'string' ? apiBase.trim() : '';
  const esRelativo = apiTrim.startsWith('/');

  let origenApi = null;
  if (!esRelativo) {
    const m = PATRON_ORIGEN.exec(apiTrim);
    if (m) {
      origenApi = m[1];
    }
  }

  // 1. Ruta relativa /imagenes/<uuid>.webp que cumple PATRON_RUTA exacto
  if (PATRON_RUTA.test(limpia)) {
    if (esRelativo) {
      return limpia;
    }
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
