import { describe, expect, it } from 'vitest';
import { obtenerMetadatosRuta } from './metadatosRuta';

describe('obtenerMetadatosRuta', () => {
  it('mantiene Inicio indexable con titulo por defecto', () => {
    expect(obtenerMetadatosRuta('/')).toEqual({
      titulo: 'SmartDining - Cliente',
      robots: 'index, follow',
    });
  });

  it('marca las rutas internas de mesa como noindex, nofollow', () => {
    const rutasPrivadas = [
      '/menu',
      '/armar/1001',
      '/carrito',
      '/seguimiento',
      '/pago',
      '/despedida',
    ];
    for (const ruta of rutasPrivadas) {
      const res = obtenerMetadatosRuta(ruta);
      expect(res.robots).toBe('noindex, nofollow');
      expect(res.titulo).toContain('SmartDining');
    }
  });
});
