import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import Contacto from './Contacto.jsx';
import restaurante from '../datos/restaurante.js';

describe('Contacto (fachada de mapa y horario)', () => {
  it('en el HTML inicial NO hay <iframe> y sí el botón "Ver mapa" y el enlace "Abrir en Google Maps"', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);

    // No hay iframe en la carga inicial (fachada para ahorro de datos y rendimiento)
    expect(html).not.toContain('<iframe');

    // Sí están presentes el botón "Ver mapa" y el enlace "Abrir en Google Maps"
    expect(html).toContain('Ver mapa');
    expect(html).toContain('Abrir en Google Maps');
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

    // El enlace exterior a Google Maps sigue visible
    expect(html).toContain('Abrir en Google Maps');
  });

  it('Contacto con el marcador contiene "a7.5 7.5 0 1115 0z" y no contiene "11-15 0z"', () => {
    const html = renderToStaticMarkup(<Contacto datosRestaurante={restaurante} />);
    expect(html).toContain('a7.5 7.5 0 1115 0z');
    expect(html).not.toContain('11-15 0z');
  });
});
