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

  /**
   * Rota el QR de una mesa en curso: POST /api/mesas/:id/rotar-qr
   */
  async rotarQr(id) {
    return apiFetch(`/mesas/${id}/rotar-qr`, {
      method: 'POST',
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
    return apiFetch('/transacciones', {
      method: 'POST',
      body: JSON.stringify(datos),
    })
  },

  /**
   * Obtiene las transacciones registradas para un pedido: GET /api/transacciones/pedido/:id_pedido
   */
  async obtenerPorPedido(idPedido) {
    return apiFetch(`/transacciones/pedido/${idPedido}`)
  },
}

