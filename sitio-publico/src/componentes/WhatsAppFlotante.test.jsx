import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import WhatsAppFlotante from './WhatsAppFlotante.jsx';
import restaurante from '../datos/restaurante.js';

describe('WhatsAppFlotante', () => {
  it('con visibleInicial y sin oculto: renderiza el enlace con wa.me, rel="noopener noreferrer" y aria-label', () => {
    const html = renderToStaticMarkup(
      <WhatsAppFlotante
        datosRestaurante={restaurante}
        visibleInicial={true}
        oculto={false}
      />
    );

    expect(html).toContain('https://wa.me/573046654848');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain(
      `aria-label="Escribir por WhatsApp a ${restaurante.nombre} (se abre en otra pestaña)"`
    );
    expect(html).toContain('svg');
    expect(html).toContain('aria-hidden="true"');
  });

  it('con oculto: no renderiza el enlace', () => {
    const html = renderToStaticMarkup(
      <WhatsAppFlotante
        datosRestaurante={restaurante}
        visibleInicial={true}
        oculto={true}
      />
    );

    expect(html).not.toContain('https://wa.me/573046654848');
    expect(html).not.toContain('<a');
    expect(html).toBe('');
  });

  it('sin visibleInicial: no renderiza el enlace (aún se encuentra en la portada)', () => {
    const html = renderToStaticMarkup(
      <WhatsAppFlotante datosRestaurante={restaurante} />
    );

    expect(html).not.toContain('https://wa.me/573046654848');
    expect(html).not.toContain('<a');
    expect(html).toBe('');
  });

  it('no contiene "w-[56px]" ni "h-[56px]" y sí "w-14" y "h-14"', () => {
    const html = renderToStaticMarkup(
      <WhatsAppFlotante datosRestaurante={restaurante} visibleInicial={true} />
    );

    expect(html).not.toContain('w-[56px]');
    expect(html).not.toContain('h-[56px]');
    expect(html).toContain('w-14');
    expect(html).toContain('h-14');
  });
});
