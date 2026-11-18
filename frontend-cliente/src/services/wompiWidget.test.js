import { describe, it, expect, vi, afterEach } from 'vitest';
import { urlRedireccionWompi, cerrarWidget } from './wompiWidget';

describe('wompiWidget.js (J-15)', () => {
  describe('urlRedireccionWompi', () => {
    it('http://localhost:5174 → null', () => {
      expect(urlRedireccionWompi('http://localhost:5174')).toBeNull();
      expect(urlRedireccionWompi('http://localhost:5174', '/pago')).toBeNull();
    });

    it('http://192.168.1.10:5174 → null', () => {
      expect(urlRedireccionWompi('http://192.168.1.10:5174')).toBeNull();
      expect(urlRedireccionWompi('http://192.168.1.10:5174', '/pago')).toBeNull();
    });

    it('https://smartdining.app → "https://smartdining.app/pago"', () => {
      expect(urlRedireccionWompi('https://smartdining.app')).toBe('https://smartdining.app/pago');
      expect(urlRedireccionWompi('https://smartdining.app', '/pago')).toBe('https://smartdining.app/pago');
      expect(urlRedireccionWompi('https://smartdining.app/')).toBe('https://smartdining.app/pago');
    });

    it('https://localhost:5174 → null', () => {
      expect(urlRedireccionWompi('https://localhost:5174')).toBeNull();
      expect(urlRedireccionWompi('https://127.0.0.1:5174')).toBeNull();
    });

    it('origen faltante o inválido → null', () => {
      expect(urlRedireccionWompi(null)).toBeNull();
      expect(urlRedireccionWompi(undefined)).toBeNull();
      expect(urlRedireccionWompi('')).toBeNull();
      expect(urlRedireccionWompi('   ')).toBeNull();
    });
  });

  describe('cerrarWidget', () => {
    afterEach(() => {
      delete globalThis.document;
    });

    it('no falla si document es undefined', () => {
      delete globalThis.document;
      expect(() => cerrarWidget()).not.toThrow();
    });

    it('remueve elementos coincidentes del DOM y quita no-scroll de body', () => {
      const removeMock1 = vi.fn();
      const removeMock2 = vi.fn();
      const removeClassMock = vi.fn();

      globalThis.document = {
        querySelectorAll: (selector) => {
          if (selector === '.waybox-backdrop') return [{ remove: removeMock1 }];
          if (selector === '.waybox-modal') return [{ remove: removeMock2 }];
          return [];
        },
        body: {
          classList: {
            remove: removeClassMock,
          },
        },
      };

      cerrarWidget();
      expect(removeMock1).toHaveBeenCalledTimes(1);
      expect(removeMock2).toHaveBeenCalledTimes(1);
      expect(removeClassMock).toHaveBeenCalledWith('no-scroll');
    });
  });
});
