import { describe, it, expect } from 'vitest';
import restaurante from './restaurante.js';

describe('restaurante.js - datos informativos', () => {
  it('tiene los tipos correctos para las propiedades principales', () => {
    expect(typeof restaurante.nombre).toBe('string');
    expect(restaurante.nombre.length).toBeGreaterThan(0);

    expect(typeof restaurante.eslogan).toBe('string');
    expect(restaurante.eslogan.length).toBeGreaterThan(0);

    expect(typeof restaurante.historia).toBe('string');
    expect(restaurante.historia.length).toBeGreaterThan(0);

    expect(typeof restaurante.anioFundacion).toBe('number');
    expect(restaurante.anioFundacion).toBeGreaterThan(1900);

    expect(typeof restaurante.correo).toBe('string');
    expect(restaurante.correo).toMatch(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  });

  it('tiene la estructura de dirección esperada con país CO', () => {
    expect(restaurante.direccion).toBeDefined();
    expect(typeof restaurante.direccion.calle).toBe('string');
    expect(typeof restaurante.direccion.ciudad).toBe('string');
    expect(typeof restaurante.direccion.region).toBe('string');
    expect(typeof restaurante.direccion.codigoPostal).toBe('string');
    expect(restaurante.direccion.pais).toBe('CO');
  });

  it('valida el formato de teléfono (+57…) y whatsapp (solo dígitos con indicativo)', () => {
    expect(restaurante.telefono).toMatch(/^\+57\d+$/);
    expect(typeof restaurante.telefonoVisible).toBe('string');

    // WhatsApp solo dígitos
    expect(restaurante.whatsapp).toMatch(/^\d+$/);
    expect(restaurante.whatsapp.startsWith('57')).toBe(true);
    expect(typeof restaurante.whatsappVisible).toBe('string');
  });

  it('valida que las horas del horario cumplan con el formato HH:MM o sean null', () => {
    const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
    const patronHora = /^([01]\d|2[0-3]):[0-5]\d$/;

    expect(restaurante.horario).toBeDefined();
    expect(typeof restaurante.horarioVisible).toBe('string');

    for (const dia of dias) {
      const entrada = restaurante.horario[dia];
      if (entrada !== null) {
        expect(entrada).toHaveProperty('abre');
        expect(entrada).toHaveProperty('cierra');
        expect(entrada.abre).toMatch(patronHora);
        expect(entrada.cierra).toMatch(patronHora);
      }
    }
  });

  it('valida que todas las redes sociales tengan URLs seguras https', () => {
    expect(Array.isArray(restaurante.redes)).toBe(true);
    for (const red of restaurante.redes) {
      expect(typeof red.nombre).toBe('string');
      expect(typeof red.url).toBe('string');
      expect(red.url.startsWith('https://')).toBe(true);
    }
  });

  it('valida que videosPlatos sea un objeto con la estructura requerida (solo archivo y poster, sin ia ni credito)', () => {
    expect(restaurante.videosPlatos).toBeDefined();
    expect(typeof restaurante.videosPlatos).toBe('object');
    const nombres = Object.keys(restaurante.videosPlatos);
    expect(nombres).toEqual(
      expect.arrayContaining(['Arepa Rellena', 'Bowl Personalizado', 'Wrap Personalizado'])
    );
    expect(nombres.length).toBe(3);
    for (const nombre of nombres) {
      const vid = restaurante.videosPlatos[nombre];
      expect(typeof vid.archivo).toBe('string');
      expect(typeof vid.poster).toBe('string');
      expect(vid.ia).toBeUndefined();
      expect(vid.credito).toBeUndefined();
    }
  });
});
