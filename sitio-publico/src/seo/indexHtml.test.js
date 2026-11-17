import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('index.html SEO y metadatos', () => {
  const htmlPath = path.resolve(__dirname, '../../index.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  it('tiene doctype y lang="es"', () => {
    expect(html).toMatch(/<html[^>]*lang=["']es["']/);
  });

  it('tiene título descriptivo', () => {
    expect(html).toMatch(/<title>SmartDining - Carta Digital<\/title>/);
  });

  it('tiene meta description', () => {
    expect(html).toMatch(/<meta[^>]*name=["']description["'][^>]*content=["'][^"']+["']/);
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
});
