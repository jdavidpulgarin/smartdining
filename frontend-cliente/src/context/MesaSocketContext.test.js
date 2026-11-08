import { describe, it, expect } from 'vitest';
import { esModoCompartido, validarPresencia } from './MesaSocketContext';

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

describe('validarPresencia', () => {
  it('valida y normaliza un payload correcto de mesa:presencia', () => {
    const raw = {
      id_mesa: 5,
      comensales: ['Ana', 'Beto'],
      total: 2,
      pagaron: ['Ana'],
    };
    expect(validarPresencia(raw)).toEqual({
      comensales: ['Ana', 'Beto'],
      pagaron: ['Ana'],
      total: 2,
      sin_celular: [],
    });
  });

  it('respeta sin_celular si viene definido como array de strings', () => {
    const raw = {
      id_mesa: 5,
      comensales: ['Ana'],
      total: 2,
      pagaron: [],
      sin_celular: ['Carlos'],
    };
    expect(validarPresencia(raw)).toEqual({
      comensales: ['Ana'],
      pagaron: [],
      total: 2,
      sin_celular: ['Carlos'],
    });
  });

  it('ignora payloads inválidos o malformados', () => {
    expect(validarPresencia(null)).toBeNull();
    expect(validarPresencia('texto')).toBeNull();
    expect(validarPresencia({})).toBeNull();
    expect(validarPresencia({ comensales: 'Ana', pagaron: [], total: 1 })).toBeNull();
    expect(validarPresencia({ comensales: [123], pagaron: [], total: 1 })).toBeNull();
    expect(validarPresencia({ comensales: [], pagaron: 'Ana', total: 1 })).toBeNull();
    expect(validarPresencia({ comensales: [], pagaron: [], total: 'dos' })).toBeNull();
    expect(validarPresencia({ comensales: [], pagaron: [], total: 0, sin_celular: 'no-array' })).toBeNull();
  });
});
