import { describe, it, expect } from 'vitest';
import { generarRobots, generarSitemap, normalizarUrl } from './generar.js';

describe('SEO generador', () => {
  it('normaliza URLs con barras al final', () => {
    expect(normalizarUrl('https://smartdining.com.co/')).toBe('https://smartdining.com.co');
    expect(normalizarUrl('https://smartdining.com.co///')).toBe('https://smartdining.com.co');
  });

  it('generarRobots incluye User-agent, Allow y Sitemap con https://smartdining.com.co', () => {
    const robots = generarRobots('https://smartdining.com.co');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://smartdining.com.co/sitemap.xml');
  });

  it('generarRobots usa fallback si no se especifica URL', () => {
    const robots = generarRobots();
    expect(robots).toContain('Sitemap: http://localhost:5176/sitemap.xml');
  });

  it('generarSitemap genera XML válido con la locación https://smartdining.com.co/', () => {
    const sitemap = generarSitemap('https://smartdining.com.co');
    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(sitemap).toContain('<loc>https://smartdining.com.co/</loc>');
    expect(sitemap).toContain('</urlset>');
  });

  it('generarSitemap usa fallback si no se especifica URL', () => {
    const sitemap = generarSitemap();
    expect(sitemap).toContain('<loc>http://localhost:5176/</loc>');
  });
});
