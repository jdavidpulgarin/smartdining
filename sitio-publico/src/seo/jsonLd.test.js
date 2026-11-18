import { describe, it, expect } from 'vitest';
import restaurante from '../datos/restaurante.js';
import {
  construirJsonLd,
  construirMetaDescription,
  serializarJsonLdSeguro,
} from './jsonLd.js';

describe('SEO y Schema.org JSON-LD', () => {
  it('construye JSON-LD completo con los datos del restaurante', () => {
    const jsonLd = construirJsonLd(restaurante, 'https://smartdining.com.co');

    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('Restaurant');
    expect(jsonLd.name).toBe('SmartDining Restaurante');
    expect(jsonLd.url).toBe('https://smartdining.com.co/');
    expect(jsonLd.logo).toBe('https://smartdining.com.co/logo.png');
    expect(jsonLd.image).toBe('https://smartdining.com.co/og.png');
    expect(jsonLd.hasMenu).toBe('https://smartdining.com.co/#carta');
    expect(jsonLd.acceptsReservations).toBe(false);
    expect(jsonLd.telephone).toBe('+573008233204');
    expect(jsonLd.email).toBe('contacto@smartdining.com.co');
    expect(jsonLd.foundingDate).toBe('2016');

    // Dirección
    expect(jsonLd.address).toBeDefined();
    expect(jsonLd.address['@type']).toBe('PostalAddress');
    expect(jsonLd.address.streetAddress).toBe('Carrera 9 # 16-45, Centro');
    expect(jsonLd.address.addressLocality).toBe('Valledupar');
    expect(jsonLd.address.addressRegion).toBe('Cesar');
    expect(jsonLd.address.addressCountry).toBe('CO');
    // codigoPostal vacío no debe figurar en address
    expect(jsonLd.address.postalCode).toBeUndefined();

    // Redes (sameAs)
    expect(Array.isArray(jsonLd.sameAs)).toBe(true);
    expect(jsonLd.sameAs).toHaveLength(3);
    expect(jsonLd.sameAs).toContain('https://www.instagram.com/smartdining');

    // Horarios
    expect(Array.isArray(jsonLd.openingHoursSpecification)).toBe(true);
    expect(jsonLd.openingHoursSpecification).toHaveLength(7);
    for (const spec of jsonLd.openingHoursSpecification) {
      expect(spec['@type']).toBe('OpeningHoursSpecification');
      expect(spec.opens).toBe('11:30');
      expect(spec.closes).toBe('23:00');
    }
  });

  it('construye JSON-LD con datos vacíos o mínimos sin campos espurios', () => {
    const jsonLd = construirJsonLd({});

    expect(jsonLd['@context']).toBe('https://schema.org');
    expect(jsonLd['@type']).toBe('Restaurant');
    expect(jsonLd.name).toBeUndefined();
    expect(jsonLd.address).toBeUndefined();
    expect(jsonLd.telephone).toBeUndefined();
    expect(jsonLd.email).toBeUndefined();
    expect(jsonLd.sameAs).toBeUndefined();
    expect(jsonLd.openingHoursSpecification).toBeUndefined();
    expect(jsonLd.foundingDate).toBeUndefined();
  });

  it('escapa etiquetas </script> en la serialización segura', () => {
    const malicioso = {
      ...restaurante,
      nombre: 'SmartDining</script><script>alert("xss")</script>',
    };
    const jsonLd = construirJsonLd(malicioso);
    const serializado = serializarJsonLdSeguro(jsonLd);

    expect(serializado).not.toContain('</script>');
    expect(serializado).toContain('\\u003c/script>');
  });

  it('genera meta description entre 140 y 160 caracteres con nombre y ciudad', () => {
    const desc = construirMetaDescription(restaurante);
    expect(desc.length).toBeGreaterThanOrEqual(140);
    expect(desc.length).toBeLessThanOrEqual(160);
    expect(desc).toContain(restaurante.nombre);
    expect(desc).toContain(restaurante.direccion.ciudad);
  });
});
