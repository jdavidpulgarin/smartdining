/**
 * Cliente HTTP para la API REST de SmartDining
 * Conecta el panel de restaurante con el backend Node/Express
 */

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
export const EVENT_UNAUTHORIZED = 'smartdining:auth:unauthorized'

/**
 * Obtiene el token JWT del usuario de staff desde localStorage
 */
export function getAuthToken() {
  try {
    const stored = localStorage.getItem('smartdining_staff_user')
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
 * Dispara el evento global para cerrar sesión cuando el servidor responde 401
 */
export function triggerUnauthorized() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_UNAUTHORIZED))
  }
}

/**
 * Función fetch base configurada con JSON, Authorization y manejo de 401
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

  if (response.status === 401) {
    triggerUnauthorized()
  }

  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')
  const data = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const errorMsg =
      typeof data === 'object' && data !== null
        ? data.error || data.mensaje || data.message || `Error ${response.status}`
        : `Error ${response.status}`
    const error = new Error(errorMsg)
    error.status = response.status
    error.data = data
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
}
