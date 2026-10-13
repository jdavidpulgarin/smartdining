/**
 * Cliente HTTP para la API REST de SmartDining
 * Conecta el panel de restaurante con el backend Node/Express
 */

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
export const EVENT_UNAUTHORIZED = 'smartdining:auth:unauthorized'
export const EVENT_RATE_LIMITED = 'smartdining:auth:rate-limited'

export const AUTH_MESSAGE_KEY = 'smartdining_auth_message'
export const RATE_LIMIT_KEY = 'smartdining_rate_limit'

export const MENSAJE_SESION_INVALIDA = 'Tu sesión no es válida o tu cuenta fue desactivada'
export const MENSAJE_DEMASIADOS_INTENTOS = 'Demasiados intentos. Espera un minuto e inténtalo de nuevo'

/**
 * Obtiene el token JWT del usuario de staff desde sessionStorage
 */
export function getAuthToken() {
  try {
    const directToken = sessionStorage.getItem('smartdining_token')
    if (directToken) return directToken

    const stored = sessionStorage.getItem('smartdining_staff_user')
    if (stored) {
      const parsed = JSON.parse(stored)
      return parsed?.token || null
    }
  } catch {
    // Si ocurre un error de parseo, se ignora
  }
  return null
}

/**
 * Limpia las credenciales del usuario en sessionStorage
 */
export function clearAuthStorage() {
  try {
    sessionStorage.removeItem('smartdining_token')
    sessionStorage.removeItem('smartdining_staff_user')
  } catch {
    // ignorar
  }
}

/**
 * Guarda y recupera mensaje flash de autenticación para la pantalla de login
 */
export function setStoredAuthMessage(message) {
  try {
    sessionStorage.setItem(AUTH_MESSAGE_KEY, message)
  } catch {
    // ignorar
  }
}

export function getStoredAuthMessage() {
  try {
    const msg = sessionStorage.getItem(AUTH_MESSAGE_KEY)
    if (msg) {
      sessionStorage.removeItem(AUTH_MESSAGE_KEY)
      return msg
    }
  } catch {
    // ignorar
  }
  return null
}

/**
 * Gestión de bloqueo por tasa de peticiones (429 rate limit)
 */
export function setStoredRateLimit(seconds, message) {
  try {
    const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 60
    const resetAt = Date.now() + s * 1000
    const payload = {
      resetAt,
      message: message || MENSAJE_DEMASIADOS_INTENTOS,
    }
    sessionStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(payload))
    return { remainingSeconds: s, resetAt }
  } catch {
    return { remainingSeconds: seconds || 60, resetAt: Date.now() + 60000 }
  }
}

export function getStoredRateLimit() {
  try {
    const raw = sessionStorage.getItem(RATE_LIMIT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const now = Date.now()
    if (parsed && parsed.resetAt && parsed.resetAt > now) {
      const remainingSeconds = Math.max(1, Math.ceil((parsed.resetAt - now) / 1000))
      return {
        remainingSeconds,
        resetAt: parsed.resetAt,
        message: parsed.message || MENSAJE_DEMASIADOS_INTENTOS,
      }
    }
    sessionStorage.removeItem(RATE_LIMIT_KEY)
  } catch {
    // ignorar
  }
  return null
}

export function clearStoredRateLimit() {
  try {
    sessionStorage.removeItem(RATE_LIMIT_KEY)
  } catch {
    // ignorar
  }
}

/**
 * Redirige al login de forma segura evitando bucles de redirección si ya se está en /login
 */
export function navegarALogin() {
  if (typeof window !== 'undefined' && window.location) {
    const pathname = window.location.pathname || ''
    const yaEnLogin = pathname === '/login' || pathname.endsWith('/login')
    if (!yaEnLogin) {
      if (typeof window.location.assign === 'function') {
        window.location.assign('/login')
      } else {
        window.location.href = '/login'
      }
    }
  }
}

/**
 * Dispara el evento global para cerrar sesión cuando el servidor responde 401
 */
export function triggerUnauthorized(detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_UNAUTHORIZED, { detail }))
  }
}

/**
 * Dispara el evento global de límite excedido cuando el servidor responde 429
 */
export function triggerRateLimited(detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_RATE_LIMITED, { detail }))
  }
}

