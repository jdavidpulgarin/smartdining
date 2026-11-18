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

import { mesasApi, authApi, apiFetch } from './api'
import { prepararTablet } from '../utils/enlaceTablet'
import { tokenDeUrl } from '../utils/qrRotacion'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

// Decodifica base64url sin dependencias externas
function fromBase64Url(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return decodeURIComponent(escape(atob(base64)))
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

  // Sin respaldo (P-13): si el backend falla, el error sube a la pantalla. Un
  // QR inventado aquí no tendría una firma válida y el comensal no podría
  // entrar, aunque el panel mostrara la mesa como abierta.
  const data = await mesasApi.abrir(numId)
  if (!data?.token) {
    throw new Error('El servidor no devolvió el código QR de la mesa')
  }
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

/**
 * Rota el token QR de una mesa en curso: POST /api/mesas/:id/rotar-qr.
 * Sin respaldo (P-13): si el backend falla, el error sube a la pantalla.
 */
export async function rotarTokenQrMesa(idMesa, ttlMinutos = 240, { soloSiVacia = false } = {}) {
  const numId = Number(idMesa)

  const data = await mesasApi.rotarQr(numId, { soloSiVacia })
  // rotar-qr responde { url, expira_en, mesa }: el token NO viaja suelto (el
  // contrato solo lo da en /abrir), pero va dentro del url del comensal.
  const token = data?.token || tokenDeUrl(data?.url)
  if (!token) {
    throw new Error('El servidor no devolvió el nuevo código QR de la mesa')
  }
  const decodificado = decodificarTokenQr(token)
  return {
    token,
    url: data.url,
    id_mesa: numId,
    emitido_en: decodificado.emitido_en || Date.now(),
    expira_en: decodificado.expira_en || (Date.now() + ttlMinutos * 60 * 1000),
    sid: decodificado.sid,
    servidor: 'backend-api',
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
 * ¿Hay sesión del personal en ESTA pestaña? (el panel, o alguien del personal
 * que abrió la pantalla en su propia pestaña). Una tablet preparada desde el
 * panel NO la tiene: solo guarda su credencial de pantalla.
 */
export function haySesionPersonal() {
  return Boolean(getStaffToken())
}

/**
 * Pide el JWT de la PANTALLA de la mesa (rol 'pantalla'): POST /qr/pantalla
 * del socket-server (EVENTS.md §6), con el JWT de un usuario del personal.
 *
 * `staffToken`: el de la sesión de esta pestaña por defecto, o uno de un login
 * de una sola vez en la tablet (configurarTabletConLogin), que no se guarda.
 * Nunca se usa el JWT del personal como credencial de la tablet: queda a la
 * vista de los comensales y con él cualquiera podría actuar como mesero.
 *
 * @throws Error si no hay sesión o el servidor no la emite
 */
export async function solicitarTokenPantalla(idMesa, staffToken = getStaffToken()) {
  if (!staffToken) {
    throw new Error('No se pudo obtener la credencial de la pantalla (sin sesión de personal). Configura la pantalla desde el panel.')
  }
  let res
  try {
    res = await fetch(`${SOCKET_URL}/qr/pantalla`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ id_mesa: Number(idMesa) }),
    })
  } catch {
    throw new Error('No se pudo obtener la credencial de la pantalla (el servidor de tiempo real no responde).')
  }
  if (!res.ok) throw new Error(`No se pudo obtener la credencial de la pantalla (el servidor respondió ${res.status}).`)
  const data = await res.json()
  if (!data?.token) throw new Error('El servidor no devolvió la credencial de la pantalla')
  return data
}

/** La mesa vista por la ruta pública GET /api/mesas/:id (estado y número, sin token_qr). */
export function mesaPublica(idMesa) {
  return apiFetch(`/mesas/${Number(idMesa)}`, { skipAuth: true })
}

/**
 * «Lanzar Pantalla» / «Copiar URL Tablet» desde el panel (con su sesión):
 * credencial de pantalla + QR vigente (solo si la mesa está ocupada) y el
 * enlace /pantalla/mesa/<id_mesa>#t=…&qr=… (utils/enlaceTablet.js).
 */
export function prepararTabletDesdePanel(idMesa, origen = '') {
  return prepararTablet(Number(idMesa), {
    origen,
    pedirCredencial: (id) => solicitarTokenPantalla(id),
    obtenerMesa: mesaPublica,
    abrirMesa: (id) => mesasApi.abrir(id),
  })
}

/**
 * Una tablet física sin credencial: alguien del personal inicia sesión UNA vez
 * solo para prepararla. El JWT del personal vive en esta función y se
 * descarta al terminar: no se guarda en la tablet (ni en sessionStorage).
 */
export async function configurarTabletConLogin(idMesa, email, password) {
  const login = await authApi.login(email, password)
  let staffToken = login?.token
  if (!staffToken) throw new Error('No se pudo iniciar sesión')
  try {
    return await prepararTablet(Number(idMesa), {
      pedirCredencial: (id) => solicitarTokenPantalla(id, staffToken),
      obtenerMesa: mesaPublica,
      abrirMesa: (id) =>
        apiFetch(`/mesas/${id}/abrir`, { method: 'POST', skipAuth: true, headers: { Authorization: `Bearer ${staffToken}` } }),
    })
  } finally {
    staffToken = null
  }
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
export async function notificarQrRotado(idMesa, { soloSiVacia = true } = {}) {
  // Desde la tablet nunca se fuerza: con gente en la mesa el backend responde
  // 409 mesa_con_comensales y el QR se queda (T3).
  const data = await mesasApi.rotarQr(Number(idMesa), { soloSiVacia })
  // El backend solo devuelve la url; el token se lee de ahí para redibujar.
  let token = null
  try {
    token = new URL(data.url).searchParams.get('token')
  } catch {
    token = null
  }
  return { ok: true, token, url: data.url, expira_en: data.expira_en ?? null }
}
