import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Carta } from './Carta.jsx';
import { obtenerMenuPublico } from './services/menuService.js';
import * as apiModule from './services/api.js';
import {
  obtenerConfiguracionPublica,
  recargarConfiguracion,
} from './services/configuracionService.js';

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

  const rawConfigBackend = {
    nombre: 'SmartDining Steakhouse',
    direccion: 'Carrera 43A #1-50, Medellín',
    telefono: '+57 300 123 4567',
    correo: 'info@smartdining.com',
    horario: {
      lunes: { abre: '12:00', cierra: '22:00' },
    },
    redes: {
      instagram: 'https://instagram.com/smartdining',
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    recargarConfiguracion();

    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async (ruta) => {
      if (ruta.includes('configuracion')) {
        return rawConfigBackend;
      }
      if (ruta.includes('menu')) {
        return rawMenuBackend;
      }
      return null;
    });
  });

  it('renderToStaticMarkup renderiza categorías, platos con precios y aviso de agotado', async () => {
    const menu = await obtenerMenuPublico();
    const config = await obtenerConfiguracionPublica({ forzar: true });

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} configuracionInicial={config} />
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
    const config = await obtenerConfiguracionPublica({ forzar: true });

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} configuracionInicial={config} />
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

  it('renderiza la información del restaurante y enlaces seguros de redes', async () => {
    const menu = await obtenerMenuPublico();
    const config = await obtenerConfiguracionPublica({ forzar: true });

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} configuracionInicial={config} />
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

  it('NO contiene botones de añadir al carrito ni de enviar pedidos a cocina', async () => {
    const menu = await obtenerMenuPublico();
    const config = await obtenerConfiguracionPublica({ forzar: true });

    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} configuracionInicial={config} />
    );

    // No debe haber acciones de carrito o pedido interactivo en mesa
    expect(html).not.toMatch(/Añadir \d/i);
    expect(html).not.toMatch(/Agregar al carrito/i);
    expect(html).not.toMatch(/Enviar mi pedido/i);
    expect(html).not.toMatch(/Disminuir cantidad/i);
    expect(html).not.toMatch(/Aumentar cantidad/i);
  });

  it('Carta renderizada después de que la configuración falló no contiene "El Poblado" ni "+57 604" y muestra mensaje de error de contacto', async () => {
    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async (ruta) => {
      if (ruta.includes('configuracion')) {
        throw new apiModule.ErrorApi({ status: 500, mensaje: 'Error interno' });
      }
      if (ruta.includes('menu')) {
        return rawMenuBackend;
      }
      return null;
    });

    // La llamada real al servicio falla
    await expect(obtenerConfiguracionPublica({ forzar: true })).rejects.toThrow();

    const menu = await obtenerMenuPublico();

    // Carta montada con configuración fallida
    const html = renderToStaticMarkup(
      <Carta menuInicial={menu} configuracionInicial={null} errorConfiguracion={true} />
    );

    expect(html).not.toContain('El Poblado');
    expect(html).not.toContain('+57 604');
    expect(html).toContain('No pudimos cargar el horario y el contacto. Intenta más tarde.');
  });
});
