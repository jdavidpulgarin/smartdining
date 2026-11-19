import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import Contacto from './Contacto.jsx';
import restaurante from '../datos/restaurante.js';

describe('Contacto (fachada de mapa, horario y enlaces estilo póster)', () => {
  it('renderiza "Ven y" y "escríbenos" en el encabezado de dos líneas', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    expect(html).toContain('Ven y');
    expect(html).toContain('escríbenos');
    expect(html).toMatch(/<h2[^>]*id="contacto-titulo"[^>]*>[\s\S]*Ven y[\s\S]*escríbenos[\s\S]*<\/h2>/);
  });

  it('contiene enlaces para tel:, mailto: y wa.me con los datos reales', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    expect(html).toContain(`tel:${restaurante.telefono}`);
    expect(html).toContain(`mailto:${restaurante.correo}`);
    expect(html).toContain(`https://wa.me/${restaurante.whatsapp}`);
  });

  it('muestra las 3 redes sociales con sus URLs reales, cada una con su SVG aria-hidden="true", su texto y atributos seguros', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    expect(restaurante.redes.length).toBeGreaterThanOrEqual(3);
    for (const red of restaurante.redes) {
      expect(html).toContain(red.url);
      expect(html).toContain(red.nombre);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');

    // Cada red tiene su SVG en línea decorativo con aria-hidden="true"
    for (const red of restaurante.redes) {
      const regexRed = new RegExp(`<a[^>]*href="${red.url}"[^>]*>[\\s\\S]*?<svg[^>]*aria-hidden="true"[^>]*>[\\s\\S]*?<\\/svg>[\\s\\S]*?<span>${red.nombre}<\\/span>[\\s\\S]*?<\\/a>`);
      expect(html).toMatch(regexRed);
    }
  });

  it('renderiza la comanda con los 7 días y exactamente uno con aria-current="date"', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    expect(html).toContain('Lunes');
    expect(html).toContain('Martes');
    expect(html).toContain('Miércoles');
    expect(html).toContain('Jueves');
    expect(html).toContain('Viernes');
    expect(html).toContain('Sábado');
    expect(html).toContain('Domingo');

    const matchesAriaCurrent = html.match(/aria-current="date"/g) || [];
    expect(matchesAriaCurrent).toHaveLength(1);
  });

  it('en el HTML inicial NO hay <iframe> y sí el botón "Ver mapa" y el enlace "Cómo llegar"', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    // No hay iframe en la carga inicial
    expect(html).not.toContain('<iframe');

    // Sí están presentes el botón "Ver mapa" y el enlace a Google Maps
    expect(html).toContain('Ver mapa');
    expect(html).toContain('Cómo llegar');
    expect(html).toContain('https://www.google.com/maps?q=');
  });

  it('con mapaVisibleInicial: monta el <iframe> con title y loading="lazy"', () => {
    const html = renderToStaticMarkup(
      <Contacto datosRestaurante={restaurante} mapaVisibleInicial={true} />
    );

    // Iframe con title y loading="lazy"
    expect(html).toMatch(/<iframe[^>]*title="Mapa de [^"]+"[^>]*loading="lazy"/);
    expect(html).toMatch(/referrerpolicy="no-referrer-when-downgrade"/i);
    expect(html).toContain('output=embed');
  });

  it('Contacto con el marcador contiene "a7.5 7.5 0 1115 0z" y no contiene "11-15 0z"', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);
    expect(html).toContain('a7.5 7.5 0 1115 0z');
    expect(html).not.toContain('11-15 0z');
  });

  it('el correo lleva <wbr> después de la @ y no usa break-all', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    expect(html).toContain(`mailto:${restaurante.correo}`);
    expect(html).toContain('<wbr');
    expect(html).not.toMatch(/class="[^"]*\bbreak-all\b[^"]*"[^>]*>[^<]*<wbr/);
  });
});
