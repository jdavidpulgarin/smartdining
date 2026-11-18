import { describe, it, expect } from 'vitest';
import { estadoHorario } from './horario.js';
import restaurante from '../datos/restaurante.js';

describe('estadoHorario (función pura de cálculo de apertura)', () => {
  const horarioReal = restaurante.horario;

  // Bogotá es UTC-5 todo el año (sin horario de verano).
  // Miércoles 18 de noviembre de 2026:
  // 11:29 Bogotá = 16:29 UTC
  // 11:30 Bogotá = 16:30 UTC
  // 22:59 Bogotá = 03:59 UTC del 19 de noviembre
  // 23:00 Bogotá = 04:00 UTC del 19 de noviembre

  it('11:29 en Bogotá → cerrado con "Cerrado · Abre hoy a las 11:30 a. m."', () => {
    const ahora = new Date('2026-11-18T16:29:00.000Z');
    const resultado = estadoHorario(ahora, horarioReal);
    expect(resultado.abierto).toBe(false);
    expect(resultado.texto).toBe('Cerrado · Abre hoy a las 11:30 a. m.');
  });

  it('11:30 en Bogotá → abierto con "Abierto ahora · Cierra a las 11:00 p. m."', () => {
    const ahora = new Date('2026-11-18T16:30:00.000Z');
    const resultado = estadoHorario(ahora, horarioReal);
    expect(resultado.abierto).toBe(true);
    expect(resultado.texto).toBe('Abierto ahora · Cierra a las 11:00 p. m.');
  });

  it('22:59 en Bogotá → abierto (cierra a las 11:00 p. m.)', () => {
    const ahora = new Date('2026-11-19T03:59:00.000Z');
    const resultado = estadoHorario(ahora, horarioReal);
    expect(resultado.abierto).toBe(true);
    expect(resultado.texto).toBe('Abierto ahora · Cierra a las 11:00 p. m.');
  });

  it('23:00 en Bogotá → cerrado con "Cerrado · Abre mañana a las 11:30 a. m."', () => {
    const ahora = new Date('2026-11-19T04:00:00.000Z');
    const resultado = estadoHorario(ahora, horarioReal);
    expect(resultado.abierto).toBe(false);
    expect(resultado.texto).toBe('Cerrado · Abre mañana a las 11:30 a. m.');
  });

  it('un domingo a las 23:30 en Bogotá → "Cerrado · Abre mañana a las 11:30 a. m." (abre el lunes)', () => {
    // 22 de noviembre de 2026 es Domingo.
    // 23:30 Bogotá = 04:30 UTC del lunes 23 de noviembre.
    const ahora = new Date('2026-11-23T04:30:00.000Z');
    const resultado = estadoHorario(ahora, horarioReal);
    expect(resultado.abierto).toBe(false);
    expect(resultado.texto).toBe('Cerrado · Abre mañana a las 11:30 a. m.');
  });

  it('un horario que pasa la medianoche (20:00–02:00): 01:00 → abierto', () => {
    const horarioNocturno = {
      lunes: { abre: '20:00', cierra: '02:00' },
      martes: { abre: '20:00', cierra: '02:00' },
      miercoles: { abre: '20:00', cierra: '02:00' },
      jueves: { abre: '20:00', cierra: '02:00' },
      viernes: { abre: '20:00', cierra: '02:00' },
      sabado: { abre: '20:00', cierra: '02:00' },
      domingo: { abre: '20:00', cierra: '02:00' },
    };
    // Martes 01:00 Bogotá = Martes 06:00 UTC (iniciado el lunes a las 20:00)
    const ahora = new Date('2026-11-17T06:00:00.000Z');
    const resultado = estadoHorario(ahora, horarioNocturno);
    expect(resultado.abierto).toBe(true);
    expect(resultado.texto).toBe('Abierto ahora · Cierra a las 2:00 a. m.');
  });

  it('si mañana no abre, busca el siguiente día que abra con "Abre el [día] a las …"', () => {
    // Viernes a las 23:30 (ya cerró). Sábado y Domingo no abren, Lunes abre 11:30.
    const horarioConDiasCerrados = {
      lunes: { abre: '11:30', cierra: '23:00' },
      martes: { abre: '11:30', cierra: '23:00' },
      miercoles: { abre: '11:30', cierra: '23:00' },
      jueves: { abre: '11:30', cierra: '23:00' },
      viernes: { abre: '11:30', cierra: '23:00' },
      sabado: null,
      domingo: null,
    };
    // Viernes 20 de noviembre 23:30 Bogotá = Sábado 21 de noviembre 04:30 UTC
    const ahora = new Date('2026-11-21T04:30:00.000Z');
    const resultado = estadoHorario(ahora, horarioConDiasCerrados);
    expect(resultado.abierto).toBe(false);
    expect(resultado.texto).toBe('Cerrado · Abre el lunes a las 11:30 a. m.');
  });

  it('el resultado no depende de la zona del equipo (misma fecha UTC, mismo resultado)', () => {
    // La misma marca de tiempo UTC debe calcularse exactamente igual sin importar
    // el entorno o zona horaria local de la máquina en ejecución
    const timestampMs = Date.parse('2026-11-18T16:30:00.000Z');
    const fechaInstancia = new Date(timestampMs);

    const res1 = estadoHorario(fechaInstancia, horarioReal, 'America/Bogota');
    const res2 = estadoHorario(new Date(timestampMs), horarioReal, 'America/Bogota');

    expect(res1).toEqual(res2);
    expect(res1.abierto).toBe(true);
    expect(res1.texto).toBe('Abierto ahora · Cierra a las 11:00 p. m.');
  });
});
