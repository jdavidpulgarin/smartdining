/**
 * Reglas del QR de la mesa en el modal del panel (P-07).
 *
 * El socket-server rota el QR de una mesa abierta y VACÍA cada 3 minutos
 * (socket-server/docs/rotacion-qr.md, #168), pero avisa solo a la sala de la
 * mesa (la tablet): el panel no se entera. Por eso el modal no puede fiarse del
 * enlace que tiene en memoria:
 *
 *   - al abrirse con la mesa vacía pide un QR nuevo (POST /mesas/:id/rotar-qr);
 *   - mientras sigue abierto lo renueva ANTES de los 3 minutos;
 *   - si no pudo renovarlo a tiempo, muestra "QR vencido · Generar nuevo" en vez
 *     de un QR que ya no sirve.
 *
 * Rotar a mano reinicia también el rotador del socket-server con el token nuevo
 * (/qr/generar → rotador.abrir), así que los dos no se pisan.
 *
 * Con comensales dentro NO se rota nunca de forma automática: rotar invalida la
 * sesión de quien ya entró (el backend compara el sid con mesas.token_qr). La
 * ruta manual rotar-qr no tiene esa guarda (solo la interna de #168 responde
 * 409 mesa_con_comensales), así que la decide el panel; si el backend llega a
 * responder ese 409, se respeta igual.
 */

/** Cada cuánto rota el socket-server una mesa vacía. */
export const ROTACION_SOCKET_SEGUNDOS = 180

/** El modal renueva antes que el socket-server, con margen para la petición. */
export const RENOVAR_CADA_SEGUNDOS = 165

/** Reintentos de una rotación que falló por algo pasajero (503, sin conexión). */
export const REINTENTOS_MAXIMOS = 3
export const REINTENTO_SEGUNDOS = 10

/**
 * El token de la mesa desde el `url` del comensal (`…/?token=v1.…`). `rotar-qr`
 * no devuelve `token` suelto (el contrato solo lo da en /abrir), pero el `url`
 * lo lleva. null si no hay.
 */
export function tokenDeUrl(url) {
  if (typeof url !== 'string' || !url) return null
  try {
    const t = new URL(url, 'http://x').searchParams.get('token')
    return t && t.trim() ? t.trim() : null
  } catch {
    return null
  }
}

/**
 * ¿La presencia del socket-server (mesa:presencia: { total, comensales,
 * sin_celular }) dice que hay alguien en la mesa?
 */
export function hayPresencia(presencia) {
  if (!presencia || typeof presencia !== 'object') return false
  return Number(presencia.total) > 0
    || (Array.isArray(presencia.comensales) && presencia.comensales.length > 0)
    || (Array.isArray(presencia.sin_celular) && presencia.sin_celular.length > 0)
}

/** ¿Se puede rotar SOLO (al abrir el modal o por tiempo)? Mesa abierta y vacía. */
export function puedeRotarSolo({ ocupada, tieneComensales, token }) {
  return Boolean(ocupada && token && !tieneComensales)
}

/**
 * Error de rotar-qr → { texto, reintentar }. Nunca se inventa un QR: si falla,
 * se dice por qué y, si es pasajero, se reintenta.
 */
export function errorDeRotacion(err) {
  if (err?.sinConexion) {
    return { texto: 'Sin conexión con el servidor: no se pudo generar el QR nuevo. Reintentando…', reintentar: true }
  }
  switch (err?.status) {
    case 404:
      return { texto: 'La mesa ya no existe. Cierra este modal y actualiza las mesas.', reintentar: false }
    case 409:
      if (err?.motivo === 'mesa_con_comensales') {
        return { texto: 'La mesa ya tiene comensales: el QR queda fijo.', reintentar: false, conComensales: true }
      }
      return { texto: 'La mesa ya no está abierta: no hay QR que rotar. Ábrela de nuevo.', reintentar: false }
    case 403:
      return { texto: 'Tu rol no puede generar el QR de la mesa.', reintentar: false }
    case 503:
    case 502:
      return { texto: 'El servidor de tiempo real no responde: no se pudo generar el QR nuevo. Reintentando…', reintentar: true }
    default:
      return { texto: `No se pudo generar el QR nuevo: ${err?.message || 'error desconocido'}`, reintentar: false }
  }
}
