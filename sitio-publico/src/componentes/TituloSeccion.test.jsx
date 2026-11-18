import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import TituloSeccion from './TituloSeccion.jsx';

describe('Componente TituloSeccion', () => {
  it('renderiza un h2 con id y las dos líneas; la primera con clase texto-contorno', () => {
    const html = renderToStaticMarkup(
      <TituloSeccion
        id="mi-titulo"
        linea1="Primera línea"
        linea2="Segunda línea"
      />
    );

    expect(html).toContain('id="mi-titulo"');
    expect(html).toMatch(/<h2[^>]*id="mi-titulo"[^>]*>/);
    expect(html).toContain('Primera línea');
    expect(html).toContain('Segunda línea');
    expect(html).toMatch(/<span[^>]*class="[^"]*texto-contorno[^"]*"[^>]*>\s*Primera línea\s*<\/span>/);
  });

  it('renderiza párrafo descriptivo cuando se proporciona la prop descripcion', () => {
    const html = renderToStaticMarkup(
      <TituloSeccion
        id="con-desc"
        linea1="Línea 1"
        linea2="Línea 2"
        descripcion="Descripción de apoyo para la sección."
      />
    );

    expect(html).toContain('id="con-desc"');
    expect(html).toContain('Descripción de apoyo para la sección.');
  });
});
