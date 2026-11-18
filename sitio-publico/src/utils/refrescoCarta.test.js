import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { iniciarRefresco } from './refrescoCarta.js';

describe('refrescoCarta con fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function crearMockDoc(estadoInicial = 'visible') {
    const listeners = {};
    return {
      visibilityState: estadoInicial,
      addEventListener: vi.fn((evento, callback) => {
        listeners[evento] = listeners[evento] || [];
        listeners[evento].push(callback);
      }),
      removeEventListener: vi.fn((evento, callback) => {
        if (listeners[evento]) {
          listeners[evento] = listeners[evento].filter((cb) => cb !== callback);
        }
      }),
      cambiarVisibilidad(nuevoEstado) {
        this.visibilityState = nuevoEstado;
        if (listeners['visibilitychange']) {
          listeners['visibilitychange'].forEach((cb) => cb());
        }
      },
      obtenerListeners(evento) {
        return listeners[evento] || [];
      },
    };
  }

  it('15 s visible → ejecuta carga', async () => {
    const mockCargar = vi.fn().mockResolvedValue();
    const doc = crearMockDoc('visible');

    const detener = iniciarRefresco({ cargar: mockCargar, intervaloMs: 15000, doc });

    expect(mockCargar).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15000);
    expect(mockCargar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(mockCargar).toHaveBeenCalledTimes(2);

    detener();
  });

  it('oculto (hidden) → no ejecuta la carga a los 15 s', async () => {
    const mockCargar = vi.fn().mockResolvedValue();
    const doc = crearMockDoc('hidden');

    const detener = iniciarRefresco({ cargar: mockCargar, intervaloMs: 15000, doc });

    await vi.advanceTimersByTimeAsync(15000);
    expect(mockCargar).not.toHaveBeenCalled();

    detener();
  });

  it('volver a visible → ejecuta la carga de inmediato', async () => {
    const mockCargar = vi.fn().mockResolvedValue();
    const doc = crearMockDoc('hidden');

    const detener = iniciarRefresco({ cargar: mockCargar, intervaloMs: 15000, doc });

    expect(mockCargar).not.toHaveBeenCalled();

    doc.cambiarVisibilidad('visible');
    expect(mockCargar).toHaveBeenCalledTimes(1);

    detener();
  });

  it('carga en curso → no lanza otra en simultáneo', async () => {
    let resolverCarga;
    const mockCargar = vi.fn().mockImplementation(() => {
      return new Promise((res) => {
        resolverCarga = res;
      });
    });

    const doc = crearMockDoc('visible');
    const detener = iniciarRefresco({ cargar: mockCargar, intervaloMs: 15000, doc });

    // Primera ejecución a los 15s
    vi.advanceTimersByTime(15000);
    expect(mockCargar).toHaveBeenCalledTimes(1);

    // Intentar disparar visibilidad mientras la primera aún no termina
    doc.cambiarVisibilidad('visible');
    expect(mockCargar).toHaveBeenCalledTimes(1);

    // Intentar segundo intervalo mientras aún está pendiente
    vi.advanceTimersByTime(15000);
    expect(mockCargar).toHaveBeenCalledTimes(1);

    // Termina la carga
    resolverCarga();
    await vi.advanceTimersByTimeAsync(0);

    // Siguiente intervalo ya puede ejecutarse
    await vi.advanceTimersByTimeAsync(15000);
    expect(mockCargar).toHaveBeenCalledTimes(2);

    detener();
  });

  it('detener() limpia intervalo y oyente de visibilidad', async () => {
    const mockCargar = vi.fn().mockResolvedValue();
    const doc = crearMockDoc('visible');

    const detener = iniciarRefresco({ cargar: mockCargar, intervaloMs: 15000, doc });
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    detener();
    expect(doc.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    await vi.advanceTimersByTimeAsync(30000);
    expect(mockCargar).not.toHaveBeenCalled();
  });
});
