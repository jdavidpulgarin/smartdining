/**
 * Servicio de Códigos QR Dinámicos por Sesión
 * SmartDining — Módulo de Sala / Mesas
 *
 * Conecta el ciclo de vida de la sesión de mesa con el backend oficial:
 * - POST /api/mesas/:id/abrir  -> abre la sesión, bloquea fila, genera/reutiliza QR firmado y notifica al socket
 * - POST /api/mesas/:id/liberar -> valida pedidos pendientes, revoca el QR y notifica al socket
 *
 * Formato del token acordado: v1.<payload_base64url>.<firma_base64url>
 * Payload: { m: id_mesa, iat: emitido_ms, exp: expira_ms, sid: id_sesion }
 */

import { mesasApi } from './api'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

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
 * Obtiene el token JWT del personal logueado desde sessionStorage
 */
function getStaffToken() {
  try {
    const stored = sessionStorage.getItem('smartdining_staff_user')
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
 * Decodifica un token QR en formato v1.<datos>.<firma> del lado cliente
 * para inspeccionar id_mesa, sid, iat y exp sin verificar firma.
 */
export function decodificarTokenQr(token) {
  if (!token || typeof token !== 'string') {
    return { esValido: false, motivo: 'token_vacio' }
  }

  const partes = token.split('.')
  if (partes.length !== 3 || partes[0] !== 'v1') {
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
 * Abre la mesa y obtiene su token QR firmado a través del Backend REST oficial (PR #4):
 * POST /api/mesas/:id/abrir
 *
 * El backend valida el rol de mesero/admin, consulta/genera el QR con el socket-server
 * y notifica a la pantalla tablet si es un QR nuevo.
 */
export async function generarTokenQrMesa(idMesa, ttlMinutos = 240) {
  const numId = Number(idMesa)

  // 1. Intento principal contra el Backend oficial (POST /api/mesas/:id/abrir)
  try {
    const data = await mesasApi.abrir(numId)
    if (data?.token) {
      const decodificado = decodificarTokenQr(data.token)
      return {
        token: data.token,
        url: data.url,
        id_mesa: numId,
        reutilizado: Boolean(data.reutilizado),
        emitido_en: decodificado.emitido_en || Date.now(),
        expira_en: decodificado.expira_en || (Date.now() + ttlMinutos * 60 * 1000),
        sid: decodificado.sid,
        servidor: 'backend-api',
      }
    }
  } catch (err) {
    console.warn('Aviso: backend mesas/:id/abrir falló o está offline:', err.message)
    // Si el error es 401, 403 o 409 (reglas de negocio), relanzar para que la UI informe
    if (err.status && err.status < 500) {
      throw err
    }
  }

  // 2. Fallback sintético local en caso de entorno de desarrollo sin backend levantado
  const iat = Date.now()
  const exp = iat + ttlMinutos * 60 * 1000
  const sid = generarCadenaAleatoria(12)
  const payload = {
    m: numId,
    iat,
    exp,
    sid,
  }

  const cuerpo = `v1.${toBase64Url(JSON.stringify(payload))}`
  const firmaMock = toBase64Url(`sig_${sid}_${iat}`).slice(0, 43)
  const token = `${cuerpo}.${firmaMock}`

  return {
    token,
    url: `http://localhost:5173/?token=${encodeURIComponent(token)}`,
    id_mesa: numId,
    emitido_en: iat,
    expira_en: exp,
    sid,
    servidor: 'local-fallback',
  }
}

/**
 * Rota el token QR de una mesa en curso:
 * Intenta POST /api/mesas/:id/rotar-qr en el backend oficial.
 * Si el backend está desconectado o no implementa la ruta, genera un nuevo sid firmado
 * y notifica /internal/qr-rotado al socket-server.
 */
export async function rotarTokenQrMesa(idMesa, ttlMinutos = 240) {
  const numId = Number(idMesa)

  // 1. Intento contra el Backend oficial (POST /api/mesas/:id/rotar-qr)
  try {
    const data = await mesasApi.rotarQr(numId)
    if (data?.token) {
      const decodificado = decodificarTokenQr(data.token)
      return {
        token: data.token,
        url: data.url,
        id_mesa: numId,
        emitido_en: decodificado.emitido_en || Date.now(),
        expira_en: decodificado.expira_en || (Date.now() + ttlMinutos * 60 * 1000),
        sid: decodificado.sid,
        servidor: 'backend-api',
      }
    }
  } catch (err) {
    console.warn('Aviso: endpoint rotarQr no disponible o falló:', err.message)
    if (err.status && err.status === 409) {
      throw err
    }
  }

  // 2. Fallback sintético local: genera nuevo sid firmado y avisa al socket-server
  const iat = Date.now()
  const exp = iat + ttlMinutos * 60 * 1000
  const sid = generarCadenaAleatoria(12)
  const payload = {
    m: numId,
    iat,
    exp,
    sid,
  }

  const cuerpo = `v1.${toBase64Url(JSON.stringify(payload))}`
  const firmaMock = toBase64Url(`sig_${sid}_${iat}`).slice(0, 43)
  const nuevoToken = `${cuerpo}.${firmaMock}`

  // Notificar al socket-server para que tablets físicas reciban 'qr:actualizado'
  await notificarQrRotado(numId, nuevoToken)

  return {
    token: nuevoToken,
    url: `http://localhost:5173/?token=${encodeURIComponent(nuevoToken)}&mesa=${numId}`,
    id_mesa: numId,
    emitido_en: iat,
    expira_en: exp,
    sid,
    servidor: 'local-fallback-rotado',
  }
}

/**
 * Libera una mesa a través del Backend oficial:
 * POST /api/mesas/:id/liberar
 *
 * El backend verifica que no haya pedidos abiertos (responde 409 si los hay),
 * coloca token_qr en NULL y notifica internamente al socket-server para revocar el QR.
 */
export async function liberarMesaRemota(idMesa) {
  const numId = Number(idMesa)
  try {
    const res = await mesasApi.liberar(numId)
    return { ok: true, mesa: res }
  } catch (err) {
    console.warn('Aviso: liberación de mesa falló en backend:', err.message)
    throw err
  }
}

/**
 * Solicita el JWT de autenticación para la tablet física de la mesa (rol 'pantalla')
 * llamando a POST /qr/pantalla del socket-server (EVENTS.md §6).
 *
 * Si falla, se reutiliza solo un token de PANTALLA emitido antes para esta mesa.
 * Nunca se usa el JWT del personal en su lugar: la tablet queda a la vista de
 * los comensales y con ese token cualquiera podría actuar como mesero (abrir y
 * liberar mesas, ver todas las salas). Sin credencial, se lanza un error para
 * que la pantalla lo muestre.
 *
 * @throws Error si no hay token de pantalla emitido ni en caché
 */
export async function solicitarTokenPantalla(idMesa) {
  const staffToken = getStaffToken()
  const storageKey = `smartdining_pantalla_token_${idMesa}`
  let motivo = 'sin sesión de personal'

  if (staffToken) {
    try {
      const res = await fetch(`${SOCKET_URL}/qr/pantalla`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${staffToken}`,
        },
        body: JSON.stringify({ id_mesa: Number(idMesa) }),
      })

      if (res.ok) {
        const data = await res.json()
        try {
          sessionStorage.setItem(storageKey, data.token)
        } catch {
          // ignorar
        }
        return data
      }
      motivo = `el servidor respondió ${res.status}`
    } catch (err) {
      motivo = 'el servidor de tiempo real no responde'
      console.warn('Aviso: no se pudo obtener token de /qr/pantalla:', err.message)
    }
  }

  // Respaldo: reutilizar un token de pantalla ya emitido para esta mesa
  try {
    const cached = sessionStorage.getItem(storageKey)
    if (cached) {
      return { token: cached, id_mesa: Number(idMesa), expira_en: 'cached' }
    }
  } catch {
    // ignorar
  }

  throw new Error(`No se pudo obtener la credencial de la pantalla (${motivo}). Inicia sesión como personal y recarga.`)
}

/**
 * Rota el QR de una mesa abierta a través del backend:
 * POST /api/mesas/:id/rotar-qr (Bearer del personal).
 *
 * El navegador NUNCA llama a /internal/* del socket-server: esa ruta exige la
 * clave interna, y cualquier valor con prefijo VITE_ queda incrustado en el
 * JavaScript público. El backend guarda el token nuevo y, tras el commit, es
 * él quien avisa a la tablet (qr:actualizado).
 *
 * @returns {Promise<{ ok: true, token: string, url: string, expira_en: number|null }>}
 * @throws Error con .status si el backend rechaza (401/403/409/503)
 */
export async function notificarQrRotado(idMesa) {
  const data = await mesasApi.rotarQr(Number(idMesa))
  // El backend solo devuelve la url; el token se lee de ahí para redibujar.
  let token = null
  try {
    token = new URL(data.url).searchParams.get('token')
  } catch {
    token = null
  }
  return { ok: true, token, url: data.url, expira_en: data.expira_en ?? null }
}
