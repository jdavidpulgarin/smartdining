import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { App, obtenerSecciones } from './App.jsx';
import { obtenerMenuPublico } from './services/menuService.js';
import * as apiModule from './services/api.js';
import restaurante from './datos/restaurante.js';
import { elegirFuentePortada } from './utils/portada.js';

describe('App y Sitio Público Completo', () => {
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
            nombre: 'Arepa Rellena',
            descripcion: 'Arepa artesanal rellena a tu gusto.',
            precio: '14000',
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
                  { id_ingrediente: 1, nombre: 'Arepa de Maíz', precio_extra: 0, disponible: true },
                ],
              },
            ],
          },
          {
            id_plato: 202,
            nombre: 'Bowl Personalizado',
            descripcion: 'Arma tu combinación favorita',
            precio: '28000',
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
                  { id_ingrediente: 2, nombre: 'Quinoa', precio_extra: 2000, disponible: true },
                ],
              },
            ],
          },
          {
            id_plato: 203,
            nombre: 'Wrap Personalizado',
            descripcion: 'Wrap fresco enrollado a tu gusto.',
            precio: '22000',
            url_imagen: '/imagenes/wrap.webp',
            disponible: true,
            personalizable: true,
            pasos: [
              {
                id_paso: 1,
                nombre: 'Tortilla',
                obligatorio: true,
                min_sel: 1,
                max_sel: 1,
                ingredientes: [
                  { id_ingrediente: 3, nombre: 'Integral', precio_extra: 0, disponible: true },
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

  it('hay exactamente un <h1>; existen header, nav, main#contenido y footer; el enlace "Saltar al contenido" va primero', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} />);

    // Exactamente un <h1>
    const h1Matches = html.match(/<h1[^>]*>.*?<\/h1>/g);
    expect(h1Matches).not.toBeNull();
    expect(h1Matches).toHaveLength(1);
    expect(h1Matches[0]).toContain(restaurante.nombre);

    // Existen elementos semánticos principales
    expect(html).toContain('<header');
    expect(html).toContain('<nav');
    expect(html).toContain('<main id="contenido"');
    expect(html).toContain('<footer');

    // El enlace "Saltar al contenido" va primero antes de main
    const indiceSalto = html.indexOf('href="#contenido"');
    const indiceHeader = html.indexOf('<header');
    const indiceMain = html.indexOf('<main id="contenido"');

    expect(indiceSalto).toBeGreaterThanOrEqual(0);
    expect(indiceHeader).toBeLessThan(indiceSalto);
    expect(indiceSalto).toBeLessThan(indiceMain);
    expect(html).toContain('Saltar al contenido');
  });

  it('las secciones aparecen en el orden pedido y cada enlace del nav apunta a un id que existe', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} />);

    const ordenEsperado = [
      'inicio',
      'nosotros',
      'carta',
      'como-pedir',
      'proximamente',
      'contacto',
    ];

    let posicionAnterior = -1;
    for (const idSec of ordenEsperado) {
      const pos = html.indexOf(`id="${idSec}"`);
      expect(pos).toBeGreaterThanOrEqual(0);
      expect(pos).toBeGreaterThan(posicionAnterior);
      posicionAnterior = pos;
    }

    // Cada enlace de secciones en el nav apunta a un id existente
    const secciones = obtenerSecciones();
    for (const sec of secciones) {
      const idSinHash = sec.href.replace('#', '');
      expect(html).toContain(`id="${idSinHash}"`);
      expect(html).toContain(`href="${sec.href}"`);
    }
  });

  it('Inicio en el HTML inicial: tiene la <img> del póster con fetchpriority="high" y NO tiene <video>; es la única imagen con fetchpriority', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} />);

    // Póster en HTML inicial
    expect(html).toMatch(/<img[^>]*src="\/videos\/portada-poster\.webp"[^>]*fetchpriority="high"/i);

    // En HTML estático inicial (SSR) NO se monta el video
    expect(html).not.toMatch(/<video[^>]*src="\/videos\/portada/);

    // Es la ÚNICA imagen con fetchpriority
    const matchesFetchPriority = html.match(/<img[^>]*fetchpriority/gi);
    expect(matchesFetchPriority).not.toBeNull();
    expect(matchesFetchPriority).toHaveLength(1);
  });

  it('elegirFuentePortada responde a reducedMotion, saveData y ancho de pantalla', () => {
    expect(elegirFuentePortada({ anchoPantalla: 1024, prefs: { reducedMotion: true } })).toBeNull();
    expect(elegirFuentePortada({ anchoPantalla: 1024, prefs: { prefersReducedMotion: true } })).toBeNull();
    expect(elegirFuentePortada({ anchoPantalla: 1024, prefs: { saveData: true } })).toBeNull();
    expect(elegirFuentePortada({ anchoPantalla: 400, prefs: {} })).toBe('/videos/portada-480.mp4');
    expect(elegirFuentePortada({ anchoPantalla: 1280, prefs: {} })).toBe('/videos/portada.mp4');
  });

  it('videos dentro de los armables: Arepa Rellena y Bowl Personalizado tienen su <video> con los atributos requeridos e insignia "Video generado con IA"', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} datosRestaurante={restaurante} />);

    // No debe existir la sección #videos ni su enlace en el nav
    expect(html).not.toContain('id="videos"');
    expect(html).not.toContain('href="#videos"');

    // Debe contener las tarjetas de Arepa Rellena y Bowl Personalizado
    expect(html).toContain('Arepa Rellena');
    expect(html).toContain('Bowl Personalizado');

    const videoTags = html.match(/<video[^>]*src="\/videos\/(arepa|bowl)\.mp4"[^>]*>/g) || [];
    expect(videoTags).toHaveLength(2);

    for (const tag of videoTags) {
      expect(tag).toContain('muted');
      expect(tag).toMatch(/loop/i);
      expect(tag).toMatch(/playsinline/i);
      expect(tag).toContain('preload="none"');
      expect(tag).toContain('poster=');
      expect(tag).toContain('aria-hidden="true"');
    }

    // Insignia de IA en los armables
    const matchesIA = html.match(/Video generado con IA/g) || [];
    expect(matchesIA.length).toBeGreaterThanOrEqual(2);

    // Crédito en Bowl Personalizado
    expect(html).toContain('Imagen base: Freepik');
  });

  it('Wrap Personalizado NO tiene video: muestra <img> normal y ningún <video>', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} datosRestaurante={restaurante} />);

    expect(html).toContain('Wrap Personalizado');
    expect(html).not.toMatch(/<video[^>]*wrap/i);
  });

  it('el iframe tiene title y loading="lazy"; WhatsApp usa https://wa.me/573046654848; las redes tienen rel="noopener noreferrer"', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} />);

    // Iframe con title y loading="lazy"
    expect(html).toMatch(/<iframe[^>]*title="Mapa de [^"]+"[^>]*loading="lazy"/);

    // Enlace a WhatsApp
    expect(html).toContain('https://wa.me/573046654848');

    // Redes sociales seguras
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it('todas las <img> tienen alt (o alt=""), width y height', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} />);

    // Extraer todas las etiquetas <img>
    const imgTags = html.match(/<img[^>]*>/g) || [];
    expect(imgTags.length).toBeGreaterThan(0);

    for (const tag of imgTags) {
      expect(tag).toMatch(/alt=["'][^"']*["']/);
      expect(tag).toMatch(/width=["'][^"']+["']/);
      expect(tag).toMatch(/height=["'][^"']+["']/);
    }
  });

  it('Próximamente no contiene <a> ni <button>; el pie contiene "Proyecto académico · UPC"', async () => {
    const menu = await obtenerMenuPublico();
    const html = renderToStaticMarkup(<App menuInicial={menu} />);

    // Extraer la sección próximamente
    const inicioProximamente = html.indexOf('id="proximamente"');
    const inicioContacto = html.indexOf('id="contacto"');
    const seccionProximamente = html.slice(inicioProximamente, inicioContacto);

    expect(seccionProximamente).not.toMatch(/<a[\s>]/);
    expect(seccionProximamente).not.toMatch(/<button[\s>]/);

    // Pie contiene información académica
    expect(html).toContain('Proyecto académico · UPC');
  });

  it('con origen "fija" aparece "Carta de referencia"; con "vivo" no aparece', async () => {
    // 1. Con origen 'fija'
    const menuFijo = {
      categorias: [{ id: 1, nombre: 'Entradas', orden: 1 }],
      platos: [],
      armables: [],
      origen: 'fija',
    };
    const htmlFija = renderToStaticMarkup(<App menuInicial={menuFijo} />);
    expect(htmlFija).toContain('Carta de referencia: precios y disponibilidad pueden cambiar.');

    // 2. Con origen 'vivo'
    const menuVivo = {
      categorias: [{ id: 1, nombre: 'Entradas', orden: 1 }],
      platos: [],
      armables: [],
      origen: 'vivo',
    };
    const htmlVivo = renderToStaticMarkup(<App menuInicial={menuVivo} />);
    expect(htmlVivo).not.toContain('Carta de referencia: precios y disponibilidad pueden cambiar.');
  });
});
