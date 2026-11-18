import { describe, it, expect } from 'vitest';
import {
  esLlaveDePrueba,
  leerModoPrueba,
  marcarModoPrueba,
  decidirApertura,
  CLAVE_PAGO_PRUEBA,
} from './modoPago';

describe('modoPago utilities', () => {
  describe('esLlaveDePrueba', () => {
    it('retorna true para llaves de prueba válidas que inician con pub_test_', () => {
      expect(esLlaveDePrueba('pub_test_abc')).toBe(true);
      expect(esLlaveDePrueba('pub_test_12345')).toBe(true);
      expect(esLlaveDePrueba('pub_test_simulada')).toBe(true);
    });

    it('retorna false para llaves de producción o valores no válidos', () => {
      expect(esLlaveDePrueba('pub_prod_abc')).toBe(false);
      expect(esLlaveDePrueba('pub_prod_123')).toBe(false);
      expect(esLlaveDePrueba(undefined)).toBe(false);
      expect(esLlaveDePrueba(null)).toBe(false);
      expect(esLlaveDePrueba(123)).toBe(false);
      expect(esLlaveDePrueba('')).toBe(false);
      expect(esLlaveDePrueba({})).toBe(false);
      expect(esLlaveDePrueba('test_pub_abc')).toBe(false);
    });
  });

  describe('decidirApertura', () => {
    it('retorna "aviso" si la llave es de prueba y no se ha visto el aviso', () => {
      expect(decidirApertura({ llave: 'pub_test_abc', avisoVisto: false })).toBe('aviso');
      expect(decidirApertura({ llave: 'pub_test_abc', avisoVisto: undefined })).toBe('aviso');
    });

    it('retorna "abrir" si la llave es de prueba pero ya se vio el aviso', () => {
      expect(decidirApertura({ llave: 'pub_test_abc', avisoVisto: true })).toBe('abrir');
    });

    it('retorna "abrir" para llaves de producción con o sin aviso visto', () => {
      expect(decidirApertura({ llave: 'pub_prod_abc', avisoVisto: false })).toBe('abrir');
      expect(decidirApertura({ llave: 'pub_prod_abc', avisoVisto: true })).toBe('abrir');
    });

    it('retorna "abrir" con valores vacíos o no válidos de llave', () => {
      expect(decidirApertura({})).toBe('abrir');
      expect(decidirApertura({ llave: null, avisoVisto: false })).toBe('abrir');
      expect(decidirApertura({ llave: '', avisoVisto: false })).toBe('abrir');
    });
  });

  describe('leerModoPrueba y marcarModoPrueba', () => {
    it('lee y marca correctamente con un storage falso', () => {
      const mapa = new Map();
      const storageFalso = {
        getItem: (k) => mapa.get(k) ?? null,
        setItem: (k, v) => mapa.set(k, String(v)),
      };

      expect(leerModoPrueba(storageFalso)).toBe(false);

      marcarModoPrueba(storageFalso);

      expect(mapa.get(CLAVE_PAGO_PRUEBA)).toBe('1');
      expect(leerModoPrueba(storageFalso)).toBe(true);
    });

    it('no lanza excepción y devuelve false cuando storage lanza en getItem o setItem', () => {
      const storageQueFalla = {
        getItem: () => {
          throw new Error('Almacenamiento restringido');
        },
        setItem: () => {
          throw new Error('Almacenamiento lleno');
        },
      };

      expect(() => marcarModoPrueba(storageQueFalla)).not.toThrow();
      expect(() => leerModoPrueba(storageQueFalla)).not.toThrow();
      expect(leerModoPrueba(storageQueFalla)).toBe(false);
    });

    it('maneja storage nulo o indefinido sin lanzar errores', () => {
      expect(() => marcarModoPrueba(null)).not.toThrow();
      expect(leerModoPrueba(null)).toBe(false);
    });
  });
});
