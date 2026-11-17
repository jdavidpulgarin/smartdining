import { describe, it, expect, vi } from 'vitest';
import { obtenerMenuPublico } from './menuService.js';
import { pedirJson, ErrorApi } from './api.js';

describe('menuService y api.js', () => {
  it('200 devuelve { categorias, platos, armables } y nunca envía cabecera Authorization', async () => {
    const mockRespuesta = {
      categorias: [
        {
          id_categoria: 1,
          categoria: 'Entradas',
          orden: 1,
          platos: [
            {
              id_plato: 10,
              nombre: 'Papas bravas',
              precio: '15000',
              url_imagen: null,
              disponible: true,
              personalizable: false,
            },
          ],
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => mockRespuesta,
    });

    const resultado = await obtenerMenuPublico(mockFetch);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [urlLlamada, opcionesLlamada] = mockFetch.mock.calls[0];
    expect(urlLlamada).toContain('/menu');
    expect(opcionesLlamada.method).toBe('GET');
    expect(opcionesLlamada.headers?.Accept).toBe('application/json');
    expect(opcionesLlamada.headers?.Authorization).toBeUndefined();

    expect(resultado.categorias).toEqual([
      { id: 1, nombre: 'Entradas', orden: 1 },
    ]);
    expect(resultado.platos[0]).toMatchObject({
      id: 10,
      nombre: 'Papas bravas',
      precio: 15000,
      disponible: true,
    });
    expect(resultado.armables).toEqual([]);
  });

  it('500 lanza ErrorApi con status y mensaje', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ error: 'Error interno en base de datos' }),
    });

    await expect(obtenerMenuPublico(mockFetch)).rejects.toThrow(ErrorApi);

    try {
      await obtenerMenuPublico(mockFetch);
    } catch (err) {
      expect(err).toBeInstanceOf(ErrorApi);
      expect(err.status).toBe(500);
      expect(err.message).toBe('Error interno en base de datos');
    }
  });

  it('pedirJson lanza ErrorApi(status 0) ante fallo de red sin conexión', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(pedirJson('/menu', { fetchFn: mockFetch })).rejects.toThrow(ErrorApi);

    try {
      await pedirJson('/menu', { fetchFn: mockFetch });
    } catch (err) {
      expect(err.status).toBe(0);
      expect(err.motivo).toBe('sin_conexion');
    }
  });

  it('un plato con disponible=false en la respuesta cruda sale con disponible: false pasando por obtenerMenuPublico', async () => {
    const mockRespuestaCruda = {
      categorias: [
        {
          id_categoria: 1,
          categoria: 'Entradas',
          orden: 1,
          platos: [
            {
              id_plato: 10,
              nombre: 'Papas bravas',
              precio: '15000',
              url_imagen: null,
              disponible: false,
              personalizable: false,
            },
          ],
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => mockRespuestaCruda,
    });

    const resultado = await obtenerMenuPublico(mockFetch);
    expect(resultado.platos).toHaveLength(1);
    expect(resultado.platos[0].id).toBe(10);
    expect(resultado.platos[0].disponible).toBe(false);
  });
});
