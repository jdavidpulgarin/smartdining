import { resolverUrlImagen } from '../imagenes';

const UUID_EJEMPLO = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const API_STAGING = 'https://api.staging.smartdining.com.co/api';

describe('resolverUrlImagen (D-23 lista blanca de imágenes app-movil)', () => {
  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    [12345],
  ])('valor vacío o no string %j devuelve null', (val) => {
    expect(resolverUrlImagen(val, API_STAGING)).toBeNull();
  });

  it('https://images.unsplash.com/x se conserva igual', () => {
    const urlAbs = 'https://images.unsplash.com/x';
    expect(resolverUrlImagen(urlAbs, API_STAGING)).toBe(urlAbs);
    expect(resolverUrlImagen(urlAbs, 'http://localhost:4000/api')).toBe(urlAbs);
  });

  it.each([
    ['https://api.staging.smartdining.com.co/api'],
    ['https://api.staging.smartdining.com.co/api/'],
    ['https://api.staging.smartdining.com.co/api/v1'],
  ])('/imagenes/<uuid>.webp con apiBase %s antepone el origen sin dobles barras', (apiBase) => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    const esperada = `https://api.staging.smartdining.com.co/imagenes/${UUID_EJEMPLO}.webp`;
    expect(resolverUrlImagen(ruta, apiBase)).toBe(esperada);
  });

  it('/imagenes/<uuid>.webp con apiBase http://localhost:4000/api antepone el origen', () => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    const apiBase = 'http://localhost:4000/api';
    expect(resolverUrlImagen(ruta, apiBase)).toBe(`http://localhost:4000/imagenes/${UUID_EJEMPLO}.webp`);
  });

  it('es idempotente: resolver dos veces con http://localhost:4000/api da el mismo resultado', () => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    const apiBase = 'http://localhost:4000/api';
    const esperada = `http://localhost:4000/imagenes/${UUID_EJEMPLO}.webp`;
    const unaVez = resolverUrlImagen(ruta, apiBase);
    expect(unaVez).toBe(esperada);
    const dosVeces = resolverUrlImagen(unaVez, apiBase);
    expect(dosVeces).toBe(esperada);
  });

  it.each([
    ['invalida'],
    [''],
    [null],
    [undefined],
  ])('devuelve null si apiBase es inválida o ausente: %j', (apiBase) => {
    const ruta = `/imagenes/${UUID_EJEMPLO}.webp`;
    expect(resolverUrlImagen(ruta, apiBase)).toBeNull();
  });

  it.each([
    ['http://ejemplo.com/a.webp'],
    ['javascript:alert(1)'],
    ['data:image/png;base64,AAA'],
    ['//evil.com/a.webp'],
    ['../a.webp'],
    ['/imagenes/../api/usuarios'],
    ['/imagenes/abc.webp'],
    [`/imagenes/${UUID_EJEMPLO}.png`],
    [`/otra/${UUID_EJEMPLO}.webp`],
    ['http://localhost:4000/api/usuarios'],
    ['/assets/logo.png'],
    ['HTTPS://images.unsplash.com/x'],
    [`/imagenes/${UUID_EJEMPLO.toUpperCase()}.webp`],
    [`/imagenes/${UUID_EJEMPLO}.WEBP`],
  ])('devuelve null para valor no permitido: %s', (url) => {
    expect(resolverUrlImagen(url, API_STAGING)).toBeNull();
  });

  it('devuelve null para http://localhost:4000/api/usuarios con apiBase http://localhost:4000/api', () => {
    expect(resolverUrlImagen('http://localhost:4000/api/usuarios', 'http://localhost:4000/api')).toBeNull();
  });
});
