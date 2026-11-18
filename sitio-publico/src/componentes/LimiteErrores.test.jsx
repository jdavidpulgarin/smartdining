import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import LimiteErrores from './LimiteErrores.jsx';
import restaurante from '../datos/restaurante.js';

describe('LimiteErrores', () => {
  it('renderiza children cuando no hay error', () => {
    const html = renderToStaticMarkup(
      <LimiteErrores>
        <p>Contenido sin error</p>
      </LimiteErrores>
    );

    expect(html).toContain('Contenido sin error');
    expect(html).not.toContain('Tuvimos un problema al cargar la página.');
  });

  it('renderToStaticMarkup del fallback: aparecen el mensaje de error, el teléfono, WhatsApp y el botón de recarga', () => {
    const html = renderToStaticMarkup(
      <LimiteErrores forzarError={true}>
        <p>No se debe mostrar</p>
      </LimiteErrores>
    );

    expect(html).toContain('Tuvimos un problema al cargar la página.');
    expect(html).toContain(restaurante.nombre);
    expect(html).toContain('Recargar');
    expect(html).toContain(restaurante.telefonoVisible);
    expect(html).toContain(`tel:${restaurante.telefono}`);
    expect(html).toContain(restaurante.whatsappVisible);
    expect(html).toContain(`https://wa.me/${restaurante.whatsapp}`);
    expect(html).not.toContain('No se debe mostrar');
  });

  it('componentDidCatch registra el error en console.error', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const instancia = new LimiteErrores({});
    const errorFalso = new Error('Fallo crítico simulado');
    const infoFalsa = { componentStack: 'en ComponentePrueba' };

    instancia.componentDidCatch(errorFalso, infoFalsa);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error no controlado'),
      errorFalso,
      infoFalsa
    );
    consoleSpy.mockRestore();
  });
});
