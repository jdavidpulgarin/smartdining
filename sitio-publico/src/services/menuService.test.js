import { describe, it, expect, vi, beforeEach } from 'vitest';
import { obtenerMenuPublico, obtenerMenuFijo } from './menuService.js';
import { pedirJson, ErrorApi } from './api.js';

describe('menuService y api.js', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('200 devuelve { categorias, platos, armables, origen: "vivo" } y nunca envía cabecera Authorization', async () => {
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

    expect(resultado.origen).toBe('vivo');
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

  it('500 de la API devuelve la carta fija con origen: "fija"', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: {
        get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ error: 'Error interno en base de datos' }),
    });

    const resultado = await obtenerMenuPublico(mockFetch);

    expect(resultado.origen).toBe('fija');
    expect(resultado.categorias.length).toBeGreaterThan(0);
    expect(resultado.platos.length).toBeGreaterThan(0);
    expect(resultado.platos.every((p) => p.disponible === true)).toBe(true);
  });

  it('fallo de fetch (red caída) devuelve la carta fija con origen: "fija"', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    const resultado = await obtenerMenuPublico(mockFetch);

    expect(resultado.origen).toBe('fija');
    expect(resultado.categorias.length).toBeGreaterThan(0);
    expect(resultado.platos.length).toBeGreaterThan(0);
    expect(resultado.platos.every((p) => p.disponible === true)).toBe(true);
  });

  it('fetch que nunca responde cae al fallback fija a los 6s usando fake timers', async () => {
    vi.useFakeTimers();

    const mockFetch = vi.fn().mockImplementation(() => new Promise(() => {}));

    const promesaMenu = obtenerMenuPublico(mockFetch);

    // Avanzamos el tiempo más allá del timeout de 6000ms
    await vi.advanceTimersByTimeAsync(6001);

    const resultado = await promesaMenu;

    expect(resultado.origen).toBe('fija');
    expect(resultado.categorias.length).toBeGreaterThan(0);
    expect(resultado.platos.length).toBeGreaterThan(0);
    expect(resultado.platos.every((p) => p.disponible === true)).toBe(true);

    vi.useRealTimers();
  });

  it('pedirJson lanza ErrorApi(status 0, motivo: "sin_conexion") ante fallo de red sin conexión', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(pedirJson('/menu', { fetchFn: mockFetch })).rejects.toThrow(ErrorApi);

    try {
      await pedirJson('/menu', { fetchFn: mockFetch });
    } catch (err) {
      expect(err.status).toBe(0);
      expect(err.motivo).toBe('sin_conexion');
    }
  });

  it('obtenerMenuFijo devuelve categorías, platos y armables con disponible: true', () => {
    const fija = obtenerMenuFijo();
    expect(fija.origen).toBe('fija');
    expect(fija.categorias.length).toBeGreaterThan(0);
    expect(fija.platos.length).toBeGreaterThan(0);
    expect(fija.platos.every((p) => p.disponible === true)).toBe(true);
    if (fija.armables.length > 0) {
      expect(fija.armables.every((a) => a.disponible === true)).toBe(true);
      for (const armable of fija.armables) {
        for (const paso of armable.pasos || []) {
          for (const ing of paso.ingredientes || []) {
            expect(ing.disponible).toBe(true);
          }
        }
      }
    }
  });

  it('un plato con disponible=false en la respuesta cruda sale con disponible: false si origen es vivo', async () => {
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
    expect(resultado.origen).toBe('vivo');
    expect(resultado.platos).toHaveLength(1);
    expect(resultado.platos[0].id).toBe(10);
    expect(resultado.platos[0].disponible).toBe(false);
  });
});
