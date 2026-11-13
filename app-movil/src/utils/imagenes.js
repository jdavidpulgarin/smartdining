/**
 * Resuelve la URL pública de una imagen según su origen en la app móvil.
 *
 * Reglas:
 * - null, undefined, '' o solo espacios → null
 * - empieza por http:// o https:// → igual
 * - empieza por /imagenes/ → new URL(apiBase).origin + url (si apiBase es inválida o falta, devuelve url tal cual)
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
    try {
      const parsed = new URL(apiBase.trim());
      return `${parsed.origin}${limpia}`;
    } catch {
      return limpia;
    }
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
