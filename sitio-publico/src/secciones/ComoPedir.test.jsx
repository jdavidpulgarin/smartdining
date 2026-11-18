import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import ComoPedir from './ComoPedir.jsx';

describe('Sección ComoPedir', () => {
  it('contiene 3 <img> con las rutas de /img/como-pedir/, alt no vacío, width/height y loading="lazy"', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    // Paso 1
    expect(html).toContain('src="/img/como-pedir/paso-1-qr.webp"');
    expect(html).toContain('width="602"');
    expect(html).toContain('height="520"');
    expect(html).toContain('alt="Pantalla de la mesa con el código QR para entrar a la carta"');

    // Paso 2
    expect(html).toContain('src="/img/como-pedir/paso-2-carta.webp"');
    expect(html).toContain('width="540"');
    expect(html).toContain('height="960"');
    expect(html).toContain('alt="Carta en el celular con la sección Arma tu plato"');

    // Paso 3
    expect(html).toContain('src="/img/como-pedir/paso-3-seguimiento.webp"');
    expect(html).toContain('alt="Seguimiento del pedido en vivo: recibido, en preparación, listo y en tu mesa"');

    // Todas las imágenes deben tener loading="lazy" y decoding="async"
    const imgs = html.match(/<img[^>]*>/g) || [];
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('decoding="async"');
      expect(img).toMatch(/alt="[^"]+"/);
    }
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

  it('muestra la nota aclaratoria de capturas reales al final', () => {
    const html = renderToStaticMarkup(<ComoPedir />);

    expect(html).toContain(
      'Capturas reales de la app SmartDining. El código QR de la imagen es ilustrativo.'
    );
  });
});
