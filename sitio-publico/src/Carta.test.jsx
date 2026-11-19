import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { Carta } from './Carta.jsx';
import CartaSeccion from './secciones/Carta.jsx';
import DialogoSimuladorPlato from './components/menu/DialogoSimuladorPlato.jsx';
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

    const html = renderToStaticMarkup(<Carta menuInicial={menu} />);

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

  it('renderiza título de dos líneas con "Nuestra" y "Carta" en el h2', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<CartaSeccion menu={menu} />);

    expect(html).toContain('Nuestra');
    expect(html).toContain('Carta');
    expect(html).toMatch(/<h2[^>]*id="carta-titulo"[^>]*>[\s\S]*Nuestra[\s\S]*Carta[\s\S]*<\/h2>/);
  });

  it('con la carta fija aparecen en "Todas" TODOS los platos no personalizables en UNA sola cuadrícula sin subtítulos de categoría dentro de "Toda la carta", sin repetir armables', async () => {
    vi.spyOn(apiModule, 'pedirJson').mockImplementation(async () => {
      throw new apiModule.ErrorApi({ status: 500, mensaje: 'Error' });
    });

    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<CartaSeccion menu={menu} datosRestaurante={restaurante} />);

    expect(html).toContain('Los más pedidos');
    expect(html).toContain('Toda la carta');

    const todaLaCartaPos = html.indexOf('Toda la carta');
    const armaTuPlatoPos = html.indexOf('id="arma-tu-plato"');
    const soloTodaLaCarta = html.slice(todaLaCartaPos, armaTuPlatoPos);

    // En "Todas" ya no hay subtítulos de categoría dentro de "Toda la carta"
    expect(soloTodaLaCarta).not.toMatch(/<h4[^>]*>/);
    expect(soloTodaLaCarta).not.toContain('Hamburguesas &amp; Fuertes');
    expect(soloTodaLaCarta).not.toContain('Bebidas &amp; Cocteles');

    // Platos incluidos en "Toda la carta", incluidos destacados y adicionales
    expect(soloTodaLaCarta).toContain('Nachos Supremos');
    expect(soloTodaLaCarta).toContain('Costillas BBQ St. Louis');
    expect(soloTodaLaCarta).toContain('Hamburguesa Smart Angus');
    expect(soloTodaLaCarta).toContain('Aguacate Extra');
    expect(soloTodaLaCarta).toContain('Alitas BBQ x8');
    expect(soloTodaLaCarta).toContain('Cerveza Artesanal IPA');

    // Todos los platos no personalizables aparecen con su tarjeta y su <img>
    for (const plato of menu.platos) {
      expect(soloTodaLaCarta).toContain(plato.nombre);
    }
    const imgsEnTodaLaCarta = (soloTodaLaCarta.match(/<img[^>]+>/g) || []).length;
    expect(imgsEnTodaLaCarta).toBeGreaterThanOrEqual(menu.platos.length);

    // Los armables no se repiten en "Toda la carta"
    for (const armable of menu.armables) {
      expect(soloTodaLaCarta).not.toContain(armable.nombre);
    }

    // Las tarjetas muestran el precio con la clase etiqueta-precio
    expect(html).toContain('etiqueta-precio');
  });

  it('los nombres de los platos llevan line-clamp-2 y title', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<CartaSeccion menu={menu} />);

    expect(html).toMatch(/<h3[^>]*title="Empanadas de Carne"[^>]*class="[^"]*line-clamp-2[^"]*"[^>]*>/);
  });

  it('en la categoría adicionales se muestran las tarjetas con foto en cuadrícula y la nota', () => {
    const menuConAdicionales = {
      categorias: [{ id: 99, nombre: 'Adicionales', orden: 9 }],
      platos: [
        {
          id: 501,
          categoriaId: 99,
          nombre: 'Aguacate Extra',
          descripcion: 'Porción fresca de aguacate hass',
          precio: 4000,
          disponible: true,
          url_imagen: 'https://images.unsplash.com/aguacate.jpg',
        },
      ],
      armables: [],
      origen: 'fija',
    };

    // Renderizamos la sección simulando que la categoría seleccionada es Adicionales
    const html = renderToStaticMarkup(
      <CartaSeccion menu={menuConAdicionales} categoriaInicial={99} />
    );

    expect(html).toContain('Adicionales');
    expect(html).toContain('Aguacate Extra');
    expect(html).toContain('4.000');
    expect(html).toContain('Pídelos junto a cualquiera de tus platos.');
    expect(html).toMatch(/<img[^>]*src="https:\/\/images\.unsplash\.com\/aguacate\.jpg"/);
  });

  it('tarjeta armable y simulador de "Arma tu plato": tarjeta contiene "Personalizable", "Desde" y "Ver ingredientes", y el diálogo renderiza pasos e ingredientes', () => {
    const bowlParrillero = rawMenuBackend.categorias[1].platos[1];

    // 1. Tarjeta en la carta
    const menu = {
      categorias: [{ id: 1, nombre: 'Parrilla' }],
      platos: [],
      armables: [bowlParrillero],
      origen: 'fija',
    };
    const htmlCarta = renderToStaticMarkup(<CartaSeccion menu={menu} />);

    expect(htmlCarta).toContain('Bowl Parrillero');
    expect(htmlCarta).toContain('Personalizable');
    expect(htmlCarta).toContain('Desde');
    expect(htmlCarta).toContain('etiqueta-precio');
    expect(htmlCarta).toContain('Ver ingredientes');
    expect(htmlCarta).toContain('Base, Proteína');

    // 2. Diálogo del simulador
    const htmlDialogo = renderToStaticMarkup(
      <DialogoSimuladorPlato plato={bowlParrillero} abierto={true} onCerrar={() => {}} />
    );

    expect(htmlDialogo).toContain('Bowl Parrillero');
    expect(htmlDialogo).toContain('Paso 1');
    expect(htmlDialogo).toContain('Base');
    expect(htmlDialogo).toContain('Arroz salvaje');
    expect(htmlDialogo).toContain('Quinoa');
    expect(htmlDialogo).toContain('Paso 2');
    expect(htmlDialogo).toContain('Proteína');
    expect(htmlDialogo).toContain('Lomo saltado');
    expect(htmlDialogo).toContain('Pollo parrillero');
    expect(htmlDialogo).toContain('Obligatorio, elige 1');
    expect(htmlDialogo).toContain('Agotado');
  });

  it('renderiza la información fija del restaurante y enlaces seguros de redes', async () => {
    const menu = await obtenerMenuPublico();

    const html = renderToStaticMarkup(<Carta menuInicial={menu} />);

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

    const html = renderToStaticMarkup(<Carta menuInicial={menu} />);

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

    const html = renderToStaticMarkup(<Carta menuInicial={menu} />);

    // Muestra platos de la carta fija sin romperse
    expect(html).toContain('Carta');
    expect(html).toContain(restaurante.nombre);
    expect(html).toContain('Carrera 9 # 16-45, Centro');
    expect(html).not.toContain('No pudimos cargar la carta');
  });
});
