export const CLAVE_RECARGA_PRELOAD = 'smartdining_recarga_preload'
export const VENTANA_RECARGA_MS = 10000

/**
 * Decide si se debe recargar la página tras un error 'vite:preloadError'.
 * Recarga si no hay registro previo, si el valor previo es inválido (NaN)
 * o si ya pasaron más de 10 segundos desde la última recarga.
 *
 * @param {number} ahoraMs
 * @param {number | null | undefined} ultimaMs
 * @returns {boolean}
 */
export function debeRecargarPorPreload(ahoraMs, ultimaMs) {
  if (ultimaMs === null || ultimaMs === undefined) return true
  const numero = Number(ultimaMs)
  if (Number.isNaN(numero)) return true
  return ahoraMs - numero > VENTANA_RECARGA_MS
}
