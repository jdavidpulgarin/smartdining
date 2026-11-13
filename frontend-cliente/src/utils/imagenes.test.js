import { describe, it, expect } from 'vitest';
import { resolverUrlImagen } from './imagenes';

const UUID_EJEMPLO = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

describe('resolverUrlImagen (D-23 lista blanca de imágenes)', () => {
  it('null, "", "   ", undefined y no-strings devuelven null', () => {
    expect(resolverUrlImagen(null, 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen(undefined, 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen('', 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen('   ', 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen(12345, 'https://api.staging.smartdining.com.co/api')).toBeNull();
  });

  it('https://images.unsplash.com/x se conserva igual', () => {
    const urlAbs = 'https://images.unsplash.com/x';
    expect(resolverUrlImagen(urlAbs, 'https://api.staging.smartdining.com.co/api')).toBe(urlAbs);
    expect(resolverUrlImagen(urlAbs, 'http://localhost:4000/api')).toBe(urlAbs);
  });

  it('/imagenes/<uuid>.webp con apiBase https://api.staging.smartdining.com.co/api, con /api/ y con /api/v1', () => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    const esperada = `https://api.staging.smartdining.com.co/imagenes/${UUID_EJEMPLO}.webp`;

    expect(resolverUrlImagen(ruta, 'https://api.staging.smartdining.com.co/api')).toBe(esperada);
    expect(resolverUrlImagen(ruta, 'https://api.staging.smartdining.com.co/api/')).toBe(esperada);
    expect(resolverUrlImagen(ruta, 'https://api.staging.smartdining.com.co/api/v1')).toBe(esperada);
  });

  it('/imagenes/<uuid>.webp con apiBase http://localhost:4000/api y es idempotente', () => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    const apiBase = 'http://localhost:4000/api';
    const esperada = `http://localhost:4000/imagenes/${UUID_EJEMPLO}.webp`;

    const unaVez = resolverUrlImagen(ruta, apiBase);
    expect(unaVez).toBe(esperada);

    const dosVeces = resolverUrlImagen(unaVez, apiBase);
    expect(dosVeces).toBe(esperada);
  });

  it('devuelve null si apiBase es inválida o ausente', () => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    expect(resolverUrlImagen(ruta, 'invalida')).toBeNull();
    expect(resolverUrlImagen(ruta, '')).toBeNull();
    expect(resolverUrlImagen(ruta, null)).toBeNull();
    expect(resolverUrlImagen(ruta, undefined)).toBeNull();
  });

  it('devuelve null para URLs y rutas no permitidas en la lista blanca', () => {
    const apiBase = 'https://api.staging.smartdining.com.co/api';
    const noPermitidas = [
      'http://ejemplo.com/a.webp',
      'javascript:alert(1)',
      'data:image/png;base64,AAA',
      '//evil.com/a.webp',
      '../a.webp',
      '/imagenes/../api/usuarios',
      '/imagenes/abc.webp',
      `/imagenes/${UUID_EJEMPLO}.png`,
      `/otra/${UUID_EJEMPLO}.webp`,
      'http://localhost:4000/api/usuarios',
      '/assets/logo.png',
      'HTTPS://images.unsplash.com/x',
    ];

    for (const valor of noPermitidas) {
      expect(resolverUrlImagen(valor, apiBase)).toBeNull();
    }

    // Caso de URL en el origen de desarrollo que no cumple PATRON_RUTA
    expect(resolverUrlImagen('http://localhost:4000/api/usuarios', 'http://localhost:4000/api')).toBeNull();
  });
});