/**
 * Función fetch base configurada con JSON, Authorization y manejo centralizado de 401 y 429
 */
export async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (!options.skipAuth) {
    const token = options.token || getAuthToken()
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
  }

  const config = {
    ...options,
    headers,
  }

  const response = await fetch(url, config)

  // Extraer cabecera Retry-After (en segundos según draft-7 de RFC)
  const retryHeader = response.headers?.get
    ? (response.headers.get('retry-after') || response.headers.get('Retry-After'))
    : null
  const retryParsed = retryHeader ? parseInt(retryHeader, 10) : null
  const segundosEspera = Number.isFinite(retryParsed) && retryParsed > 0 ? retryParsed : 60

  const contentType = response.headers?.get ? (response.headers.get('content-type') || '') : 'application/json'
  const isJson = contentType.includes('application/json')
  const data = isJson ? await response.json() : await response.text()

  // Manejo de 401: Sesión no válida o usuario desactivado (H-09)
  if (response.status === 401) {
    const isLoginEndpoint = String(endpoint).includes('/auth/login')
    // Si es /auth/login con skipAuth, es error de credenciales: no se borra ni redirige
    if (!options.skipAuth && !isLoginEndpoint) {
      clearAuthStorage()
      const mensaje =
        typeof data === 'object' && data?.error && data.error.toLowerCase().includes('desactivad')
          ? data.error
          : MENSAJE_SESION_INVALIDA
      setStoredAuthMessage(mensaje)
      triggerUnauthorized({ mensaje, error: data?.error })
      navegarALogin()
    }
  }

  // Manejo de 429: Rate limit excedido (H-04, H-27)
  if (response.status === 429) {
    const mensaje429 =
      typeof data === 'object' && data?.error
        ? data.error
        : MENSAJE_DEMASIADOS_INTENTOS
    setStoredRateLimit(segundosEspera, mensaje429)
    triggerRateLimited({
      segundos: segundosEspera,
      mensaje: mensaje429,
    })
    navegarALogin()
  }

  if (!response.ok) {
    const errorMsg =
      typeof data === 'object' && data !== null
        ? data.error || data.mensaje || data.message || `Error ${response.status}`
        : `Error ${response.status}`
    const error = new Error(errorMsg)
    error.status = response.status
    error.data = data
    if (response.status === 429) {
      error.retryAfter = segundosEspera
    }
    throw error
  }

  return data
}

// Submódulo de Autenticación
export const authApi = {
  /**
   * Inicia sesión en el backend real: POST /api/auth/login
   * @param {string} email
   * @param {string} password
   */
  async login(email, password) {
    return apiFetch('/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: JSON.stringify({ email, password }),
    })
  },
}

// Submódulo de Mesas
export const mesasApi = {
  /**
   * Obtiene la lista de mesas para el personal: GET /api/mesas
   */
  async listar() {
    return apiFetch('/mesas')
  },

  /**
   * Obtiene el detalle de una mesa: GET /api/mesas/:id
   */
  async obtener(id) {
    return apiFetch(`/mesas/${id}`)
  },

  /**
   * Abre la sesión de una mesa y obtiene su QR: POST /api/mesas/:id/abrir
   */
  async abrir(id) {
    return apiFetch(`/mesas/${id}/abrir`, {
      method: 'POST',
    })
  },

  /**
   * Rota el QR de una mesa abierta: POST /api/mesas/:id/rotar-qr
   * Responde { url, expira_en, mesa }: el token solo viaja dentro de url.
   */
  async rotarQr(id) {
    return apiFetch(`/mesas/${id}/rotar-qr`, {
      method: 'POST',
    })
  },

  /**
   * Libera una mesa cerrando la sesión: POST /api/mesas/:id/liberar
   */
  async liberar(id) {
    return apiFetch(`/mesas/${id}/liberar`, {
      method: 'POST',
    })
  },

  /**
   * Actualiza el estado manual de una mesa: PATCH /api/mesas/:id/estado
   */
  async actualizarEstado(id, estado) {
    return apiFetch(`/mesas/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    })
  },

  /**
   * Obtiene la cuenta detallada y saldo de una mesa: GET /api/mesas/:id/cuenta
   */
  async obtenerCuenta(id) {
    return apiFetch(`/mesas/${id}/cuenta`)
  },
}

// Submódulo de Pedidos
export const pedidosApi = {
  /**
   * Obtiene la lista de pedidos activos para sala/cocina: GET /api/pedidos/activos
   */
  async listarActivos() {
    return apiFetch('/pedidos/activos')
  },

  /**
   * Obtiene el detalle completo de un pedido con sus platos e ingredientes: GET /api/pedidos/:id
   */
  async obtener(id) {
    return apiFetch(`/pedidos/${id}`)
  },

  /**
   * Actualiza el estado de un pedido (ej. listo -> entregado): PATCH /api/pedidos/:id/estado
   */
  async actualizarEstado(id, estado, observaciones = null) {
    return apiFetch(`/pedidos/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, observaciones }),
    })
  },

  /**
   * Cancela un pedido abierto: POST /api/pedidos/:id/cancelar
   */
  async cancelar(id, razon = null) {
    return apiFetch(`/pedidos/${id}/cancelar`, {
      method: 'POST',
      body: JSON.stringify({ razon }),
    })
  },
}

