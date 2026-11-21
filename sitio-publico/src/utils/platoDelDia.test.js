import { describe, it, expect } from 'vitest';
import {
  diaDeHoy,
  msHastaMedianocheBogota,
  obtenerPlatoDelDia,
} from './platoDelDia.js';

describe('platoDelDia utils', () => {
  describe('diaDeHoy(fecha)', () => {
    it('devuelve días en minúsculas y sin tildes (miercoles, sabado)', () => {
      const miercolesBogota = new Date('2026-11-25T17:00:00Z');
      expect(diaDeHoy(miercolesBogota)).toBe('miercoles');

      const sabadoBogota = new Date('2026-11-28T17:00:00Z');
      expect(diaDeHoy(sabadoBogota)).toBe('sabado');
    });

    it('calcula correctamente fechas UTC que en Bogotá caen en otro día', () => {
      const lunesNoche = new Date('2026-11-24T03:00:00Z');
      expect(diaDeHoy(lunesNoche)).toBe('lunes');

      const martesNoche = new Date('2026-11-25T01:30:00Z');
      expect(diaDeHoy(martesNoche)).toBe('martes');

      const miercolesNoche = new Date('2026-11-26T04:15:00Z');
      expect(diaDeHoy(miercolesNoche)).toBe('miercoles');

      const juevesNoche = new Date('2026-11-27T02:00:00Z');
      expect(diaDeHoy(juevesNoche)).toBe('jueves');

      const viernesNoche = new Date('2026-11-28T03:59:00Z');
      expect(diaDeHoy(viernesNoche)).toBe('viernes');

      const sabadoNoche = new Date('2026-11-29T04:30:00Z');
      expect(diaDeHoy(sabadoNoche)).toBe('sabado');

      const domingoNoche = new Date('2026-11-30T04:59:59Z');
      expect(diaDeHoy(domingoNoche)).toBe('domingo');
    });
  });

  describe('msHastaMedianocheBogota(fecha)', () => {
    it('devuelve 60000 ms cuando la hora en Bogotá es 23:59:00', () => {
      const fecha2359 = new Date('2026-11-24T04:59:00.000Z');
      const ms = msHastaMedianocheBogota(fecha2359);
      expect(ms).toBe(60000);
    });

    it('devuelve la diferencia exacta hasta las 00:00:00 del día siguiente', () => {
      const mediodia = new Date('2026-11-24T17:00:00.000Z');
      const ms = msHastaMedianocheBogota(mediodia);
      expect(ms).toBe(12 * 60 * 60 * 1000);
    });
  });

  describe('obtenerPlatoDelDia(dia, carta)', () => {
    const cartaMock = {
      origen: 'vivo',
      platos: [
        { nombre: 'Hamburguesa Smart Angus', precio: 34000, disponible: true },
        { nombre: 'Salchipapa con todo', precio: 25000, disponible: true },
        { nombre: 'Pastas a la boloñesa', precio: 22000, disponible: false }, // agotado
      ],
      armables: [],
    };

    it('devuelve estado "disponible" con el precio de la carta si el plato existe y está disponible', () => {
      const resultado = obtenerPlatoDelDia('martes', cartaMock);
      expect(resultado.estado).toBe('disponible');
      expect(resultado.precio).toBe(25000);
      expect(resultado.nombreCarta).toBe('Salchipapa con todo');
      expect(resultado.video).toBe('/videos/plato-del-dia/salchipapa.mp4');
    });

    it('coincide el nombre sin distinguir mayúsculas, tildes ni espacios extra', () => {
      const cartaVariaciones = {
        origen: 'vivo',
        platos: [
          { nombre: '  sAlchíPAPA   con   tOdo  ', precio: 26000, disponible: true },
        ],
      };
      const resultado = obtenerPlatoDelDia('martes', cartaVariaciones);
      expect(resultado.estado).toBe('disponible');
      expect(resultado.precio).toBe(26000);
    });

    it('devuelve estado "agotado" si el plato existe en la carta pero disponible es false', () => {
      const resultado = obtenerPlatoDelDia('miercoles', cartaMock);
      expect(resultado.estado).toBe('agotado');
    });

    it('devuelve estado "no-existe" si el plato no se encuentra en la carta', () => {
      const resultado = obtenerPlatoDelDia('viernes', cartaMock); // Pizza no está en cartaMock
      expect(resultado.estado).toBe('no-existe');
    });

    it('devuelve estado "no-existe" si la carta es nula o undefined', () => {
      const resultado = obtenerPlatoDelDia('martes', null);
      expect(resultado.estado).toBe('no-existe');
    });

    it('marca esRespaldo: true cuando carta.origen === "fija"', () => {
      const cartaRespaldo = {
        origen: 'fija',
        platos: [
          { nombre: 'Salchipapa con todo', precio: 25000, disponible: true },
        ],
      };
      const resultado = obtenerPlatoDelDia('martes', cartaRespaldo);
      expect(resultado.estado).toBe('disponible');
      expect(resultado.esRespaldo).toBe(true);
    });
  });
});
