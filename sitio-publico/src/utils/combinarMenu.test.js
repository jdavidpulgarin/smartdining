import { describe, it, expect } from 'vitest';
import { combinarMenu } from './combinarMenu.js';

describe('combinarMenu', () => {
  it('vivo + fija → conserva el anterior (vivo)', () => {
    const anterior = { origen: 'vivo', platos: [{ id: 1 }] };
    const nuevo = { origen: 'fija', platos: [{ id: 1 }, { id: 2 }] };

    const resultado = combinarMenu(anterior, nuevo);
    expect(resultado).toBe(anterior);
    expect(resultado.origen).toBe('vivo');
  });

  it('fija + vivo → devuelve el nuevo (vivo)', () => {
    const anterior = { origen: 'fija', platos: [] };
    const nuevo = { origen: 'vivo', platos: [{ id: 1 }] };

    const resultado = combinarMenu(anterior, nuevo);
    expect(resultado).toBe(nuevo);
    expect(resultado.origen).toBe('vivo');
  });

  it('vivo + vivo → devuelve el nuevo', () => {
    const anterior = { origen: 'vivo', platos: [{ id: 1 }] };
    const nuevo = { origen: 'vivo', platos: [{ id: 1, nombre: 'Actualizado' }] };

    const resultado = combinarMenu(anterior, nuevo);
    expect(resultado).toBe(nuevo);
  });

  it('sin anterior + fija → devuelve el nuevo (fija)', () => {
    const nuevo = { origen: 'fija', platos: [] };
    expect(combinarMenu(null, nuevo)).toBe(nuevo);
  });
});
