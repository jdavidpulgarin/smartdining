import { describe, it, expect } from 'vitest';
import { crearDeduplicador } from './deduplicador';

describe('crearDeduplicador', () => {
  it('sin eventId nunca es duplicado', () => {
    const dedup = crearDeduplicador();
    expect(dedup.visto(null)).toBe(false);
    expect(dedup.visto(undefined)).toBe(false);
    expect(dedup.visto('')).toBe(false);
    expect(dedup.visto(null)).toBe(false);
  });

  it('detecta eventos distintos como no duplicados', () => {
    const dedup = crearDeduplicador();
    expect(dedup.visto('ev-1')).toBe(false);
    expect(dedup.visto('ev-2')).toBe(false);
    expect(dedup.visto('ev-3')).toBe(false);
  });

  it('detecta evento repetido', () => {
    const dedup = crearDeduplicador();
    expect(dedup.visto('ev-1')).toBe(false);
    expect(dedup.visto('ev-1')).toBe(true);
    expect(dedup.visto('ev-1')).toBe(true);
  });

  it('respeta la capacidad y olvida el más viejo al pasar el límite', () => {
    const dedup = crearDeduplicador({ capacidad: 2 });
    expect(dedup.visto('ev-1')).toBe(false);
    expect(dedup.visto('ev-2')).toBe(false);

    // ev-3 entra y desaloja a ev-1 (el más viejo)
    expect(dedup.visto('ev-3')).toBe(false);

    // ev-2 sigue en memoria
    expect(dedup.visto('ev-2')).toBe(true);

    // ev-1 fue olvidado, por lo que vuelve a ser visto por primera vez
    expect(dedup.visto('ev-1')).toBe(false);
  });
});
