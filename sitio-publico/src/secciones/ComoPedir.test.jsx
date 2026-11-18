import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ComoPedir from './ComoPedir.jsx';

describe('Sección ComoPedir', () => {
  it('contiene 3 <img> con src de los .svg, width="320", height="220", alt="" y loading="lazy"; ya no contiene ".webp" ni "Capturas reales"', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    // Paso 1
    expect(html).toContain('src="/img/como-pedir/paso-1-escanear.svg"');
    // Paso 2
    expect(html).toContain('src="/img/como-pedir/paso-2-pedir.svg"');
    // Paso 3
    expect(html).toContain('src="/img/como-pedir/paso-3-pagar.svg"');

    // Todas las imágenes deben tener width="320", height="220", alt="" y loading="lazy"
    const imgs = html.match(/<img[^>]*>/g) || [];
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img).toContain('width="320"');
      expect(img).toContain('height="220"');
      expect(img).toContain('alt=""');
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('decoding="async"');
    }

    // Ya no contiene .webp ni "Capturas reales"
    expect(html).not.toContain('.webp');
    expect(html).not.toContain('Capturas reales');
  });

  it('presenta los 3 títulos en orden', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    const pos1 = html.indexOf('Escanea el QR de tu mesa');
    const pos2 = html.indexOf('Arma tu pedido desde el celular');
    const pos3 = html.indexOf('Paga desde la mesa y sigue tu pedido en vivo');

    expect(pos1).toBeGreaterThanOrEqual(0);
    expect(pos2).toBeGreaterThan(pos1);
    expect(pos3).toBeGreaterThan(pos2);
  });
});
