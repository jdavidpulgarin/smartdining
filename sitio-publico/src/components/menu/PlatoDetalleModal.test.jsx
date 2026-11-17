import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlatoDetalleModal from './PlatoDetalleModal.jsx';

describe('PlatoDetalleModal (soloLectura)', () => {
  it('renderiza información del plato sin selector de cantidad ni botón de añadir', () => {
    const plato = {
      id: 1,
      nombre: 'Costillas BBQ',
      descripcion: 'Costillas de cerdo ahumadas con salsa BBQ casera',
      precio: 38000,
      imagen: 'https://images.unsplash.com/ribs.jpg',
      disponible: true,
      alergenos: ['gluten'],
      personalizaciones: [
        {
          id: 'termino',
          nombre: 'Término de cocción',
          tipo: 'unica',
          obligatorio: true,
          opciones: [
            { id: 'medio', nombre: 'Término medio', precioExtra: 0 },
            { id: 'bien_cocido', nombre: 'Bien cocido', precioExtra: 0 },
          ],
        },
      ],
    };

    const html = renderToStaticMarkup(
      <PlatoDetalleModal plato={plato} abierto={true} onCerrar={() => {}} soloLectura={true} />
    );

    expect(html).toContain('Costillas BBQ');
    expect(html).toContain('38.000');
    expect(html).toContain('Para pedir este plato, escanea el código QR en tu mesa o pídelo al mesero.');
    expect(html).toContain('Cerrar');
    expect(html).not.toMatch(/Añadir/i);
    expect(html).not.toMatch(/Disminuir cantidad/i);
    expect(html).not.toMatch(/Aumentar cantidad/i);
  });
});
