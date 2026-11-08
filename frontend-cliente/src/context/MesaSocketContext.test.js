import { describe, it, expect } from 'vitest';
import { esModoCompartido } from './MesaSocketContext';

describe('esModoCompartido', () => {
  it('devuelve false si no hay token o url de socket', () => {
    expect(esModoCompartido(null, 'http://localhost:4001')).toBe(false);
    expect(esModoCompartido('un-token', null)).toBe(false);
    expect(esModoCompartido('', '')).toBe(false);
  });

  it('devuelve false si el token es simulado local (termina en .simulada)', () => {
    expect(
      esModoCompartido('header.payload.simulada', 'http://localhost:4001')
    ).toBe(false);
  });

  it('devuelve true si hay token real firmado y url de socket', () => {
    expect(
      esModoCompartido(
        'eyJhbGciOiJIUzI1NiJ9.eyJpZF9tZXNhIjo1fQ.signature_real',
        'http://localhost:4001'
      )
    ).toBe(true);
  });
});
