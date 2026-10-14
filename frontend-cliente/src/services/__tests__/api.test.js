import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pedirJson,
  setManejadorSesionInvalida,
  ErrorApi,
} from '../api';

describe('Interceptor HTTP en frontend-cliente (pedirJson)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setManejadorSesionInvalida(null);
  });

  it('debe manejar 401 disparando el manejador de sesion invalida cuando hay token', async () => {
    const manejadorMock = vi.fn();
    setManejadorSesionInvalida(manejadorMock);

    const mockResponse = {
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: 'Sesión de mesa cerrada, escanea el QR de nuevo',
        motivo: 'sesion_cerrada',
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

    let errorCapturado = null;
    try {
      await pedirJson('/pedidos', { token: 'jwt-comensal-expirado' });
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).toBeInstanceOf(ErrorApi);
    expect(errorCapturado.status).toBe(401);
    expect(errorCapturado.mensaje).toBe('Sesión de mesa cerrada, escanea el QR de nuevo');
    expect(manejadorMock).toHaveBeenCalledTimes(1);
    expect(manejadorMock).toHaveBeenCalledWith(
      'sesion_cerrada',
      'Sesión de mesa cerrada, escanea el QR de nuevo'
    );
  });

  it('debe capturar 429 con Retry-After y fijar retryAfter en ErrorApi', async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      headers: new Headers({
        'content-type': 'application/json',
        'retry-after': '45',
      }),
      json: async () => ({
        error: 'Demasiados intentos de abrir la sesión de la mesa. Espera un momento y vuelve a intentarlo.',
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

    let errorCapturado = null;
    try {
      await pedirJson('/mesas/qr/token123/sesion', {
        method: 'POST',
        body: { comensal: 'Carlos' },
      });
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).toBeInstanceOf(ErrorApi);
    expect(errorCapturado.status).toBe(429);
    expect(errorCapturado.retryAfter).toBe(45);
    expect(errorCapturado.mensaje).toContain('Demasiados intentos');
  });

  it('debe asignar 60s por defecto si 429 no incluye cabecera Retry-After', async () => {
    const mockResponse = {
      ok: false,
      status: 429,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

    let errorCapturado = null;
    try {
      await pedirJson('/mesas/qr/token123/sesion', {
        method: 'POST',
        body: { comensal: 'Carlos' },
      });
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).toBeInstanceOf(ErrorApi);
    expect(errorCapturado.status).toBe(429);
    expect(errorCapturado.retryAfter).toBe(60);
    expect(errorCapturado.mensaje).toBe('Demasiados intentos. Espera un minuto e inténtalo de nuevo');
  });
});
