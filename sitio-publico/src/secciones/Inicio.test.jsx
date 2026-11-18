import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import Inicio from './Inicio.jsx';
import restaurante from '../datos/restaurante.js';

describe('Sección Inicio (Hero Póster)', () => {
  it('renderiza h1 con id="titulo-inicio" y "SmartDining Restaurante" en sr-only, más las piezas SMART, DINING y RESTAURANTE', () => {
    const html = renderToStaticMarkup(<Inicio datosRestaurante={restaurante} />);

    expect(html).toContain('id="titulo-inicio"');
    expect(html).toMatch(/<span[^>]*class="[^"]*sr-only[^"]*"[^>]*>SmartDining Restaurante<\/span>/);
    expect(html).toContain('RESTAURANTE');
    expect(html).toContain('SMART');
    expect(html).toContain('DINING');
  });

  it('incluye el póster LCP con fetchpriority="high"', () => {
    const html = renderToStaticMarkup(<Inicio datosRestaurante={restaurante} />);

    expect(html).toContain('src="/videos/portada-poster.webp"');
    expect(html).toMatch(/fetchpriority="high"/i);
  });

  it('contiene el anillo circular SVG aria-hidden con textPath "SABOR VALLENATO"', () => {
    const html = renderToStaticMarkup(<Inicio datosRestaurante={restaurante} />);

    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*<textPath[^>]*>[\s\S]*SABOR VALLENATO[\s\S]*<\/textPath>[\s\S]*<\/svg>/);
  });

  it('renderiza la cinta estática con <ul> y los 4 textos de llamado a la acción', () => {
    const html = renderToStaticMarkup(<Inicio datosRestaurante={restaurante} />);

    expect(html).toMatch(/<ul[^>]*>[\s\S]*PIDE DESDE TU MESA[\s\S]*ESCANEA EL QR[\s\S]*SIGUE TU PEDIDO EN VIVO[\s\S]*SIN APPS[\s\S]*<\/ul>/);
    expect(html).toContain('PIDE DESDE TU MESA');
    expect(html).toContain('ESCANEA EL QR');
    expect(html).toContain('SIGUE TU PEDIDO EN VIVO');
    expect(html).toContain('SIN APPS');
  });

  it('muestra el ticket con estado "ABIERTO" o "CERRADO"', () => {
    const html = renderToStaticMarkup(<Inicio datosRestaurante={restaurante} />);

    const tieneAbiertoOCerrado = html.includes('ABIERTO') || html.includes('CERRADO');
    expect(tieneAbiertoOCerrado).toBe(true);
  });
});
