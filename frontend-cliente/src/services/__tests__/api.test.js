import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pedirJson,
  setManejadorSesionInvalida,
  ErrorApi,
} from '../api';
import { accionErrorQuitar } from '../../utils/seguimiento';

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

  it('debe conservar motivo y faltantes en ErrorApi ante 409 sin_stock y 503 reintentar', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: 'Sin stock suficiente',
        motivo: 'sin_stock',
        faltantes: [{ tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' }],
      }),
    });

    await expect(
      pedirJson('/pedidos', { method: 'POST', body: { items: [] } })
    ).rejects.toMatchObject({
      status: 409,
      motivo: 'sin_stock',
      faltantes: [{ tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' }],
    });

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: 'intenta de nuevo',
        motivo: 'reintentar',
      }),
    });

    await expect(
      pedirJson('/pedidos', { method: 'POST', body: { items: [] } })
    ).rejects.toMatchObject({
      status: 503,
      motivo: 'reintentar',
    });
  });

  it('debe conservar detalle en ErrorApi ante 409 pago_en_curso y permitir a accionErrorQuitar mostrar el mensaje correcto', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: 'No se pudo verificar el pago en curso',
        motivo: 'pago_en_curso',
        detalle: 'sin_verificar',
      }),
    });

    let errorConDetalle = null;
    try {
      await pedirJson('/pedidos/123/items/456/cancelar', { method: 'POST' });
    } catch (err) {
      errorConDetalle = err;
    }

    expect(errorConDetalle).toBeInstanceOf(ErrorApi);
    expect(errorConDetalle.detalle).toBe('sin_verificar');
    expect(accionErrorQuitar(errorConDetalle).mensaje).toBe(
      'No se pudo comprobar el pago; espera unos segundos e inténtalo otra vez.'
    );

    // Caso sin detalle
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error: 'Hay un pago en curso en la mesa',
        motivo: 'pago_en_curso',
      }),
    });

    let errorSinDetalle = null;
    try {
      await pedirJson('/pedidos/123/items/456/cancelar', { method: 'POST' });
    } catch (err) {
      errorSinDetalle = err;
    }

    expect(errorSinDetalle).toBeInstanceOf(ErrorApi);
    expect(errorSinDetalle.detalle).toBeNull();
    expect(accionErrorQuitar(errorSinDetalle).mensaje).toBe(
      'Alguien de la mesa está pagando en línea; espera a que termine e inténtalo otra vez.'
    );
  });
});
