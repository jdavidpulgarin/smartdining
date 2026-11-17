import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Carta } from './Carta.jsx';

describe('Carta (sitio público)', () => {
  const menuMock = {
    categorias: [
      { id: 1, nombre: 'Entradas' },
      { id: 2, nombre: 'Parrilla' },
    ],
    platos: [
      {
        id: 101,
        categoriaId: 1,
        nombre: 'Empanadas de Carne',
        descripcion: 'Deliciosas empanadas artesanales',
        precio: 12000,
        imagen: 'https://images.unsplash.com/empanadas.jpg',
        disponible: true,
        etiquetas: ['sin_gluten'],
      },
      {
        id: 102,
        categoriaId: 2,
        nombre: 'Picaña a la Brasa',
        descripcion: 'Corte premium 350g',
        precio: 45000,
        imagen: null,
        disponible: false,
        etiquetas: [],
      },
    ],
    armables: [
      {
        id_plato: 201,
        nombre: 'Bowl Parrillero',
        descripcion: 'Arma tu combinación favorita',
        precio: 32000,
        url_imagen: 'https://images.unsplash.com/bowl.jpg',
        pasos: [
          {
            id_paso: 1,
            nombre: 'Base',
            obligatorio: true,
            min_sel: 1,
            max_sel: 1,
            ingredientes: [
              { id_ingrediente: 1, nombre: 'Arroz salvaje', precio_extra: 0, disponible: true },
              { id_ingrediente: 2, nombre: 'Quinoa', precio_extra: 2000, disponible: true },
            ],
          },
          {
            id_paso: 2,
            nombre: 'Proteína',
            obligatorio: true,
            min_sel: 1,
            max_sel: 1,
            ingredientes: [
              { id_ingrediente: 3, nombre: 'Lomo saltado', precio_extra: 5000, disponible: true },
              { id_ingrediente: 4, nombre: 'Pollo parrillero', precio_extra: 0, disponible: false },
            ],
          },
        ],
      },
    ],
  };

  const configMock = {
    nombre: 'SmartDining Steakhouse',
    direccion: 'Carrera 43A #1-50, Medellín',
    telefono: '+57 300 123 4567',
    correo: 'info@smartdining.com',
    horario: [
      { dia: 'Lunes', texto: '12:00 - 22:00' },
    ],
    redes: [
      { nombre: 'Instagram', valor: '@smartdining', url: 'https://instagram.com/smartdining' },
    ],
  };

  it('renderToStaticMarkup renderiza categorías, platos con precios y aviso de agotado', () => {
    const html = renderToStaticMarkup(
      <Carta menuInicial={menuMock} configInicial={configMock} />
    );

    // Renderiza categorías
    expect(html).toContain('Entradas');
    expect(html).toContain('Parrilla');

    // Renderiza platos
    expect(html).toContain('Empanadas de Carne');
    expect(html).toContain('Picaña a la Brasa');

    // Precios formateados en pesos colombianos
    expect(html).toContain('12.000');
    expect(html).toContain('45.000');

    // Marca de agotado para el plato no disponible
    expect(html).toContain('AGOTADO');
  });

  it('renderiza pasos e ingredientes de "Arma tu plato"', () => {
    const html = renderToStaticMarkup(
      <Carta menuInicial={menuMock} configInicial={configMock} />
    );

    expect(html).toContain('Bowl Parrillero');
    expect(html).toContain('Paso 1');
    expect(html).toContain('Base');
    expect(html).toContain('Arroz salvaje');
    expect(html).toContain('Quinoa');
    expect(html).toContain('Paso 2');
    expect(html).toContain('Proteína');
    expect(html).toContain('Lomo saltado');
    expect(html).toContain('Pollo parrillero');
    expect(html).toContain('Obligatorio · Elige 1');
  });

  it('renderiza la información del restaurante y enlaces seguros de redes', () => {
    const html = renderToStaticMarkup(
      <Carta menuInicial={menuMock} configInicial={configMock} />
    );

    expect(html).toContain('SmartDining Steakhouse');
    expect(html).toContain('Carrera 43A #1-50, Medellín');
    expect(html).toContain('+57 300 123 4567');
    expect(html).toContain('tel:+573001234567');
    expect(html).toContain('info@smartdining.com');
    expect(html).toContain('mailto:info@smartdining.com');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('NO contiene botones de añadir al carrito ni de enviar pedidos a cocina', () => {
    const html = renderToStaticMarkup(
      <Carta menuInicial={menuMock} configInicial={configMock} />
    );

    // No debe haber acciones de carrito o pedido interactivo en mesa
    expect(html).not.toMatch(/Añadir \d/i);
    expect(html).not.toMatch(/Agregar al carrito/i);
    expect(html).not.toMatch(/Enviar mi pedido/i);
    expect(html).not.toMatch(/Disminuir cantidad/i);
    expect(html).not.toMatch(/Aumentar cantidad/i);
  });
});
