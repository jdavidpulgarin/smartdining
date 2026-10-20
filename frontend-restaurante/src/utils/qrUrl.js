/**
 * Utilidades para resolución y formateo de URLs de códigos QR de mesa
 * SmartDining — frontend-restaurante
 */

/**
 * Extrae el hostname de una URL (ej. "http://192.168.1.9:5174/..." -> "192.168.1.9")
 * @param {string} urlStr
 * @returns {string}
 */
export function extraerHostDeUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return ''
  try {
    return new URL(urlStr).hostname
  } catch {
    return ''
  }
}

/**
 * Comprueba si un host corresponde a la máquina local (localhost, 127.0.0.1, ::1)
 * @param {string} host
 * @returns {boolean}
 */
export function esHostLocal(host) {
  if (!host || typeof host !== 'string') return false
  const h = host.toLowerCase().trim()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

/**
 * Obtiene el host por defecto para la sesión sin IPs fijas escritas a mano.
 * Prioriza el host que venga en qrUrl (del backend). Si no hay o es vacío,
 * toma window.location.hostname si no es localhost. Fallback: 'localhost'.
 * @param {string} [qrUrl]
 * @returns {string}
 */
export function obtenerHostPorDefecto(qrUrl) {
  const hostQr = extraerHostDeUrl(qrUrl)
  if (hostQr) return hostQr

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const navHost = window.location.hostname
    if (!esHostLocal(navHost)) {
      return navHost
    }
  }

  return 'localhost'
}

/**
 * Resuelve la URL final codificada en el código QR para el comensal.
 * Si recibe backendUrl (qr_url):
 *  - Si useWifiIp es falso, fuerza localhost manteniendo puerto, path y query.
 *  - Si useWifiIp es verdadero y se suministra hostIp (distinto o modificado por el usuario),
 *    reemplaza el hostname manteniendo el puerto y token de qr_url.
 *  - Si no hay modificaciones, usa backendUrl tal cual.
 * Si no recibe backendUrl (fallback solo con token):
 *  - Genera la URL con activeHost, fallbackPort, token y mesa.
 *
 * @param {Object} params
 * @param {string} [params.backendUrl]
 * @param {string} [params.token]
 * @param {string|number} [params.tableNumber]
 * @param {string} [params.hostIp]
 * @param {boolean} [params.useWifiIp=true]
 * @param {string} [params.fallbackPort='5174']
 * @returns {string}
 */
export function resolverDiningUrl({
  backendUrl,
  token,
  tableNumber,
  hostIp,
  useWifiIp = true,
  fallbackPort = '5174',
}) {
  if (backendUrl) {
    try {
      const parsed = new URL(backendUrl)
      if (!useWifiIp) {
        parsed.hostname = 'localhost'
        return parsed.toString()
      }
      if (hostIp && hostIp.trim()) {
        parsed.hostname = hostIp.trim()
        return parsed.toString()
      }
      return backendUrl
    } catch {
      if (!useWifiIp) {
        return backendUrl.replace(/localhost|127\.0\.0\.1|[\d.]+/i, 'localhost')
      }
      if (hostIp && hostIp.trim()) {
        return backendUrl.replace(/localhost|127\.0\.0\.1/, hostIp.trim())
      }
      return backendUrl
    }
  }

  const activeHost = useWifiIp && hostIp && hostIp.trim() ? hostIp.trim() : 'localhost'
  const mesaVal = tableNumber ? encodeURIComponent(tableNumber) : '1'
  const tokenVal = token ? `token=${encodeURIComponent(token)}&` : ''
  return `http://${activeHost}:${fallbackPort}/?${tokenVal}mesa=${mesaVal}`
}
