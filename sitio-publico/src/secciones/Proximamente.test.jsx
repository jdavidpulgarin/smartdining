import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import Proximamente from './Proximamente.jsx';

describe('Sección Próximamente', () => {
  it('contiene las tarjetas de "Para llevar" y "Domicilios" con la etiqueta "Muy pronto", clases prox-sacude y prox-rueda', () => {
    const html = renderToStaticMarkup(<Proximamente />);

    expect(html).toContain('Para llevar');
    expect(html).toContain('Domicilios');
    expect(html).toContain('Muy pronto');

    // Las ilustraciones son SVG en línea decorativas con aria-hidden y focusable="false", sin role="img"
    const svgs = html.match(/<svg[^>]*aria-hidden="true"[^>]*>/g) || [];
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/<svg[^>]*role="img"/);
    expect(html).toContain('focusable="false"');

    // Clases de animación
    expect(html).toContain('prox-sacude');
    expect(html).toContain('prox-rueda');
    expect(html).toContain('prox-entra');
    expect(html).toContain('prox-entra-retraso');
  });

  it('no contiene enlaces ni botones interactivos y muestra el llamado al pedido con QR', () => {
    const html = renderToStaticMarkup(<Proximamente />);

    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toMatch(/<button[\s>]/);
    expect(html).toContain('Mientras tanto,');
    expect(html).toContain('escanea el QR de tu mesa y pide desde el celular.');
  });
});
