import { describe, it, expect } from 'vitest';
import {
  diaDeHoy,
  msHastaMedianocheBogota,
  obtenerPlatoDelDia,
} from './platoDelDia.js';

describe('platoDelDia utils', () => {
  describe('diaDeHoy(fecha)', () => {
    it('devuelve días en minúsculas y sin tildes (miercoles, sabado)', () => {
      // 2026-11-25T17:00:00Z es miércoles 12:00 del mediodía en Bogotá
      const miercolesBogota = new Date('2026-11-25T17:00:00Z');
      expect(diaDeHoy(miercolesBogota)).toBe('miercoles');

      // 2026-11-28T17:00:00Z es sábado 12:00 del mediodía en Bogotá
      const sabadoBogota = new Date('2026-11-28T17:00:00Z');
      expect(diaDeHoy(sabadoBogota)).toBe('sabado');
    });

    it('calcula correctamente fechas UTC que en Bogotá caen en otro día', () => {
      // 2026-11-24T03:00:00Z es lunes 23 a las 22:00 en Bogotá (UTC-5)
      const lunesNoche = new Date('2026-11-24T03:00:00Z');
      expect(diaDeHoy(lunesNoche)).toBe('lunes');

      // 2026-11-25T01:30:00Z es martes 24 a las 20:30 en Bogotá
      const martesNoche = new Date('2026-11-25T01:30:00Z');
      expect(diaDeHoy(martesNoche)).toBe('martes');

      // 2026-11-26T04:15:00Z es miércoles 25 a las 23:15 en Bogotá
      const miercolesNoche = new Date('2026-11-26T04:15:00Z');
      expect(diaDeHoy(miercolesNoche)).toBe('miercoles');

      // 2026-11-27T02:00:00Z es jueves 26 a las 21:00 en Bogotá
      const juevesNoche = new Date('2026-11-27T02:00:00Z');
      expect(diaDeHoy(juevesNoche)).toBe('jueves');

      // 2026-11-28T03:59:00Z es viernes 27 a las 22:59 en Bogotá
      const viernesNoche = new Date('2026-11-28T03:59:00Z');
      expect(diaDeHoy(viernesNoche)).toBe('viernes');

      // 2026-11-29T04:30:00Z es sábado 28 a las 23:30 en Bogotá
      const sabadoNoche = new Date('2026-11-29T04:30:00Z');
      expect(diaDeHoy(sabadoNoche)).toBe('sabado');

      // 2026-11-30T04:59:59Z es domingo 29 a las 23:59:59 en Bogotá
      const domingoNoche = new Date('2026-11-30T04:59:59Z');
      expect(diaDeHoy(domingoNoche)).toBe('domingo');
    });
  });

  describe('msHastaMedianocheBogota(fecha)', () => {
    it('devuelve 60000 ms cuando la hora en Bogotá es 23:59:00', () => {
      // 23:59:00 en Bogotá = 04:59:00 UTC del día siguiente
      const fecha2359 = new Date('2026-11-24T04:59:00.000Z');
      const ms = msHastaMedianocheBogota(fecha2359);
      expect(ms).toBe(60000);
    });

    it('devuelve la diferencia exacta hasta las 00:00:00 del día siguiente', () => {
      // 00:00:00 en Bogotá = 05:00:00 UTC
      // 12:00:00 en Bogotá = 17:00:00 UTC -> faltan 12 horas = 43,200,000 ms
      const mediodia = new Date('2026-11-24T17:00:00.000Z');
      const ms = msHastaMedianocheBogota(mediodia);
      expect(ms).toBe(12 * 60 * 60 * 1000);
    });
  });

  describe('obtenerPlatoDelDia(dia)', () => {
    it('devuelve el plato correcto para cada día de la semana', () => {
      const dias = [
        { dia: 'lunes', nombreEsperado: 'Hamburguesa Smart Angus' },
        { dia: 'martes', nombreEsperado: 'Salchipapa con todo' },
        { dia: 'miercoles', nombreEsperado: 'Pastas a la boloñesa' },
        { dia: 'jueves', nombreEsperado: 'Pollo asado' },
        { dia: 'viernes', nombreEsperado: 'Pizza' },
        { dia: 'sabado', nombreEsperado: 'Carne asada con papas' },
        { dia: 'domingo', nombreEsperado: 'Volcán de chocolate' },
      ];

      for (const { dia, nombreEsperado } of dias) {
        const plato = obtenerPlatoDelDia(dia);
        expect(plato).toBeDefined();
        expect(plato.nombre).toBe(nombreEsperado);
        expect(typeof plato.descripcion).toBe('string');
        expect(plato.descripcion.length).toBeGreaterThan(0);
      }
    });

    it('incluye video y poster para el martes y no para los demás días', () => {
      const platoMartes = obtenerPlatoDelDia('martes');
      expect(platoMartes.video).toBe('/videos/plato-del-dia/salchipapa.mp4');
      expect(platoMartes.poster).toBe('/videos/plato-del-dia/salchipapa.webp');

      const platoMiercoles = obtenerPlatoDelDia('miercoles');
      expect(platoMiercoles.video).toBeUndefined();
      expect(platoMiercoles.poster).toBeUndefined();
    });

    it('acepta variaciones con tilde como miércoles y sábado', () => {
      expect(obtenerPlatoDelDia('miércoles').nombre).toBe('Pastas a la boloñesa');
      expect(obtenerPlatoDelDia('sábado').nombre).toBe('Carne asada con papas');
    });
  });
});
