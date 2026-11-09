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

  const timeoutMs = options.timeout !== undefined ? options.timeout : 10000
  let controller = null
  let timeoutId = null

  if (timeoutMs && timeoutMs > 0 && !options.signal) {
    controller = new AbortController()
    timeoutId = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
  }

  const config = {
    ...options,
    headers,
    signal: options.signal || (controller ? controller.signal : undefined),
  }

  let response
  try {
    response = await fetch(url, config)
  } catch (fetchErr) {
    // Si quien llama abortó con su propia señal, no es un problema de conexión.
    if (fetchErr.name === 'AbortError' && !(controller && controller.signal.aborted)) {
      throw fetchErr
    }
    // Sin respuesta del servidor (caído, sin red o tiempo agotado). Se marca con
    // sinConexion para que la pantalla diga "Sin conexión, no se guardó" y no
    // dé nada por guardado (P-13).
    const error = new Error(
      controller && controller.signal.aborted
        ? `Tiempo de espera agotado al conectar con el servidor (${(timeoutMs || 10000) / 1000}s)`
        : 'Sin conexión con el servidor'
    )
    error.sinConexion = true
    error.cause = fetchErr
    throw error
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

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
    if (typeof data === 'object' && data !== null) {
      if (data.motivo) error.motivo = data.motivo
      if (data.alias) error.alias = data.alias
      if (data.faltantes) error.faltantes = data.faltantes
    }
    if (response.status === 429) {
      error.retryAfter = segundosEspera
    }
    throw error
  }

  return data
}

export const MENSAJE_SIN_CONEXION_NO_GUARDADO = 'Sin conexión, no se guardó'

/**
 * Mensaje para una escritura que falló (guardar, borrar, agotar...). Si no hubo
 * respuesta del servidor, "Sin conexión, no se guardó"; si el servidor la
 * rechazó, su error real. Nunca da el cambio por guardado.
 */
