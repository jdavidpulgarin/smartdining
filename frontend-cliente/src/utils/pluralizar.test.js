import { describe, expect, it } from 'vitest';
import { pluralizar } from './pluralizar';

describe('pluralizar', () => {
  it('devuelve singular cuando la cantidad es 1', () => {
    expect(pluralizar(1, 'plato', 'platos')).toBe('plato');
    expect(pluralizar('1', 'plato', 'platos')).toBe('plato');
    expect(pluralizar(1, 'producto')).toBe('producto');
  });

  it('devuelve plural cuando la cantidad es 0', () => {
    expect(pluralizar(0, 'plato', 'platos')).toBe('platos');
    expect(pluralizar('0', 'producto')).toBe('productos');
  });

  it('devuelve plural cuando la cantidad es mayor a 1', () => {
    expect(pluralizar(2, 'plato', 'platos')).toBe('platos');
    expect(pluralizar(5, 'plato', 'platos')).toBe('platos');
    expect(pluralizar('3', 'producto')).toBe('productos');
  });

  it('usa plural por defecto agregando "s"', () => {
    expect(pluralizar(2, 'comensal', 'comensales')).toBe('comensales');
    expect(pluralizar(1, 'comensal', 'comensales')).toBe('comensal');
    expect(pluralizar(4, 'producto')).toBe('productos');
    expect(pluralizar(4, 'plato')).toBe('platos');
  });
});
