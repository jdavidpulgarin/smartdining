import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { efectoCarta } from './efectoCarta.js';

describe('efectoCarta', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('la limpieza devuelta es una función, llamarla NO lanza, quita el listener de visibilitychange, y después de limpiar avanzar 15 s NO vuelve a llamar a obtener; llamar la limpieza dos veces no lanza', async () => {
    const listeners = new Map();
    const docFalso = {
      visibilityState: 'visible',
      addEventListener: vi.fn((evento, cb) => {
        listeners.set(evento, cb);
      }),
      removeEventListener: vi.fn((evento) => {
        listeners.delete(evento);
      }),
    };

    const mockMenu = {
      categorias: [{ id: 1, nombre: 'Entradas', orden: 1 }],
      platos: [],
      armables: [],
      origen: 'vivo',
    };
    const obtenerSimulado = vi.fn().mockResolvedValue(mockMenu);
    const setMenu = vi.fn();
    const setError = vi.fn();
    const setCargando = vi.fn();

    const limpieza = efectoCarta({
      menuInicial: mockMenu,
      obtener: obtenerSimulado,
      setMenu,
      setError,
      setCargando,
      doc: docFalso,
      intervaloMs: 15000,
    });

    expect(typeof limpieza).toBe('function');
    expect(docFalso.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    );

    // Llamar la limpieza NO debe lanzar error
    expect(() => limpieza()).not.toThrow();

    // Debe haber retirado el listener
    expect(docFalso.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    );

    // Obtener no debe haber sido llamado aún
    expect(obtenerSimulado).not.toHaveBeenCalled();

    // Al avanzar 15s, no debe volverse a llamar
    await vi.advanceTimersByTimeAsync(15000);
    expect(obtenerSimulado).not.toHaveBeenCalled();

    // Llamar la limpieza una segunda vez tampoco debe lanzar
    expect(() => limpieza()).not.toThrow();
  });
});
