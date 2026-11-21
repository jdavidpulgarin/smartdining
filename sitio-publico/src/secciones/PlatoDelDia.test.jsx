import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlatoDelDia from './PlatoDelDia.jsx';

describe('Sección PlatoDelDia', () => {
  it('con martes: muestra "Salchipapa con todo", video con su portada, y botón "PÍDELO EN TU MESA"', () => {
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

    // Sin precios
    expect(html).not.toMatch(/\$\s*\d+/);
  });

  it('con un día sin video (miércoles): muestra la tarjeta con el nombre y descripción, y sin <video>', () => {
    const html = renderToStaticMarkup(<PlatoDelDia dia="miercoles" />);

    expect(html).toContain('id="hoy"');
    expect(html).toContain('Pastas a la boloñesa');
    expect(html).toContain('Plato del día');
    expect(html).toContain('miércoles');
    expect(html).toContain('PÍDELO EN TU MESA');
    expect(html).toContain('href="#como-pedir"');

    // No debe contener etiqueta video
    expect(html).not.toContain('<video');

    // Sin precios
    expect(html).not.toMatch(/\$\s*\d+/);
  });
});
