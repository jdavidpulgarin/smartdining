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

/**
 * Maneja el evento 'vite:preloadError'.
 * Previene el comportamiento por defecto y evalúa si corresponde recargar.
 * Si el storage no está disponible o lanza error, no recarga para evitar
 * bucles de recarga infinitos y dejar que ErrorBoundary muestre la interfaz de recuperación.
 *
 * @param {{ preventDefault?: () => void }} evento
 * @param {object} [opciones]
 * @param {Storage | null} [opciones.storage]
 * @param {number} [opciones.ahora]
 * @param {() => void} [opciones.recargar]
 * @returns {boolean} true si se ejecutó la recarga, false en caso contrario
 */
export function manejarPreloadError(
  evento,
  { storage, ahora = Date.now(), recargar } = {}
) {
  evento?.preventDefault?.()
  if (!storage) {
    return false
  }
  try {
    const ultima = storage.getItem(CLAVE_RECARGA_PRELOAD)
    if (debeRecargarPorPreload(ahora, ultima)) {
      storage.setItem(CLAVE_RECARGA_PRELOAD, String(ahora))
      recargar?.()
      return true
    }
    return false
  } catch {
    return false
  }
}
