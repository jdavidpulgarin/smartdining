import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  esModoCompartido,
  validarPresencia,
  registrarOyentesPrimerPlano,
} from './MesaSocketContext';

describe('esModoCompartido', () => {
  it('devuelve false si no hay token o url de socket', () => {
    expect(esModoCompartido(null, 'http://localhost:4001')).toBe(false);
    expect(esModoCompartido('un-token', null)).toBe(false);
    expect(esModoCompartido('', '')).toBe(false);
  });

  it('devuelve false si el token es simulado local (termina en .simulada)', () => {
    expect(
      esModoCompartido('header.payload.simulada', 'http://localhost:4001')
    ).toBe(false);
  });

  it('devuelve true si hay token real firmado y url de socket', () => {
    expect(
      esModoCompartido(
        'eyJhbGciOiJIUzI1NiJ9.eyJpZF9tZXNhIjo1fQ.signature_real',
        'http://localhost:4001'
      )
    ).toBe(true);
  });
});

describe('validarPresencia', () => {
  it('valida y normaliza un payload correcto de mesa:presencia', () => {
    const raw = {
      id_mesa: 5,
      comensales: ['Ana', 'Beto'],
      total: 2,
      pagaron: ['Ana'],
    };
    expect(validarPresencia(raw)).toEqual({
      comensales: ['Ana', 'Beto'],
      pagaron: ['Ana'],
      total: 2,
      sin_celular: [],
    });
  });

  it('respeta sin_celular si viene definido como array de strings', () => {
    const raw = {
      id_mesa: 5,
      comensales: ['Ana'],
      total: 2,
      pagaron: [],
      sin_celular: ['Carlos'],
    };
    expect(validarPresencia(raw)).toEqual({
      comensales: ['Ana'],
      pagaron: [],
      total: 2,
      sin_celular: ['Carlos'],
    });
  });

  it('ignora payloads inválidos o malformados', () => {
    expect(validarPresencia(null)).toBeNull();
    expect(validarPresencia('texto')).toBeNull();
    expect(validarPresencia({})).toBeNull();
    expect(validarPresencia({ comensales: 'Ana', pagaron: [], total: 1 })).toBeNull();
    expect(validarPresencia({ comensales: [123], pagaron: [], total: 1 })).toBeNull();
    expect(validarPresencia({ comensales: [], pagaron: 'Ana', total: 1 })).toBeNull();
    expect(validarPresencia({ comensales: [], pagaron: [], total: 'dos' })).toBeNull();
    expect(validarPresencia({ comensales: [], pagaron: [], total: 0, sin_celular: 'no-array' })).toBeNull();
  });
});

describe('registrarOyentesPrimerPlano', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function crearEntornoMock(visState = 'visible') {
    const doc = new EventTarget();
    doc.visibilityState = visState;
    const win = new EventTarget();
    return { document: doc, window: win };
  }

  it('agrupa visibilitychange, pageshow y online dentro de 300 ms en un único refresco', () => {
    const callback = vi.fn();
    const entorno = crearEntornoMock('visible');
    const darDeBaja = registrarOyentesPrimerPlano(callback, 300, entorno);

    // 1. visibilitychange a visible
    entorno.document.dispatchEvent(new Event('visibilitychange'));

    // 2. 50 ms después llega pageshow
    vi.advanceTimersByTime(50);
    entorno.window.dispatchEvent(new Event('pageshow'));

    // 3. 50 ms después llega online
    vi.advanceTimersByTime(50);
    entorno.window.dispatchEvent(new Event('online'));

    // A los 100 ms aún no debe ejecutarse
    expect(callback).not.toHaveBeenCalled();

    // 299 ms después del último evento todavía no se ejecuta
    vi.advanceTimersByTime(299);
    expect(callback).not.toHaveBeenCalled();

    // Cumplidos los 300 ms se ejecuta exactamente una vez
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);

    darDeBaja();
  });

  it('no dispara refresco en visibilitychange si visibilityState es hidden', () => {
    const callback = vi.fn();
    const entorno = crearEntornoMock('hidden');
    const darDeBaja = registrarOyentesPrimerPlano(callback, 300, entorno);

    entorno.document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();

    darDeBaja();
  });

  it('el cleanup cancela el timer pendiente y remueve los oyentes', () => {
    const callback = vi.fn();
    const entorno = crearEntornoMock('visible');
    const darDeBaja = registrarOyentesPrimerPlano(callback, 300, entorno);

    entorno.window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(100);

    // Cancelar antes de los 300 ms
    darDeBaja();

    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();

    // Eventos futuros no llaman a callback
    entorno.window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
  });
});
