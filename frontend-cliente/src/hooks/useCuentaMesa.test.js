import { describe, it, expect } from 'vitest';
import { debeRecargarCuentaPorEstado } from './useCuentaMesa';

describe('debeRecargarCuentaPorEstado', () => {
  it('devuelve true cuando el estado es "cancelado"', () => {
    expect(debeRecargarCuentaPorEstado({ estado: 'cancelado' })).toBe(true);
  });

  it('devuelve true cuando el estado es "CANCELADO" (sin importar mayúsculas)', () => {
    expect(debeRecargarCuentaPorEstado({ estado: 'CANCELADO' })).toBe(true);
    expect(debeRecargarCuentaPorEstado({ estado: 'Cancelado' })).toBe(true);
  });

  it('devuelve false cuando el estado es "listo"', () => {
    expect(debeRecargarCuentaPorEstado({ estado: 'listo' })).toBe(false);
  });

  it('devuelve false cuando el estado es "en_preparacion"', () => {
    expect(debeRecargarCuentaPorEstado({ estado: 'en_preparacion' })).toBe(false);
  });

  it('devuelve false para otros estados de pedido', () => {
    expect(debeRecargarCuentaPorEstado({ estado: 'recibido' })).toBe(false);
    expect(debeRecargarCuentaPorEstado({ estado: 'entregado' })).toBe(false);
  });

  it('devuelve false cuando el evento es null o undefined', () => {
    expect(debeRecargarCuentaPorEstado(null)).toBe(false);
    expect(debeRecargarCuentaPorEstado(undefined)).toBe(false);
  });

  it('devuelve false cuando no tiene estado o el objeto está vacío', () => {
    expect(debeRecargarCuentaPorEstado({})).toBe(false);
    expect(debeRecargarCuentaPorEstado({ id_pedido: 123 })).toBe(false);
    expect(debeRecargarCuentaPorEstado({ estado: null })).toBe(false);
    expect(debeRecargarCuentaPorEstado({ estado: '' })).toBe(false);
  });
});
