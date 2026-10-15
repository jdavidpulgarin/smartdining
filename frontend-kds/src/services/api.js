/**
 * Cliente HTTP del KDS. Solo habla con el backend REST y SIEMPRE con el JWT del
 * usuario de cocina: aqui no existe ninguna clave interna. La INTERNAL_API_KEY
 * es del canal servidor-a-servidor y cualquier variable VITE_ acabaria en el
 * navegador, asi que no se usa ni se lee.
 */

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'

/** Evento global con el que la app cierra sesion al ver un 401. */
export const EVENTO_NO_AUTORIZADO = 'kds:auth:no-autorizado'

/** Error con el status HTTP, para que quien llame decida qué hacer. */
export class ErrorApi extends Error {
  constructor(mensaje, status, retryAfter = null) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.status = status
    this.retryAfter = retryAfter
  }
}

export function avisarNoAutorizado(mensaje = null) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_NO_AUTORIZADO, { detail: { mensaje } }))
  }
}

/**
 * fetch con JSON y Authorization. Un 401 dispara el cierre de sesion antes de
 * lanzar, para que da igual quien hiciera la llamada: la sesion caduca una sola
 * vez y en un solo sitio.
 */
async function pedir(ruta, { token, ...opciones } = {}) {
  const url = `${API_URL}${ruta.startsWith('/') ? '' : '/'}${ruta}`

  const respuesta = await fetch(url, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opciones.headers,
    },
  })

  const retryHeader = respuesta.headers?.get
    ? (respuesta.headers.get('retry-after') || respuesta.headers.get('Retry-After'))
    : null
  const retryParsed = retryHeader ? parseInt(retryHeader, 10) : null
  const retryAfter =
    Number.isFinite(retryParsed) && retryParsed > 0
      ? retryParsed
      : respuesta.status === 429
        ? 60
        : null

  const texto = await respuesta.text()
  let datos = null
  try {
    datos = texto ? JSON.parse(texto) : null
  } catch {
    datos = null
  }

  if (respuesta.status === 401) {
    const isLogin = ruta.includes('/auth/login')
    if (!isLogin) {
      avisarNoAutorizado(datos?.error || 'Tu sesión no es válida o tu cuenta fue desactivada')
    }
    throw new ErrorApi(datos?.error || 'Sesión expirada', 401)
  }
  if (!respuesta.ok) {
    const errorMsg =
      respuesta.status === 429 && !datos?.error
        ? 'Demasiados intentos. Espera un minuto e inténtalo de nuevo'
        : datos?.error || `Error ${respuesta.status}`
    throw new ErrorApi(errorMsg, respuesta.status, retryAfter)
  }
  return datos
}

/**
 * POST /api/auth/login. Devuelve { usuario, token }.
 *
 * Sin token: es la unica llamada que no lo lleva, y la contrasena solo viaja en
 * este cuerpo; no se guarda en ningun sitio.
 */
export function login(email, password) {
  return pedir('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * GET /api/kds/comandas. Devuelve los tres estados del tablero: 'recibido',
 * 'en_preparacion' y 'listo', asi que la columna "Listas" sobrevive a una
 * recarga o a una reconexion.
 */
export async function obtenerComandas(token) {
  const datos = await pedir('/kds/comandas', { token })
  return datos?.comandas || []
}

/**
 * PATCH /api/kds/comandas/:id/estado — avanza la comanda COMPLETA.
 *
 * El backend solo acepta 'en_preparacion' y 'listo'; la transicion concreta la
 * valida un trigger de la base, que puede rechazarla (409 con su mensaje). Por
 * eso el error se devuelve tal cual: es texto escrito para que lo lea el
 * cocinero, no un codigo interno.
 */
export function cambiarEstadoComanda(token, idPedido, estado) {
  return pedir(`/kds/comandas/${idPedido}/estado`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ estado }),
  })
}

/**
 * GET /api/menu — la carta completa, de donde salen los ingredientes del panel
 * de agotados (D-10).
 *
 * SIN token: es publica (api-spec.md), porque el comensal carga la carta antes
 * de tener sesion de mesa. Es tambien la UNICA fuente que el rol `cocina` puede
 * leer: GET /platos/:id/pasos es de admin, cajero y mesero.
 */
export function obtenerMenu() {
  return pedir('/menu')
}

/**
 * PATCH /api/ingredientes/:id/disponible — agotar o reponer (D-05).
 *
 * Es la unica escritura del constructor que puede hacer `cocina`. Devuelve el
 * ingrediente actualizado; el error llega tal cual lo manda el backend, que es
 * texto escrito para leerse.
 */
export function cambiarDisponibilidadIngrediente(token, idIngrediente, disponible) {
  return pedir(`/ingredientes/${idIngrediente}/disponible`, {
    token,
    method: 'PATCH',
    body: JSON.stringify({ disponible }),
  })
}
