import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlatoCard from './PlatoCard.jsx';

describe('PlatoCard (soloLectura)', () => {
  it('renderiza el plato en modo soloLectura sin botones de compra', () => {
    const plato = {
      id: 1,
      nombre: 'Ceviche Mixto',
      descripcion: 'Pescado fresco marinado en lima',
      precio: 28000,
      imagen: 'https://images.unsplash.com/ceviche.jpg',
      disponible: true,
      etiquetas: ['sin_gluten'],
    };

    const html = renderToStaticMarkup(<PlatoCard plato={plato} soloLectura={true} />);

    expect(html).toContain('Ceviche Mixto');
    expect(html).toContain('28.000');
    expect(html).toContain('Ver detalle →');
    expect(html).not.toContain('Añadir');
    expect(html).not.toContain('Agregar');
  });

  it('muestra la etiqueta de AGOTADO si disponible es false', () => {
    const plato = {
      id: 2,
      nombre: 'Pulpo a la Gallega',
      descripcion: 'Con pimentón y papas',
      precio: 36000,
      disponible: false,
    };

    const html = renderToStaticMarkup(<PlatoCard plato={plato} soloLectura={true} />);

    expect(html).toContain('AGOTADO');
  });
});
