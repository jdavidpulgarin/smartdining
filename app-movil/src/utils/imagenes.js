/**
 * Resuelve la URL pública de una imagen según su origen en la app móvil.
 *
 * Reglas:
 * - null, undefined, '' o solo espacios → null
 * - empieza por http:// o https:// → igual
 * - empieza por /imagenes/ → origen de apiBase (extraído vía regex) + url; si apiBase es inválida o no tiene match, devuelve url tal cual
 * - cualquier otro valor → igual (no romper datos viejos)
 * - debe ser idempotente: resolver dos veces da lo mismo
 *
 * @param {string | null | undefined} url
 * @param {string} [apiBase]
 * @returns {string | null}
 */
export function resolverUrlImagen(url, apiBase) {
  if (url === null || url === undefined) return null;
  if (typeof url !== 'string') return null;

  const limpia = url.trim();
  if (limpia.length === 0) return null;

  if (limpia.startsWith('http://') || limpia.startsWith('https://')) {
    return limpia;
  }

  if (limpia.startsWith('/imagenes/')) {
    if (!apiBase || typeof apiBase !== 'string') {
      return limpia;
    }
    const m = /^(https?:\/\/[^/?#]+)/i.exec(apiBase.trim());
    if (m) {
      return `${m[1]}${limpia}`;
    }
    return limpia;
  }

  return limpia;
}

/**
 * Resuelve la URL de la imagen usando process.env.EXPO_PUBLIC_API_URL.
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function urlImagen(url) {
  const apiBase =
    typeof process !== 'undefined' && process.env
      ? process.env.EXPO_PUBLIC_API_URL
      : undefined;
  return resolverUrlImagen(url, apiBase);
}

export default urlImagen;
