import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Carta } from './Carta.jsx';
import { obtenerMenuPublico } from './services/menuService.js';
import * as apiModule from './services/api.js';
import restaurante from './datos/restaurante.js';

describe('Carta (sitio público)', () => {
  const rawMenuBackend = {
    categorias: [
      {
        id_categoria: 1,
        categoria: 'Entradas',
        orden: 1,
        platos: [
          {
            id_plato: 101,
            nombre: 'Empanadas de Carne',
            descripcion: 'Deliciosas empanadas artesanales',
            precio: '12000',
            url_imagen: 'https://images.unsplash.com/empanadas.jpg',
            disponible: true,
            personalizable: false,
            etiquetas: ['sin_gluten'],
          },
        ],
      },
      {
        id_categoria: 2,
        categoria: 'Parrilla',
        orden: 2,
        platos: [
          {
            id_plato: 102,
            nombre: 'Picaña a la Brasa',
            descripcion: 'Corte premium 350g',
            precio: '45000',
            url_imagen: null,
            disponible: false,
            personalizable: false,
            etiquetas: [],
          },
          {
            id_plato: 201,
            nombre: 'Bowl Parrillero',
            descripcion: 'Arma tu combinación favorita',
            precio: '32000',
            url_imagen: 'https://images.unsplash.com/bowl.jpg',
            disponible: true,
            personalizable: true,
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
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async (ruta) => {
      if (ruta.includes('menu')) {
        return rawMenuBackend;
      }
      return null;
    });
  });

  it('renderToStaticMarkup renderiza categorías, platos con precios y aviso de agotado', async () => {
    const menu = await obtenerMenuPublico();

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} />
    );

    // Renderiza categorías adaptadas desde la respuesta cruda del backend
    expect(html).toContain('Entradas');
    expect(html).toContain('Parrilla');

    // Renderiza platos
    expect(html).toContain('Empanadas de Carne');
    expect(html).toContain('Picaña a la Brasa');

    // Precios formateados en pesos colombianos
    expect(html).toContain('12.000');
    expect(html).toContain('45.000');

    // Marca de agotado para el plato no disponible (plato 102 con disponible=false)
    expect(html).toContain('AGOTADO');
  });

  it('renderiza pasos e ingredientes de "Arma tu plato"', async () => {
    const menu = await obtenerMenuPublico();

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} />
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

  it('renderiza la información fija del restaurante y enlaces seguros de redes', async () => {
    const menu = await obtenerMenuPublico();

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} />
    );

    expect(html).toContain(restaurante.nombre);
    expect(html).toContain('Carrera 9 # 16-45, Centro');
    expect(html).toContain(restaurante.telefonoVisible);
    expect(html).toContain(`tel:${restaurante.telefono}`);
    expect(html).toContain(restaurante.correo);
    expect(html).toContain(`mailto:${restaurante.correo}`);
    expect(html).toContain(restaurante.horarioVisible);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('NO contiene botones de añadir al carrito ni de enviar pedidos a cocina', async () => {
    const menu = await obtenerMenuPublico();

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} />
    );

    // No debe haber acciones de carrito o pedido interactivo en mesa
    expect(html).not.toMatch(/Añadir \d/i);
    expect(html).not.toMatch(/Agregar al carrito/i);
    expect(html).not.toMatch(/Enviar mi pedido/i);
    expect(html).not.toMatch(/Disminuir cantidad/i);
    expect(html).not.toMatch(/Aumentar cantidad/i);
  });

  it('si la API falla, la Carta muestra el respaldo de la carta fija y la información del local', async () => {
    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async () => {
      throw new apiModule.ErrorApi({ status: 500, mensaje: 'Error del servidor' });
    });

    const menu = await obtenerMenuPublico();
    expect(menu.origen).toBe('fija');

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} />
    );

    // Muestra platos de la carta fija sin romperse
    expect(html).toContain('Carta');
    expect(html).toContain(restaurante.nombre);
    expect(html).toContain('Carrera 9 # 16-45, Centro');
    expect(html).not.toContain('No pudimos cargar la carta');
  });
});
