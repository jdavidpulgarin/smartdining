import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import Encabezado from './Encabezado.jsx';
import { obtenerSecciones } from '../App.jsx';
import restaurante from '../datos/restaurante.js';

describe('Componente Encabezado', () => {
  it('renderiza "Cómo pedir" como pastilla y sin la pastilla de horario en la barra de escritorio', () => {
    const secciones = obtenerSecciones();
    const html = renderToStaticMarkup(
      <Encabezado secciones={secciones} datosRestaurante={restaurante} />
    );

    // Enlace a cómo pedir como pastilla ámbar (rounded-full)
    expect(html).toContain('href="#como-pedir"');
    expect(html).toContain('Cómo pedir');
    expect(html).toMatch(
      /<a[^>]*href="#como-pedir"[^>]*class="[^"]*\bbg-ambar\b[^"]*"[^>]*>/
    );
    expect(html).toMatch(
      /<a[^>]*href="#como-pedir"[^>]*class="[^"]*\brounded-full\b[^"]*"[^>]*>/
    );

    // En la navegación de escritorio (<nav aria-label="Principal" ...>) NO debe haber pastilla de horario
    const navDesktopMatch = html.match(/<nav[^>]*aria-label="Principal"[^>]*>([\s\S]*?)<\/nav>/);
    expect(navDesktopMatch).not.toBeNull();
    const navDesktop = navDesktopMatch[1];
    expect(navDesktop).not.toContain('Abierto ahora');
    expect(navDesktop).not.toContain('Cerrado');
    expect(navDesktop).not.toContain('bg-exito');
  });

  it('conserva el logo y muestra "SmartDining" sin truncate', () => {
    const secciones = obtenerSecciones();
    const html = renderToStaticMarkup(
      <Encabezado secciones={secciones} datosRestaurante={restaurante} />
    );

    expect(html).toContain('SmartDining');
    expect(html).toContain('src="/logo.png"');
    // Verifica que el span del nombre no lleva la clase truncate y sí whitespace-nowrap
    expect(html).not.toMatch(/class="[^"]*\btruncate\b[^"]*"[^>]*>SmartDining/);
    expect(html).toMatch(/class="[^"]*\bwhitespace-nowrap\b[^"]*"[^>]*>SmartDining/);
  });
});
