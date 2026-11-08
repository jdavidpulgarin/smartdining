import { describe, it, expect } from 'vitest';
import { urlRedireccionWompi } from './wompiWidget';

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
});
