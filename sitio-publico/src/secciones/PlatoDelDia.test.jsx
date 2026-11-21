import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlatoDelDia from './PlatoDelDia.jsx';

describe('Sección PlatoDelDia', () => {
  it('con martes: muestra etiqueta sin "HOY,", título en dos partes, lema, precio "25.000" en ticket, video con portada y botón "PÍDELO EN TU MESA"', () => {
    const html = renderToStaticMarkup(<PlatoDelDia dia="martes" />);

    expect(html).toContain('id="hoy"');

    // 1) Etiqueta en mayúsculas espaciadas sin "HOY,"
    expect(html).toContain('PLATO DEL DÍA · MARTES');
    expect(html).not.toContain('Hoy, martes');

    // 2) Título grande en dos líneas y lema
    expect(html).toContain('SALCHIPAPA');
    expect(html).toContain('CON TODO');
    expect(html).toContain('como debe ser');

    // 3) Descripción suelta
    expect(html).toContain('Papas a la francesa crocantes');
    expect(html).not.toContain('>Descripción<');

    // 4) Ticket de papel con precio y botón
    expect(html).toContain('ticket-papel');
    expect(html).toContain('PRECIO DE HOY');
    expect(html).toContain('25.000');
    expect(html).toContain('$');
    expect(html).toContain('Disponible hoy');
    expect(html).toContain('PÍDELO EN TU MESA');
    expect(html).toContain('href="#como-pedir"');

    // Video y portada con atributos accesibles
    expect(html).toContain('<video');
    expect(html).toContain('poster="/videos/plato-del-dia/salchipapa.webp"');
    expect(html).toContain('/videos/plato-del-dia/salchipapa.mp4');
    expect(html).toContain('preload="none"');
    expect(html).toContain('muted');
    expect(html).toMatch(/playsinline/i);
    expect(html).toContain('loop');
    expect(html).toContain('aria-label');
  });

  it('con un día sin video (miércoles): muestra etiqueta, título en dos partes, lema, ticket con "22.000" y sin <video>', () => {
    const html = renderToStaticMarkup(<PlatoDelDia dia="miercoles" />);

    expect(html).toContain('id="hoy"');
    expect(html).toContain('PLATO DEL DÍA · MIÉRCOLES');
    expect(html).toContain('PASTAS A LA');
    expect(html).toContain('BOLOÑESA');
    expect(html).toContain('receta de la casa');
    expect(html).toContain('Pasta artesanal cocida al dente');

    // Ticket con precio
    expect(html).toContain('ticket-papel');
    expect(html).toContain('PRECIO DE HOY');
    expect(html).toContain('22.000');
    expect(html).toContain('$');
    expect(html).toContain('Disponible hoy');

    // No debe contener etiqueta video
    expect(html).not.toContain('<video');

    // Botón
    expect(html).toContain('PÍDELO EN TU MESA');
    expect(html).toContain('href="#como-pedir"');
  });

  it('con un plato sin precio: no muestra el ticket de precio ni el símbolo "$"', () => {
    const platoSinPrecio = {
      dia: 'lunes',
      diaEtiqueta: 'lunes',
      nombre: 'Plato Degustación Especial',
      titulo1: 'DEGUSTACIÓN',
      titulo2: 'ESPECIAL',
      lema: 'cortesía de la casa',
      descripcion: 'Plato de cortesía para la mesa sin precio asignado.',
    };

    const html = renderToStaticMarkup(<PlatoDelDia plato={platoSinPrecio} />);

    expect(html).toContain('DEGUSTACIÓN');
    expect(html).toContain('ESPECIAL');
    expect(html).toContain('cortesía de la casa');
    expect(html).not.toContain('ticket-papel');
    expect(html).not.toContain('PRECIO DE HOY');
    expect(html).not.toContain('$');
  });
});
