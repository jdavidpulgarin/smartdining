import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlatoDetalleModal, {
  calcularCaloriasArmable,
} from './PlatoDetalleModal.jsx';

describe('PlatoDetalleModal (soloLectura)', () => {
  it('renderiza información del plato normal sin selector de cantidad ni botón de añadir', () => {
    const plato = {
      id: 1,
      nombre: 'Costillas BBQ',
      descripcion: 'Costillas de cerdo ahumadas con salsa BBQ casera',
      precio: 38000,
      imagen: 'https://images.unsplash.com/ribs.jpg',
      disponible: true,
      alergenos: ['gluten'],
    };

    const html = renderToStaticMarkup(
      <PlatoDetalleModal plato={plato} abierto={true} onCerrar={() => {}} />
    );

    expect(html).toContain('Costillas BBQ');
    expect(html).toContain('38.000');
    expect(html).toContain('Para pedir, escanea el código QR de tu mesa.');
    expect(html).toContain('Cerrar');
    expect(html).not.toMatch(/Añadir/i);
    expect(html).not.toMatch(/Disminuir cantidad/i);
    expect(html).not.toMatch(/Aumentar cantidad/i);
  });

  it('detalle de un plato armable (Arepa Rellena): muestra el paso a paso ("Así lo armas"), los 3-4 pasos con sus reglas, los ingredientes con sus fotos, "180 kcal" en la de maíz, "+$ 1.500" en la de chócolo y el cálculo de calorías con "Desde"', () => {
    const arepaRellena = {
      id_plato: 201,
      nombre: 'Arepa Rellena',
      descripcion: 'Arepa artesanal rellena a tu gusto.',
      precio: 14000,
      url_imagen: '/imagenes/arepa.webp',
      disponible: true,
      personalizable: true,
      pasos: [
        {
          id_paso: 1,
          nombre: 'Tipo de Arepa',
          obligatorio: true,
          min_sel: 1,
          max_sel: 1,
          ingredientes: [
            {
              id_ingrediente: 1,
              nombre: 'Arepa de Maíz',
              calorias: 180,
              precio_extra: 0,
              url_imagen: '/imagenes/arepa-maiz.webp',
              disponible: true,
            },
            {
              id_ingrediente: 2,
              nombre: 'Arepa de Chócolo',
              calorias: 220,
              precio_extra: 1500,
              url_imagen: '/imagenes/arepa-chocolo.webp',
              disponible: true,
            },
          ],
        },
        {
          id_paso: 2,
          nombre: 'Elige tu Relleno',
          obligatorio: true,
          min_sel: 1,
          max_sel: 1,
          ingredientes: [
            {
              id_ingrediente: 3,
              nombre: 'Pollo desmechado',
              calorias: 220,
              precio_extra: 0,
              url_imagen: '/imagenes/pollo.webp',
              disponible: true,
            },
            {
              id_ingrediente: 4,
              nombre: 'Carne desmechada',
              calorias: 260,
              precio_extra: 1000,
              url_imagen: '/imagenes/carne.webp',
              disponible: true,
            },
          ],
        },
        {
          id_paso: 3,
          nombre: 'Añade Extras',
          obligatorio: false,
          min_sel: 0,
          max_sel: 3,
          ingredientes: [
            {
              id_ingrediente: 5,
              nombre: 'Queso doble crema',
              calorias: 120,
              precio_extra: 2000,
              url_imagen: '/imagenes/queso.webp',
              disponible: true,
            },
          ],
        },
      ],
    };

    const calsCalculadas = calcularCaloriasArmable(arepaRellena.pasos);
    expect(calsCalculadas).toBe(400); // 180 (min paso 1) + 220 (min paso 2)

    const html = renderToStaticMarkup(
      <PlatoDetalleModal
        plato={arepaRellena}
        abierto={true}
        onCerrar={() => {}}
      />
    );

    // Encabezado y precio armable
    expect(html).toContain('Arepa Rellena');
    expect(html).toContain('Desde');
    expect(html).toContain('14.000');

    // Cálculo de calorías mínimas
    expect(html).toContain('Desde 400 kcal');

    // Sección "Así lo armas"
    expect(html).toContain('Así lo armas');

    // Pasos y reglas
    expect(html).toContain('Tipo de Arepa');
    expect(html).toContain('Obligatorio · Elige 1');
    expect(html).toContain('Añade Extras');
    expect(html).toContain('Opcional · Hasta 3');

    // Ingredientes y calorías/precio
    expect(html).toContain('Arepa de Maíz');
    expect(html).toContain('180 kcal');
    expect(html).toContain('Arepa de Chócolo');
    expect(html).toContain('1.500');

    // Fotos de ingredientes
    expect(html).toContain('src="/imagenes/arepa-maiz.webp"');
    expect(html).toContain('src="/imagenes/arepa-chocolo.webp"');

    // Pie del modal
    expect(html).toContain('Para pedir, escanea el código QR de tu mesa.');
    expect(html).toContain('Cerrar');
  });

  it('detalle de un plato normal (Alitas BBQ): muestra foto, precio, descripción completa, NO muestra la sección "Así lo armas", y NO muestra ficha de calorías porque son null', () => {
    const alitas = {
      id: 301,
      nombre: 'Alitas BBQ x8',
      descripcion:
        'Ocho alitas crujientes bañadas en salsa BBQ dulce y ahumada.',
      precio: 26000,
      imagen: 'https://images.unsplash.com/wings.jpg',
      disponible: true,
      calorias: null,
      tiempo_estimado: 20,
      alergenos: ['gluten'],
    };

    const html = renderToStaticMarkup(
      <PlatoDetalleModal plato={alitas} abierto={true} onCerrar={() => {}} />
    );

    expect(html).toContain('Alitas BBQ x8');
    expect(html).toContain('26.000');
    expect(html).toContain(
      'Ocho alitas crujientes bañadas en salsa BBQ dulce y ahumada.'
    );
    expect(html).toContain('20 min');

    // NO muestra "Así lo armas"
    expect(html).not.toContain('Así lo armas');

    // NO muestra calorías
    expect(html).not.toContain('kcal');

    // Alérgenos
    expect(html).toContain('Gluten');

    // Pie
    expect(html).toContain('Para pedir, escanea el código QR de tu mesa.');
    expect(html).toContain('Cerrar');
  });
});