/**
 * Servicio de Códigos QR Dinámicos por Sesión
 * SmartDining — Módulo de Sala / Mesas
 *
 * Implementa la especificación acordada con Roberto (socket-server) y Carlos (backend):
 * - Formato: v1.<payload_base64url>.<firma_base64url>
 * - Payload: { m: id_mesa, iat: emitido_ms, exp: expira_ms, sid: id_sesion }
 * - Un solo QR firmado por grupo/sesión, reutilizable hasta que la mesa se libera.
 */

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

// Utilidad base64url para codificar/decodificar payloads sin dependencias externas
function toBase64Url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return decodeURIComponent(escape(atob(base64)))
}

function generarCadenaAleatoria(longitud = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let result = ''
  for (let i = 0; i < longitud; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * Obtiene el token JWT del usuario de staff logueado para autorizar la petición.
 */
function getStaffToken() {
  try {
    const stored = localStorage.getItem('smartdining_staff_user')
    if (stored) {
      const u = JSON.parse(stored)
      return u.token || ''
    }
  } catch {
    // ignorar
  }
  return ''
}

/**
 * Decodifica un token QR en formato v1.<datos>.<firma> sin verificar firma (del lado cliente)
 * para inspeccionar id_mesa, sid, iat y exp.
 */
export function decodificarTokenQr(token) {
  if (!token || typeof token !== 'string') {
    return { esValido: false, motivo: 'token_vacio' }
  }

  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'v1') {
    // Si es un token de formato legacy o mock simple
    return {
      esValido: false,
      version: 'legacy',
      sid: token.slice(-8),
      id_mesa: null,
      expira_en: null,
      expiraTexto: 'Token sin formato v1',
    }
  }

  try {
    const payload = JSON.parse(fromBase64Url(partes[1]))
    const ahora = Date.now()
    const expirado = payload.exp ? ahora >= payload.exp : false

    return {
      esValido: !expirado,
      version: partes[0],
      id_mesa: payload.m,
      sid: payload.sid || 'N/A',
      emitido_en: payload.iat,
      expira_en: payload.exp,
      expirado,
      expiraTexto: payload.exp
        ? new Date(payload.exp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Sin expiración',
    }
  } catch (err) {
    return { esValido: false, motivo: 'parse_error', error: err.message }
  }
}

/**
 * Genera un nuevo token QR dinámico para una mesa.
 * 1. Intenta llamar a POST /qr/generar del socket-server (puerto 4001) con rol staff.
 * 2. Si no responde el servidor (modo offline/demo), genera un token v1 sintético válido
 *    con firma simulada para permitir desarrollo fluido y pruebas locales.
 */
export async function generarTokenQrMesa(idMesa, ttlMinutos = 240) {
  const staffToken = getStaffToken()

  // 1. Intento con el servidor socket-server / backend
  try {
    const res = await fetch(`${SOCKET_URL}/qr/generar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: staffToken ? `Bearer ${staffToken}` : '',
      },
      body: JSON.stringify({
        id_mesa: Number(idMesa),
        ttl_minutos: ttlMinutos,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      const decodificado = decodificarTokenQr(data.token)
      return {
        token: data.token,
        id_mesa: data.id_mesa,
        emitido_en: data.emitido_en,
        expira_en: data.expira_en,
        sid: decodificado.sid,
        servidor: 'socket-server',
      }
    }
  } catch {
    // Servidor socket offline: se aplica fallback sintético con formato v1 idéntico
  }

  // 2. Fallback sintético local con formato estricto v1.<payload>.<firma>
  const iat = Date.now()
  const exp = iat + ttlMinutos * 60 * 1000
  const sid = generarCadenaAleatoria(12)
  const payload = {
    m: Number(idMesa),
    iat,
    exp,
    sid,
  }

  const cuerpo = `v1.${toBase64Url(JSON.stringify(payload))}`
  const firmaMock = toBase64Url(`sig_${sid}_${iat}`).slice(0, 43)
  const token = `${cuerpo}.${firmaMock}`

  return {
    token,
    id_mesa: Number(idMesa),
    emitido_en: iat,
    expira_en: exp,
    sid,
    servidor: 'local-fallback',
  }
}

/**
 * Notifica la liberación de una mesa a los servidores:
 * - Backend: POST /api/mesas/:id/liberar (o PATCH /api/mesas/:id/estado)
 * - Socket server: POST /internal/mesa-liberada
 */
export async function liberarMesaRemota(idMesa) {
  const staffToken = getStaffToken()

  try {
    // Intentar backend REST primero
    await fetch(`${API_URL}/mesas/${idMesa}/liberar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: staffToken ? `Bearer ${staffToken}` : '',
      },
    }).catch(() => null)

    // Notificar también al socket server si está activo
    await fetch(`${SOCKET_URL}/internal/mesa-liberada`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-key': 'dev-key',
      },
      body: JSON.stringify({ id_mesa: Number(idMesa) }),
    }).catch(() => null)

    return { ok: true }
  } catch (err) {
    console.warn('Aviso: liberación remota no pudo sincronizarse con el servidor:', err.message)
    return { ok: false, error: err.message }
  }
}
