import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlatoDelDia from './PlatoDelDia.jsx';

describe('Sección PlatoDelDia', () => {
  it('con martes: muestra "Salchipapa con todo", precio "25.000" formateado, video con su portada, y botón "PÍDELO EN TU MESA"', () => {
    const html = renderToStaticMarkup(<PlatoDelDia dia="martes" />);

    expect(html).toContain('id="hoy"');
    expect(html).toContain('Salchipapa con todo');
    expect(html).toContain('Plato del día');
    expect(html).toContain('martes');
    expect(html).toContain('PÍDELO EN TU MESA');
    expect(html).toContain('href="#como-pedir"');

    // Video y portada
    expect(html).toContain('<video');
    expect(html).toContain('poster="/videos/plato-del-dia/salchipapa.webp"');
    expect(html).toContain('/videos/plato-del-dia/salchipapa.mp4');
    expect(html).toContain('preload="none"');
    expect(html).toContain('muted');
    expect(html).toMatch(/playsinline/i);
    expect(html).toContain('loop');

    // Botón de control de reproducción accesible
    expect(html).toContain('aria-label');

    // Precio formateado grande en el ticket
    expect(html).toContain('25.000');
    expect(html).toContain('$');
  });

  it('con un día sin video (miércoles): muestra la tarjeta con el nombre, descripción, precio "22.000" y sin <video>', () => {
    const html = renderToStaticMarkup(<PlatoDelDia dia="miercoles" />);

    expect(html).toContain('id="hoy"');
    expect(html).toContain('Pastas a la boloñesa');
    expect(html).toContain('Plato del día');
    expect(html).toContain('miércoles');
    expect(html).toContain('PÍDELO EN TU MESA');
    expect(html).toContain('href="#como-pedir"');

    // No debe contener etiqueta video
    expect(html).not.toContain('<video');

    // Precio formateado
    expect(html).toContain('22.000');
    expect(html).toContain('$');
  });

  it('con un plato sin precio: no muestra el símbolo de moneda "$"', () => {
    const platoSinPrecio = {
      dia: 'lunes',
      diaEtiqueta: 'lunes',
      nombre: 'Plato Degustación Especial',
      descripcion: 'Plato de cortesía para la mesa sin precio asignado.',
    };

    const html = renderToStaticMarkup(<PlatoDelDia plato={platoSinPrecio} />);

    expect(html).toContain('Plato Degustación Especial');
    expect(html).toContain('Plato de cortesía');
    expect(html).not.toContain('$');
  });
});
