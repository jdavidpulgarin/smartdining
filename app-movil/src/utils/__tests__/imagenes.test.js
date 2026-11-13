import { resolverUrlImagen } from '../imagenes';

describe('resolverUrlImagen (D-23 imágenes app-movil)', () => {
  it('null, "", "   " y undefined devuelven null', () => {
    expect(resolverUrlImagen(null, 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen(undefined, 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen('', 'https://api.staging.smartdining.com.co/api')).toBeNull();
    expect(resolverUrlImagen('   ', 'https://api.staging.smartdining.com.co/api')).toBeNull();
  });

  it('https://images.unsplash.com/... se conserva igual', () => {
    const urlAbs = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
    expect(resolverUrlImagen(urlAbs, 'https://api.staging.smartdining.com.co/api')).toBe(urlAbs);
    expect(resolverUrlImagen(urlAbs, 'http://localhost:4000/api')).toBe(urlAbs);
  });

  it('/imagenes/abc.webp con apiBase https://api.staging.smartdining.com.co/api → https://api.staging.smartdining.com.co/imagenes/abc.webp', () => {
    const res = resolverUrlImagen(
      '/imagenes/abc.webp',
      'https://api.staging.smartdining.com.co/api'
    );
    expect(res).toBe('https://api.staging.smartdining.com.co/imagenes/abc.webp');
  });

  it('/imagenes/abc.webp con apiBase http://localhost:4000/api → http://localhost:4000/imagenes/abc.webp', () => {
    const res = resolverUrlImagen('/imagenes/abc.webp', 'http://localhost:4000/api');
    expect(res).toBe('http://localhost:4000/imagenes/abc.webp');
  });

  it('es idempotente: resolver dos veces da el mismo resultado', () => {
    const apiBase = 'https://api.staging.smartdining.com.co/api';
    const unaVez = resolverUrlImagen('/imagenes/abc.webp', apiBase);
    const dosVeces = resolverUrlImagen(unaVez, apiBase);
    expect(dosVeces).toBe('https://api.staging.smartdining.com.co/imagenes/abc.webp');
    expect(dosVeces).toBe(unaVez);
  });

  it('apiBase inválida o ausente devuelve la ruta tal cual', () => {
    expect(resolverUrlImagen('/imagenes/abc.webp', 'invalida')).toBe('/imagenes/abc.webp');
    expect(resolverUrlImagen('/imagenes/abc.webp', '')).toBe('/imagenes/abc.webp');
    expect(resolverUrlImagen('/imagenes/abc.webp', null)).toBe('/imagenes/abc.webp');
    expect(resolverUrlImagen('/imagenes/abc.webp', undefined)).toBe('/imagenes/abc.webp');
  });

  it('cualquier otro valor relativo o desconocido se conserva tal cual', () => {
    expect(resolverUrlImagen('/assets/logo.png', 'https://api.staging.smartdining.com.co/api')).toBe('/assets/logo.png');
    expect(resolverUrlImagen('data:image/png;base64,abc', 'https://api.staging.smartdining.com.co/api')).toBe('data:image/png;base64,abc');
  });
});
