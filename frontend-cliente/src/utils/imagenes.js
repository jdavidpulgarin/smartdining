import { urlsServidor } from './urlsServidor';

const PATRON_RUTA = /^\/imagenes\/[0-9a-f-]{36}\.webp$/;
const PATRON_ORIGEN = /^(https?:\/\/[^/?#]+)/i;
// oxlint-disable-next-line eslint/no-control-regex, no-control-regex
const PATRON_HTTPS = /^https:\/\/[^\s/?#\x00-\x1f\x7f]+(?:[/?#][^\s\x00-\x1f\x7f]*)?$/;

/**
 * Resuelve la URL pública de una imagen según su origen con lista blanca.
 *
 * Reglas:
 * - const PATRON_RUTA = /^\/imagenes\/[0-9a-f-]{36}\.webp$/
 * - null, undefined, no-string, '' o solo espacios → null
 * - /imagenes/<uuid>.webp que cumple PATRON_RUTA exacto → origen de la API + ruta. Si no hay origen válido → null.
 * - Ya resuelta (idempotente): URL absoluta cuyo origen es EXACTAMENTE el origen de la API y cuyo path cumple PATRON_RUTA → igual.
 * - Cualquier otra https:// bien formada (sin espacios ni caracteres de control) → igual.
 * - TODO lo demás → null: http:// de otro origen, javascript:, data:, //host, rutas relativas, ../, /imagenes/../…, /imagenes/x.png, mayúsculas raras en el esquema que no sean https, etc.
 *
 * @param {string | null | undefined} url
 * @param {string} [apiBase]
 * @returns {string | null}
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

/**
 * Resuelve la URL de la imagen usando la URL base de la API configurada en el cliente.
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function urlImagen(url) {
  const apiBase = urlsServidor()?.api;
  return resolverUrlImagen(url, apiBase);
}

export default urlImagen;
