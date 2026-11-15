import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearIntencion } from './pagoService';

describe('pagoService - crearIntencion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_MODO_SIMULADO', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('409 con codigo PAGO_EN_REVISION conserva codigo y tipo en ErrorApi', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: false,
        codigo: 'PAGO_EN_REVISION',
        mensaje: 'Tu pago anterior se está confirmando…',
      }),
    });

    let errorCapturado = null;
    try {
      await crearIntencion('propio', 'evt-123');
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).not.toBeNull();
    expect(errorCapturado.status).toBe(409);
    expect(errorCapturado.codigo).toBe('PAGO_EN_REVISION');
    expect(errorCapturado.tipo).toBe('en_revision');
    expect(errorCapturado.mensaje).toBe(
      'Tu pago anterior está en revisión. No vuelvas a pagar; pregúntale al mesero.'
    );
  });

  it('409 sin codigo devuelve el mensaje de siempre', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        ok: false,
      }),
    });

    let errorCapturado = null;
    try {
      await crearIntencion('propio', 'evt-456');
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).not.toBeNull();
    expect(errorCapturado.status).toBe(409);
    expect(errorCapturado.mensaje).toBe('No hay saldo pendiente para pagar');
  });
});