export function mensajeNoGuardado(err) {
  if (err?.sinConexion) return MENSAJE_SIN_CONEXION_NO_GUARDADO
  return err?.message ? `No se guardó: ${err.message}` : 'No se guardó'
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
  async listar(options = {}) {
    return apiFetch('/mesas', options)
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

  /**
   * Registra a un comensal sin celular en la mesa: POST /api/mesas/:id/comensales
   */
  async registrarComensal(idMesa, alias) {
    return apiFetch(`/mesas/${idMesa}/comensales`, {
      method: 'POST',
      body: JSON.stringify({ alias }),
    })
  },
}

// Submódulo de Pedidos
export const pedidosApi = {
  /**
   * Crea un nuevo pedido / comanda: POST /api/pedidos
   */
  async crear(body) {
    return apiFetch('/pedidos', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  /**
   * Envía el pedido desde el panel (alias de crear): POST /api/pedidos
   */
  async enviarPedido(body) {
    return this.crear(body)
  },

  /**
   * Obtiene la lista de pedidos activos para sala/cocina: GET /api/pedidos/activos
   */
  async listarActivos(options = {}) {
    return apiFetch('/pedidos/activos', { timeout: 10000, ...options })
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
    // Sin respaldo: si el backend lo rechaza, el error sube a la pantalla.
    return apiFetch(`/platos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ personalizable: Boolean(personalizable), calorias: calorias ? Number(calorias) : null }),
    })
  },
}

/**
 * Constructor de platos (D-04): pasos e ingredientes de un plato personalizable.
 * Todo va contra el backend; si falla, el error sube a la pantalla (P-13). No
 * hay copia local: un cambio que no llegó al servidor no se muestra como hecho.
 */
export const constructorApi = {
  /** GET /api/platos/:id/pasos */
  async obtenerPasos(idPlato) {
    return apiFetch(`/platos/${idPlato}/pasos`)
  },

  /** POST /api/platos/:id/pasos */
  async guardarPaso(idPlato, { nombre, orden = 1, min_sel = 0, max_sel = 1, obligatorio = false }) {
    return apiFetch(`/platos/${idPlato}/pasos`, {
      method: 'POST',
      body: JSON.stringify({
        id_plato: Number(idPlato),
        nombre,
        orden: Number(orden),
        min_sel: Number(min_sel),
        max_sel: Number(max_sel),
        obligatorio: Boolean(obligatorio),
      }),
    })
  },

  /** PUT /api/pasos/:id */
  async actualizarPaso(idPaso, datos) {
    return apiFetch(`/pasos/${idPaso}`, {
      method: 'PUT',
      body: JSON.stringify(datos),
    })
  },

  /** DELETE /api/pasos/:id */
  async eliminarPaso(idPaso) {
    return apiFetch(`/pasos/${idPaso}`, { method: 'DELETE' })
  },

  /** POST /api/pasos/:id/ingredientes */
  async guardarIngrediente(idPaso, { nombre, precio_extra = 0, calorias = null, alergenos = [], url_imagen = '', disponible = true }) {
    return apiFetch(`/pasos/${idPaso}/ingredientes`, {
      method: 'POST',
      body: JSON.stringify({
        id_paso: Number(idPaso),
        nombre,
        precio_extra: Number(precio_extra) || 0,
        calorias: calorias ? Number(calorias) : null,
        alergenos: Array.isArray(alergenos) ? alergenos : [],
        url_imagen,
        disponible: Boolean(disponible),
      }),
    })
  },

  /** PUT /api/ingredientes/:id */
  async actualizarIngrediente(idIngrediente, datos) {
    return apiFetch(`/ingredientes/${idIngrediente}`, {
      method: 'PUT',
      body: JSON.stringify(datos),
    })
  },

  /** DELETE /api/ingredientes/:id */
  async eliminarIngrediente(idIngrediente) {
    return apiFetch(`/ingredientes/${idIngrediente}`, { method: 'DELETE' })
  },
}

/**
 * Datos de DEMOSTRACIÓN para Reportes. Solo se usan en desarrollo explícito
 * (usarMocks): nunca por un 404 ni por un fallo de red en producción.
 */
function generarReporteFallback(rango = 'hoy') {
  if (rango === 'semana') {
    return {
      isFallback: true,
      rango: 'semana',
      totalVentas: 8940000,
      totalPedidos: 242,
      pedidosLiquidados: 236,
      tiempoCocinaPromedio: 13.1,
      ocupacionMesas: 76,
      ticketPromedio: 36940,
      kdsAlertsCount: 8,
      topPlatos: [
        { id_plato: 1001, nombre: 'Hamburguesa Smart Angus', categoria: 'Hamburguesas', unidades: 114, total: 3876000, porcentaje: 95 },
        { id_plato: 1002, nombre: 'Bowl Personalizado', categoria: 'Arma tu plato', unidades: 86, total: 2408000, porcentaje: 75 },
        { id_plato: 1003, nombre: 'Pizza Margherita Smart', categoria: 'Pizzas', unidades: 72, total: 2304000, porcentaje: 60 },
        { id_plato: 1004, nombre: 'Papas Rústicas Trufadas', categoria: 'Acompañamientos', unidades: 65, total: 910000, porcentaje: 52 },
        { id_plato: 1005, nombre: 'Limonada de Coco', categoria: 'Bebidas', unidades: 58, total: 522000, porcentaje: 46 },
      ],
      metodosPago: [
        { metodo: 'Tarjeta', porcentaje: 54, monto: 4827600, color: '#10b981' },
        { metodo: 'Efectivo', porcentaje: 28, monto: 2503200, color: '#3b82f6' },
        { metodo: 'Transferencia', porcentaje: 18, monto: 1609200, color: '#a855f7' },
      ],
      horasPico: [
        { hora: '12:00 - 13:00', volumen: 70 },
        { hora: '13:00 - 14:00', volumen: 95 },
        { hora: '14:00 - 15:00', volumen: 55 },
        { hora: '19:00 - 20:00', volumen: 82 },
        { hora: '20:00 - 21:00', volumen: 90 },
      ],
      topIngredientes: [
        { id_ingrediente: 1, nombre_ingrediente: 'Carne Angus 150g', nombre_paso: 'Proteína Principal', nombre_plato: 'Bowl Personalizado', veces_solicitado: 142, porciones_extra: 34, porciones_normal: 108, ingresos_extras: 102000 },
        { id_ingrediente: 4, nombre_ingrediente: 'Queso Cheddar Fundido', nombre_paso: 'Queso y Salsas', nombre_plato: 'Bowl Personalizado', veces_solicitado: 118, porciones_extra: 28, porciones_normal: 90, ingresos_extras: 56000 },
        { id_ingrediente: 2, nombre_ingrediente: 'Pollo Crispy Apanado', nombre_paso: 'Proteína Principal', nombre_plato: 'Bowl Personalizado', veces_solicitado: 89, porciones_extra: 12, porciones_normal: 77, ingresos_extras: 30000 },
        { id_ingrediente: 7, nombre_ingrediente: 'Tocineta Ahumada Crispy', nombre_paso: 'Toppings & Crunch', nombre_plato: 'Bowl Personalizado', veces_solicitado: 84, porciones_extra: 42, porciones_normal: 42, ingresos_extras: 84000 },
        { id_ingrediente: 9, nombre_ingrediente: 'Aguacate Hass Laminado', nombre_paso: 'Vegetales & Frescura', nombre_plato: 'Bowl Personalizado', veces_solicitado: 76, porciones_extra: 22, porciones_normal: 54, ingresos_extras: 44000 },
      ],
      tiemposKds: [
        { fecha: 'Últimos 7 días', platos_preparados: 256, tiempo_estimado_promedio_min: 15.0, tiempo_real_promedio_min: 13.1, variacion_promedio_porcentaje: -12.7 },
        { fecha: 'Día Pico (Sábado)', platos_preparados: 68, tiempo_estimado_promedio_min: 15.0, tiempo_real_promedio_min: 14.2, variacion_promedio_porcentaje: -5.3 },
      ],
    }
  }

  if (rango === 'mes') {
    return {
      isFallback: true,
      rango: 'mes',
      totalVentas: 38420000,
      totalPedidos: 1045,
      pedidosLiquidados: 1022,
      tiempoCocinaPromedio: 13.5,
      ocupacionMesas: 81,
      ticketPromedio: 36760,
      kdsAlertsCount: 26,
      topPlatos: [
        { id_plato: 1001, nombre: 'Hamburguesa Smart Angus', categoria: 'Hamburguesas', unidades: 480, total: 16320000, porcentaje: 98 },
        { id_plato: 1002, nombre: 'Bowl Personalizado', categoria: 'Arma tu plato', unidades: 375, total: 10500000, porcentaje: 80 },
        { id_plato: 1003, nombre: 'Pizza Margherita Smart', categoria: 'Pizzas', unidades: 310, total: 9920000, porcentaje: 65 },
        { id_plato: 1004, nombre: 'Papas Rústicas Trufadas', categoria: 'Acompañamientos', unidades: 280, total: 3920000, porcentaje: 55 },
        { id_plato: 1005, nombre: 'Limonada de Coco', categoria: 'Bebidas', unidades: 250, total: 2250000, porcentaje: 48 },
      ],
      metodosPago: [
        { metodo: 'Tarjeta', porcentaje: 56, monto: 21515200, color: '#10b981' },
        { metodo: 'Efectivo', porcentaje: 26, monto: 9989200, color: '#3b82f6' },
        { metodo: 'Transferencia', porcentaje: 18, monto: 6915600, color: '#a855f7' },
      ],
      horasPico: [
        { hora: '12:00 - 13:00', volumen: 75 },
        { hora: '13:00 - 14:00', volumen: 96 },
        { hora: '14:00 - 15:00', volumen: 58 },
        { hora: '19:00 - 20:00', volumen: 85 },
        { hora: '20:00 - 21:00', volumen: 92 },
      ],
      topIngredientes: [
        { id_ingrediente: 1, nombre_ingrediente: 'Carne Angus 150g', nombre_paso: 'Proteína Principal', nombre_plato: 'Bowl Personalizado', veces_solicitado: 590, porciones_extra: 140, porciones_normal: 450, ingresos_extras: 420000 },
        { id_ingrediente: 4, nombre_ingrediente: 'Queso Cheddar Fundido', nombre_paso: 'Queso y Salsas', nombre_plato: 'Bowl Personalizado', veces_solicitado: 480, porciones_extra: 110, porciones_normal: 370, ingresos_extras: 220000 },
        { id_ingrediente: 2, nombre_ingrediente: 'Pollo Crispy Apanado', nombre_paso: 'Proteína Principal', nombre_plato: 'Bowl Personalizado', veces_solicitado: 380, porciones_extra: 50, porciones_normal: 330, ingresos_extras: 125000 },
        { id_ingrediente: 7, nombre_ingrediente: 'Tocineta Ahumada Crispy', nombre_paso: 'Toppings & Crunch', nombre_plato: 'Bowl Personalizado', veces_solicitado: 360, porciones_extra: 180, porciones_normal: 180, ingresos_extras: 360000 },
        { id_ingrediente: 9, nombre_ingrediente: 'Aguacate Hass Laminado', nombre_paso: 'Vegetales & Frescura', nombre_plato: 'Bowl Personalizado', veces_solicitado: 320, porciones_extra: 95, porciones_normal: 225, ingresos_extras: 190000 },
      ],
      tiemposKds: [
        { fecha: 'Mes Corriente', platos_preparados: 1120, tiempo_estimado_promedio_min: 15.0, tiempo_real_promedio_min: 13.5, variacion_promedio_porcentaje: -10.0 },
        { fecha: 'Mes Anterior', platos_preparados: 980, tiempo_estimado_promedio_min: 15.0, tiempo_real_promedio_min: 14.1, variacion_promedio_porcentaje: -6.0 },
      ],
    }
  }

  // Por defecto 'hoy'
  return {
    isFallback: true,
    rango: 'hoy',
    totalVentas: 1280000,
    totalPedidos: 34,
    pedidosLiquidados: 32,
    tiempoCocinaPromedio: 12.4,
    ocupacionMesas: 72,
    ticketPromedio: 37640,
    kdsAlertsCount: 2,
    topPlatos: [
      { id_plato: 1001, nombre: 'Hamburguesa Smart Angus', categoria: 'Hamburguesas', unidades: 18, total: 612000, porcentaje: 90 },
      { id_plato: 1002, nombre: 'Bowl Personalizado', categoria: 'Arma tu plato', unidades: 14, total: 392000, porcentaje: 70 },
      { id_plato: 1003, nombre: 'Pizza Margherita Smart', categoria: 'Pizzas', unidades: 11, total: 352000, porcentaje: 55 },
      { id_plato: 1004, nombre: 'Papas Rústicas Trufadas', categoria: 'Acompañamientos', unidades: 10, total: 140000, porcentaje: 50 },
      { id_plato: 1005, nombre: 'Limonada de Coco', categoria: 'Bebidas', unidades: 9, total: 81000, porcentaje: 45 },
    ],
    metodosPago: [
      { metodo: 'Tarjeta', porcentaje: 52, monto: 665600, color: '#10b981' },
      { metodo: 'Efectivo', porcentaje: 30, monto: 384000, color: '#3b82f6' },
      { metodo: 'Transferencia', porcentaje: 18, monto: 230400, color: '#a855f7' },
    ],
    horasPico: [
      { hora: '12:00 - 13:00', volumen: 65 },
      { hora: '13:00 - 14:00', volumen: 92 },
      { hora: '14:00 - 15:00', volumen: 48 },
      { hora: '19:00 - 20:00', volumen: 78 },
      { hora: '20:00 - 21:00', volumen: 85 },
    ],
    topIngredientes: [
      { id_ingrediente: 1, nombre_ingrediente: 'Carne Angus 150g', nombre_paso: 'Proteína Principal', nombre_plato: 'Bowl Personalizado', veces_solicitado: 28, porciones_extra: 6, porciones_normal: 22, ingresos_extras: 18000 },
      { id_ingrediente: 4, nombre_ingrediente: 'Queso Cheddar Fundido', nombre_paso: 'Queso y Salsas', nombre_plato: 'Bowl Personalizado', veces_solicitado: 24, porciones_extra: 5, porciones_normal: 19, ingresos_extras: 10000 },
      { id_ingrediente: 2, nombre_ingrediente: 'Pollo Crispy Apanado', nombre_paso: 'Proteína Principal', nombre_plato: 'Bowl Personalizado', veces_solicitado: 19, porciones_extra: 3, porciones_normal: 16, ingresos_extras: 7000 },
      { id_ingrediente: 7, nombre_ingrediente: 'Tocineta Ahumada Crispy', nombre_paso: 'Toppings & Crunch', nombre_plato: 'Bowl Personalizado', veces_solicitado: 16, porciones_extra: 8, porciones_normal: 8, ingresos_extras: 16000 },
      { id_ingrediente: 9, nombre_ingrediente: 'Aguacate Hass Laminado', nombre_paso: 'Vegetales & Frescura', nombre_plato: 'Bowl Personalizado', veces_solicitado: 15, porciones_extra: 4, porciones_normal: 11, ingresos_extras: 8000 },
    ],
    tiemposKds: [
      { fecha: 'Hoy (Servicio Activo)', platos_preparados: 38, tiempo_estimado_promedio_min: 15.0, tiempo_real_promedio_min: 12.4, variacion_promedio_porcentaje: -17.3 },
      { fecha: 'Ayer', platos_preparados: 42, tiempo_estimado_promedio_min: 15.0, tiempo_real_promedio_min: 13.0, variacion_promedio_porcentaje: -13.3 },
    ],
  }
}

/**
 * Mocks SOLO en desarrollo explícito: `npm run dev` con VITE_USE_MOCKS=true.
 * En un build de producción import.meta.env.DEV es false y esto nunca aplica.
 */
export function usarMocks(env = import.meta.env) {
  return Boolean(env?.DEV) && env?.VITE_USE_MOCKS === 'true'
}

export const reportesApi = {
  /**
   * Métricas del restaurante: GET /api/reportes?rango=hoy|semana|mes (admin).
   * Si falla, el error sube a la pantalla: no se inventan cifras (P-13).
   */
  async obtenerReporte(rango = 'hoy') {
    if (usarMocks()) return generarReporteFallback(rango)
    const data = await apiFetch(`/reportes?rango=${encodeURIComponent(rango)}`)
    return { ...data, isFallback: false }
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

/**
 * Funciones de conveniencia para la toma de pedidos del personal (J-16)
 */
export async function registrarComensal(idMesa, alias) {
  return mesasApi.registrarComensal(idMesa, alias)
}

export async function enviarPedido(body) {
  return pedidosApi.enviarPedido(body)
}

export async function obtenerCuenta(idMesa) {
  return mesasApi.obtenerCuenta(idMesa)
}



