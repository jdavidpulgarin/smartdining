import { describe, it, expect } from 'vitest';
import { uuidV4 } from './clienteMesa';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uuidV4', () => {
  it('genera un UUID v4 válido en condiciones estándar', () => {
    const id = uuidV4();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('devuelve un UUID v4 válido cuando crypto.randomUUID no existe (simula globalThis.crypto solo con getRandomValues)', () => {
    const cryptoOriginal = globalThis.crypto;
    const descOriginal = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

    try {
      // Simular un entorno no seguro (HTTP en IP de red local) donde crypto.randomUUID no está disponible
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          getRandomValues: (arr) => cryptoOriginal.getRandomValues(arr),
        },
        configurable: true,
        writable: true,
      });

      expect(globalThis.crypto.randomUUID).toBeUndefined();

      const id = uuidV4();
      expect(typeof id).toBe('string');
      expect(id).toMatch(UUID_V4_REGEX);
    } finally {
      if (descOriginal) {
        Object.defineProperty(globalThis, 'crypto', descOriginal);
      } else {
        globalThis.crypto = cryptoOriginal;
      }
    }
  });
});

