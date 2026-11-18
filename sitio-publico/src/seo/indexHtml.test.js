import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import restaurante from '../datos/restaurante.js';
import { construirMetaDescription } from './jsonLd.js';

describe('index.html SEO y metadatos', () => {
  const htmlPath = path.resolve(__dirname, '../../index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  it('tiene doctype y lang="es"', () => {
    expect(html).toMatch(/<html[^>]*lang=["']es["']/);
  });

  it('tiene título descriptivo con los datos de restaurante', () => {
    const tituloEsperado = `${restaurante.nombre} · Carta, historia y contacto`;
    expect(html).toContain(`<title>${tituloEsperado}</title>`);
  });

  it('tiene meta description acorde con restaurante.js', () => {
    const descEsperada = construirMetaDescription(restaurante);
    expect(html).toContain(`content="${descEsperada}"`);
  });

  it('tiene etiquetas Open Graph requeridas incluyendo og:image y og:type=restaurant', () => {
    expect(html).toMatch(/<meta[^>]*property=["']og:title["']/);
    expect(html).toMatch(/<meta[^>]*property=["']og:description["']/);
    expect(html).toMatch(/<meta[^>]*property=["']og:type["'][^>]*content=["']restaurant["']/);
    expect(html).toMatch(/<meta[^>]*property=["']og:image["']/);
    expect(html).toMatch(/<meta[^>]*property=["']og:url["']/);
    expect(html).toMatch(/<meta[^>]*property=["']og:locale["'][^>]*content=["']es_CO["']/);
  });

  it('tiene Schema.org Restaurant JSON-LD', () => {
    expect(html).toMatch(/<script[^>]*type=["']application\/ld\+json["']/);
    expect(html).toContain('"@type": "Restaurant"');
    expect(html).toContain('"@context": "https://schema.org"');
  });

  it('no contiene servesCuisine ni la palabra parrilla', () => {
    expect(html).not.toContain('servesCuisine');
    expect(html.toLowerCase()).not.toContain('parrilla');
  });

  it('si dist/index.html existe, contiene el JSON-LD con los datos de Roberto', () => {
    const distPath = path.resolve(__dirname, '../../dist/index.html');
    if (fs.existsSync(distPath)) {
      const distHtml = fs.readFileSync(distPath, 'utf-8');
      expect(distHtml).toContain(restaurante.nombre);
      expect(distHtml).toContain('Carrera 9 # 16-45, Centro');
      expect(distHtml).toContain('+573008233204');
      expect(distHtml).toContain('contacto@smartdining.com.co');
      // Un único bloque script JSON-LD
      const matches = distHtml.match(/<script type="application\/ld\+json"/g);
      expect(matches).toHaveLength(1);
    }
  });
});
