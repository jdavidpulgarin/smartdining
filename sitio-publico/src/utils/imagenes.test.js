import { describe, it, expect } from 'vitest';
import { resolverUrlImagen } from './imagenes.js';

describe('resolverUrlImagen', () => {
  const uuidValido = '12345678-1234-1234-1234-123456789abc';
  const rutaValida = `/imagenes/${uuidValido}.webp`;

  it('con API_URL relativo devuelve la ruta /imagenes/<uuid>.webp tal cual', () => {
    expect(resolverUrlImagen(rutaValida, '/api')).toBe(rutaValida);
    expect(resolverUrlImagen(rutaValida, '/')).toBe(rutaValida);
  });

  it('con API_URL absoluto devuelve el origen de la API + ruta', () => {
    const apiAbsoluta = 'https://api.staging.smartdining.com.co/api';
    const esperada = `https://api.staging.smartdining.com.co${rutaValida}`;
    expect(resolverUrlImagen(rutaValida, apiAbsoluta)).toBe(esperada);
  });

  it('es idempotente si la ruta ya incluye el origen de la API', () => {
    const apiAbsoluta = 'https://api.staging.smartdining.com.co/api';
    const yaResuelta = `https://api.staging.smartdining.com.co${rutaValida}`;
    expect(resolverUrlImagen(yaResuelta, apiAbsoluta)).toBe(yaResuelta);
  });

  it('permite URLs https externas bien formadas', () => {
    const urlHttps = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c.jpg';
    expect(resolverUrlImagen(urlHttps, '/api')).toBe(urlHttps);
  });

  it('devuelve null ante javascript:, http:// y rutas raras o maliciosas', () => {
    expect(resolverUrlImagen('javascript:alert(1)', '/api')).toBeNull();
    expect(resolverUrlImagen('http://inseguro.com/foto.jpg', '/api')).toBeNull();
    expect(resolverUrlImagen('/imagenes/invalido.png', '/api')).toBeNull();
    expect(resolverUrlImagen('/imagenes/../secreto.webp', '/api')).toBeNull();
    expect(resolverUrlImagen('data:image/png;base64,123', '/api')).toBeNull();
    expect(resolverUrlImagen(null, '/api')).toBeNull();
    expect(resolverUrlImagen('', '/api')).toBeNull();
  });
});
