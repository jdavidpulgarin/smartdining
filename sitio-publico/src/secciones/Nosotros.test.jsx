import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import Nosotros from './Nosotros.jsx';
import restaurante from '../datos/restaurante.js';

describe('Sección Nosotros', () => {
  it('contiene <img> con src="/img/nosotros.webp", alt no vacío, width, height y loading="lazy"', () => {
    const html = renderToStaticMarkup(<Nosotros datosRestaurante={restaurante} />);

    // Verifica la imagen institucional
    expect(html).toContain('src="/img/nosotros.webp"');
    expect(html).toContain('width="825"');
    expect(html).toContain('height="1024"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toMatch(
      /alt="Interior del restaurante SmartDining: mesas de madera con su código QR, lámparas cálidas y barra al fondo"/
    );
  });

  it('muestra la etiqueta "Desde 2016" y la nota "Imagen ilustrativa generada con IA"', () => {
    const html = renderToStaticMarkup(<Nosotros datosRestaurante={restaurante} />);

    expect(html).toContain('Desde 2016');
    expect(html).toContain('Imagen ilustrativa generada con IA');
  });

  it('incluye los 3 puntos destacados con sus títulos y descripciones de apoyo', () => {
    const html = renderToStaticMarkup(<Nosotros datosRestaurante={restaurante} />);

    // 1. Recetas de la casa
    expect(html).toContain('Recetas de la casa');
    // 2. Productos de la región
    expect(html).toContain('Productos de la región');
    // 3. Pide y paga desde tu mesa
    expect(html).toContain('Pide y paga desde tu mesa');

    // Íconos SVG con aria-hidden
    const svgs = html.match(/<svg[^>]*aria-hidden="true"/g) || [];
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });
});
