import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  apiFetch,
  getStoredAuthMessage,
  setStoredAuthMessage,
  getStoredRateLimit,
  setStoredRateLimit,
  clearStoredRateLimit,
  navegarALogin,
  EVENT_UNAUTHORIZED,
  EVENT_RATE_LIMITED,
} from '../api'

describe('Interceptor y cliente HTTP (apiFetch)', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    delete window.location
    window.location = {
      pathname: '/mesas',
      href: 'http://localhost:5174/mesas',
      assign: vi.fn(),
    }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  describe('Manejo de 401 (Sesión inválida / Usuario desactivado - H-09)', () => {
    it('debe borrar sesión, guardar mensaje flash, despachar evento y redirigir a /login', async () => {
      sessionStorage.setItem('smartdining_token', 'token-antiguo')
      sessionStorage.setItem(
        'smartdining_staff_user',
        JSON.stringify({ token: 'token-antiguo', nombre: 'Mesero' })
      )

      const unauthListener = vi.fn()
      window.addEventListener(EVENT_UNAUTHORIZED, unauthListener)

      const mockResponse = {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Tu cuenta está desactivada, habla con administración' }),
      }
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

      await expect(apiFetch('/mesas')).rejects.toThrow()

      // 1. Debe haber borrado token y sesión de staff
      expect(sessionStorage.getItem('smartdining_token')).toBeNull()
      expect(sessionStorage.getItem('smartdining_staff_user')).toBeNull()

      // 2. Debe haber guardado el mensaje para la pantalla de login
      const storedMsg = getStoredAuthMessage()
      expect(storedMsg).toContain('desactivada')

      // 3. Debe despachar evento EVENT_UNAUTHORIZED
      expect(unauthListener).toHaveBeenCalledTimes(1)

      // 4. Debe redirigir al login
      expect(window.location.assign).toHaveBeenCalledWith('/login')

      window.removeEventListener(EVENT_UNAUTHORIZED, unauthListener)
    })

    it('no debe generar bucle de redirección si ya se encuentra en /login', async () => {
      window.location.pathname = '/login'

      const mockResponse = {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Token inválido o expirado' }),
      }
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

      await expect(apiFetch('/mesas')).rejects.toThrow()

      // No debe volver a invocar assign('/login')
      expect(window.location.assign).not.toHaveBeenCalled()
    })

    it('no debe limpiar sesión ni forzar redirección en intento de login fallido (/auth/login)', async () => {
      window.location.pathname = '/login'

      const unauthListener = vi.fn()
      window.addEventListener(EVENT_UNAUTHORIZED, unauthListener)

      const mockResponse = {
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Credenciales inválidas' }),
      }
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

      await expect(
        apiFetch('/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ email: 'test@smartdining.com', password: 'bad' }),
        })
      ).rejects.toThrow('Credenciales inválidas')

      expect(unauthListener).not.toHaveBeenCalled()
      expect(window.location.assign).not.toHaveBeenCalled()

      window.removeEventListener(EVENT_UNAUTHORIZED, unauthListener)
    })
  })

  describe('Manejo de 429 (Límite de intentos excedido - H-04, H-27)', () => {
    it('debe registrar bloqueo, despachar evento EVENT_RATE_LIMITED y adjuntar retryAfter por omisión (60s)', async () => {
      const rateLimitListener = vi.fn()
      window.addEventListener(EVENT_RATE_LIMITED, rateLimitListener)

      const mockResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          error: 'Demasiados intentos de inicio de sesión. Espera un momento y vuelve a intentarlo.',
        }),
      }
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

      let errorLanzado = null
      try {
        await apiFetch('/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ email: 'spam@smartdining.com', password: 'x' }),
        })
      } catch (err) {
        errorLanzado = err
      }

      expect(errorLanzado).not.toBeNull()
      expect(errorLanzado.status).toBe(429)
      expect(errorLanzado.retryAfter).toBe(60)

      // Debe haber guardado rate limit en sessionStorage
      const stored = getStoredRateLimit()
      expect(stored).not.toBeNull()
      expect(stored.remainingSeconds).toBeGreaterThanOrEqual(58)
      expect(stored.remainingSeconds).toBeLessThanOrEqual(60)

      // Evento global
      expect(rateLimitListener).toHaveBeenCalledTimes(1)
      expect(rateLimitListener.mock.calls[0][0].detail.segundos).toBe(60)

      window.removeEventListener(EVENT_RATE_LIMITED, rateLimitListener)
    })

    it('debe respetar el header Retry-After cuando el backend lo envía', async () => {
      const rateLimitListener = vi.fn()
      window.addEventListener(EVENT_RATE_LIMITED, rateLimitListener)

      const mockResponse = {
        ok: false,
        status: 429,
        headers: new Headers({
          'content-type': 'application/json',
          'retry-after': '42',
        }),
        json: async () => ({
          error: 'Demasiados intentos. Espera un momento.',
        }),
      }
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

      let errorLanzado = null
      try {
        await apiFetch('/auth/login', {
          method: 'POST',
          skipAuth: true,
          body: JSON.stringify({ email: 'spam@smartdining.com', password: 'x' }),
        })
      } catch (err) {
        errorLanzado = err
      }

      expect(errorLanzado).not.toBeNull()
      expect(errorLanzado.status).toBe(429)
      expect(errorLanzado.retryAfter).toBe(42)

      const stored = getStoredRateLimit()
      expect(stored.remainingSeconds).toBeGreaterThanOrEqual(40)
      expect(stored.remainingSeconds).toBeLessThanOrEqual(42)

      expect(rateLimitListener).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({ segundos: 42 }),
        })
      )

      window.removeEventListener(EVENT_RATE_LIMITED, rateLimitListener)
    })

    it('si ocurre 429 fuera de /login debe redirigir al login sin bucles', async () => {
      window.location.pathname = '/pedidos'

      const mockResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Demasiadas peticiones' }),
      }
      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

      await expect(apiFetch('/pedidos')).rejects.toThrow()
      expect(window.location.assign).toHaveBeenCalledWith('/login')

      // Ahora simular que ya está en /login y no debe volver a redirigir
      window.location.assign.mockClear()
      window.location.pathname = '/login'

      await expect(apiFetch('/pedidos')).rejects.toThrow()
      expect(window.location.assign).not.toHaveBeenCalled()
    })
  })

  describe('Funciones auxiliares de almacenamiento y navegación', () => {
    it('setStoredAuthMessage y getStoredAuthMessage recuperan y consumen el mensaje una sola vez', () => {
      setStoredAuthMessage('Sesión cerrada')
      expect(getStoredAuthMessage()).toBe('Sesión cerrada')
      // La segunda lectura debe devolver null (consumido)
      expect(getStoredAuthMessage()).toBeNull()
    })

    it('clearStoredRateLimit limpia el registro de bloqueo', () => {
      setStoredRateLimit(30, 'Espera')
      expect(getStoredRateLimit()).not.toBeNull()
      clearStoredRateLimit()
      expect(getStoredRateLimit()).toBeNull()
    })

    it('navegarALogin respeta pathname ya existente en /login', () => {
      window.location.pathname = '/login'
      navegarALogin()
      expect(window.location.assign).not.toHaveBeenCalled()

      window.location.pathname = '/home'
      navegarALogin()
      expect(window.location.assign).toHaveBeenCalledWith('/login')
    })
  })
})
