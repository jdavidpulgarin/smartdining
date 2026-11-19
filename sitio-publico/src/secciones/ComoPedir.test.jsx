import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ComoPedir from './ComoPedir.jsx';

describe('Sección ComoPedir', () => {
  it('contiene 3 <svg aria-hidden="true"> decorativos con focusable="false" y ningún <img> de /img/como-pedir/', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    // 3 <svg aria-hidden="true">
    const svgs = html.match(/<svg[^>]*aria-hidden="true"[^>]*>/g) || [];
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) {
      expect(svg).toContain('focusable="false"');
      expect(svg).not.toContain('role="img"');
    }

    // Ningún <img> de /img/como-pedir/
    expect(html).not.toContain('/img/como-pedir/');
    expect(html).not.toMatch(/<img[^>]*como-pedir/);
  });

  it('contiene las clases pedir- presentes para ilustraciones y animaciones sincronizadas', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    expect(html).toContain('pedir-pasos');
    expect(html).toContain('pedir-card');
    expect(html).toContain('pedir-ilus');
    expect(html).toContain('pedir-tel');
    expect(html).toContain('pedir-laser');
    expect(html).toContain('pedir-flash');
    expect(html).toContain('pedir-ok');
    expect(html).toContain('pedir-esq');
    expect(html).toContain('pedir-ticket');
    expect(html).toContain('pedir-capa-0');
    expect(html).toContain('pedir-onda');
    expect(html).toContain('pedir-mas');
    expect(html).toContain('pedir-bill');
    expect(html).toContain('pedir-tarj');
    expect(html).toContain('pedir-vivo');
    expect(html).toContain('pedir-relleno');
    expect(html).toContain('pedir-nodo-1');
    expect(html).toContain('pedir-campana');
  });

  it('presenta los 3 pasos con sus títulos en orden', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    const pos1 = html.indexOf('Escanea el QR de tu mesa');
    const pos2 = html.indexOf('Arma tu pedido desde el celular');
    const pos3 = html.indexOf('Paga y sigue tu pedido en vivo');

    expect(pos1).toBeGreaterThanOrEqual(0);
    expect(pos2).toBeGreaterThan(pos1);
    expect(pos3).toBeGreaterThan(pos2);
  });
});