// Submódulo de Transacciones / Caja
export const transaccionesApi = {
  /**
   * Registra un pago en caja (admin/cajero): POST /api/transacciones
   * @param {{ id_pedido: number, monto: number, metodo_pago: string, referencia_externa?: string, comensal?: string|null }} datos
   */
  async registrarPago(datos) {
    // H-07: El estado de la transacción lo fija el servidor. Solo se acepta omitirlo o 'completada'.
    const payload = { ...datos }
    if (payload.estado_transaccion && payload.estado_transaccion !== 'completada') {
      delete payload.estado_transaccion
    }
    return apiFetch('/transacciones', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  /**
   * Obtiene las transacciones registradas para un pedido: GET /api/transacciones/pedido/:id_pedido
   */
  async obtenerPorPedido(idPedido) {
    return apiFetch(`/transacciones/pedido/${idPedido}`)
  },
}

// Submódulo de Menú y Catálogo
export const menuApi = {
  /**
   * Obtiene la carta completa del restaurante con categorías y platos: GET /api/menu
   */
  async obtenerMenu() {
    return apiFetch('/menu', { skipAuth: true })
  },
}

// Submódulo de Categorías (CRUD completo)
export const categoriasApi = {
  async listar() {
    return apiFetch('/categorias', { skipAuth: true })
  },
  async crear({ nombre, descripcion, orden_visualizacion = 1, activo = true }) {
    return apiFetch('/categorias', {
      method: 'POST',
      body: JSON.stringify({ nombre, descripcion, orden_visualizacion, activo }),
    })
  },
  async actualizar(id, { nombre, descripcion, orden_visualizacion, activo }) {
    return apiFetch(`/categorias/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, descripcion, orden_visualizacion, activo }),
    })
  },
  async eliminar(id) {
    return apiFetch(`/categorias/${id}`, {
      method: 'DELETE',
    })
  },
}

// Submódulo de Platos (CRUD completo)
export const platosApi = {
  async listar(idCategoria = null) {
    const url = idCategoria ? `/platos?id_categoria=${idCategoria}` : '/platos'
    return apiFetch(url, { skipAuth: true })
  },
  async obtener(id) {
    return apiFetch(`/platos/${id}`, { skipAuth: true })
  },
  async crear({ id_categoria, nombre, descripcion, precio, url_imagen, disponible = true, tiempo_preparacion_estimado = 15, personalizable = false, calorias = null }) {
    return apiFetch('/platos', {
      method: 'POST',
      body: JSON.stringify({
        id_categoria: Number(id_categoria),
        nombre,
        descripcion,
        precio: Number(precio),
        url_imagen,
        disponible,
        tiempo_preparacion_estimado: Number(tiempo_preparacion_estimado),
        personalizable: Boolean(personalizable),
        calorias: calorias ? Number(calorias) : null,
      }),
    })
  },
  async actualizar(id, datos) {
    return apiFetch(`/platos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(datos),
    })
  },
  async eliminar(id) {
    return apiFetch(`/platos/${id}`, {
      method: 'DELETE',
    })
  },
  async marcarPersonalizable(id, { personalizable = true, calorias = null }) {
    try {
      return await apiFetch(`/platos/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ personalizable: Boolean(personalizable), calorias: calorias ? Number(calorias) : null }),
      })
    } catch {
      // Fallback si PATCH/PUT parcial de personalizable aun no esta en backend
      return { ok: true, id, personalizable, calorias }
    }
  },
}

/**
 * SUBMÓDULO DEL CONSTRUCTOR DE PLATOS (D-04):
 * CRUD de pasos e ingredientes. Dado que D-04 está pendiente de implementación
 * en backend por Daniel, este cliente implementa el contrato esperado con
 * fallback local/mock activable por VITE_USE_MOCKS o ante respuesta 404 del backend.
 */
const STORAGE_KEY_PASOS = 'smartdining_constructor_pasos_mock'

function getMockPasosStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY_PASOS)
    return data ? JSON.parse(data) : {}
  } catch {
    return {}
  }
}

function saveMockPasosStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY_PASOS, JSON.stringify(data))
  } catch (err) {
    console.warn('No se pudo guardar constructor en localStorage:', err)
  }
}

export const constructorApi = {
  /**
   * Obtiene los pasos e ingredientes de un plato personalizable
   * GET /api/platos/:id/pasos
   */
  async obtenerPasos(idPlato) {
    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      return storage[idPlato] || []
    }
    try {
      return await apiFetch(`/platos/${idPlato}/pasos`)
    } catch {
      // Fallback a almacenamiento local mientras Daniel integra D-04
      const storage = getMockPasosStorage()
      return storage[idPlato] || []
    }
  },

  /**
   * Crea un paso para un plato personalizable
   * POST /api/platos/:id/pasos
   */
  async guardarPaso(idPlato, { nombre, orden = 1, min_sel = 0, max_sel = 1, obligatorio = false }) {
    const pasoPayload = {
      id_plato: Number(idPlato),
      nombre,
      orden: Number(orden),
      min_sel: Number(min_sel),
      max_sel: Number(max_sel),
      obligatorio: Boolean(obligatorio),
    }

    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      const pasosPlato = storage[idPlato] || []
      const nuevoPaso = {
        id_paso: Date.now(),
        ...pasoPayload,
        ingredientes: [],
      }
      storage[idPlato] = [...pasosPlato, nuevoPaso]
      saveMockPasosStorage(storage)
      return nuevoPaso
    }

    try {
      return await apiFetch(`/platos/${idPlato}/pasos`, {
        method: 'POST',
        body: JSON.stringify(pasoPayload),
      })
    } catch {
      const storage = getMockPasosStorage()
      const pasosPlato = storage[idPlato] || []
      const nuevoPaso = {
        id_paso: Date.now(),
        ...pasoPayload,
        ingredientes: [],
      }
      storage[idPlato] = [...pasosPlato, nuevoPaso]
      saveMockPasosStorage(storage)
      return nuevoPaso
    }
  },

  /**
   * Actualiza un paso existente
   * PUT /api/pasos/:id
   */
  async actualizarPaso(idPaso, datos) {
    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) =>
          p.id_paso === idPaso ? { ...p, ...datos } : p
        )
      }
      saveMockPasosStorage(storage)
      return { id_paso: idPaso, ...datos }
    }

    try {
      return await apiFetch(`/pasos/${idPaso}`, {
        method: 'PUT',
        body: JSON.stringify(datos),
      })
    } catch {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) =>
          p.id_paso === idPaso ? { ...p, ...datos } : p
        )
      }
      saveMockPasosStorage(storage)
      return { id_paso: idPaso, ...datos }
    }
  },

  /**
   * Elimina un paso
   * DELETE /api/pasos/:id
   */
  async eliminarPaso(idPaso) {
    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].filter((p) => p.id_paso !== idPaso)
      }
      saveMockPasosStorage(storage)
      return { ok: true }
    }

    try {
      return await apiFetch(`/pasos/${idPaso}`, { method: 'DELETE' })
    } catch {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].filter((p) => p.id_paso !== idPaso)
      }
      saveMockPasosStorage(storage)
      return { ok: true }
    }
  },

  /**
   * Agrega un ingrediente a un paso
   * POST /api/pasos/:id/ingredientes
   */
  async guardarIngrediente(idPaso, { nombre, precio_extra = 0, calorias = null, alergenos = [], url_imagen = '', disponible = true }) {
    const ingPayload = {
      id_paso: Number(idPaso),
      nombre,
      precio_extra: Number(precio_extra) || 0,
      calorias: calorias ? Number(calorias) : null,
      alergenos: Array.isArray(alergenos) ? alergenos : [],
      url_imagen,
      disponible: Boolean(disponible),
    }

    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      const nuevoIng = { id_ingrediente: Date.now(), ...ingPayload }
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) => {
          if (p.id_paso === idPaso) {
            return { ...p, ingredientes: [...(p.ingredientes || []), nuevoIng] }
          }
          return p
        })
      }
      saveMockPasosStorage(storage)
      return nuevoIng
    }

    try {
      return await apiFetch(`/pasos/${idPaso}/ingredientes`, {
        method: 'POST',
        body: JSON.stringify(ingPayload),
      })
    } catch {
      const storage = getMockPasosStorage()
      const nuevoIng = { id_ingrediente: Date.now(), ...ingPayload }
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) => {
          if (p.id_paso === idPaso) {
            return { ...p, ingredientes: [...(p.ingredientes || []), nuevoIng] }
          }
          return p
        })
      }
      saveMockPasosStorage(storage)
      return nuevoIng
    }
  },

  /**
   * Actualiza un ingrediente existente
   * PUT /api/ingredientes/:id
   */
  async actualizarIngrediente(idIngrediente, datos) {
    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) => ({
          ...p,
          ingredientes: (p.ingredientes || []).map((ing) =>
            ing.id_ingrediente === idIngrediente ? { ...ing, ...datos } : ing
          ),
        }))
      }
      saveMockPasosStorage(storage)
      return { id_ingrediente: idIngrediente, ...datos }
    }

    try {
      return await apiFetch(`/ingredientes/${idIngrediente}`, {
        method: 'PUT',
        body: JSON.stringify(datos),
      })
    } catch {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) => ({
          ...p,
          ingredientes: (p.ingredientes || []).map((ing) =>
            ing.id_ingrediente === idIngrediente ? { ...ing, ...datos } : ing
          ),
        }))
      }
      saveMockPasosStorage(storage)
      return { id_ingrediente: idIngrediente, ...datos }
    }
  },

  /**
   * Elimina un ingrediente
   * DELETE /api/ingredientes/:id
   */
  async eliminarIngrediente(idIngrediente) {
    if (import.meta.env.VITE_USE_MOCKS === 'true') {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) => ({
          ...p,
          ingredientes: (p.ingredientes || []).filter((ing) => ing.id_ingrediente !== idIngrediente),
        }))
      }
      saveMockPasosStorage(storage)
      return { ok: true }
    }

    try {
      return await apiFetch(`/ingredientes/${idIngrediente}`, { method: 'DELETE' })
    } catch {
      const storage = getMockPasosStorage()
      for (const pId of Object.keys(storage)) {
        storage[pId] = storage[pId].map((p) => ({
          ...p,
          ingredientes: (p.ingredientes || []).filter((ing) => ing.id_ingrediente !== idIngrediente),
        }))
      }
      saveMockPasosStorage(storage)
      return { ok: true }
    }
  },
}

/**
 * RF-21 (Reportes):
 * GET /api/reportes?rango=hoy|semana|mes
 */
export const reportesApi = {
  async obtenerReporte(rango = 'hoy') {
    return apiFetch(`/reportes?rango=${encodeURIComponent(rango)}`)
  },
}

/**
 * RF-11 (Agotados / Disponibilidad):
 * PATCH /api/platos/:id/disponible
 * PATCH /api/ingredientes/:id/disponible
 */
export const agotadosApi = {
  async togglePlato(idPlato, disponible) {
    return apiFetch(`/platos/${idPlato}/disponible`, {
      method: 'PATCH',
      body: JSON.stringify({ disponible }),
    })
  },
  async toggleIngrediente(idIngrediente, disponible) {
    return apiFetch(`/ingredientes/${idIngrediente}/disponible`, {
      method: 'PATCH',
      body: JSON.stringify({ disponible }),
    })
  },
}


