import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as apiModule from './api';
import {
  normalizarConfiguracion,
  normalizarHorario,
  normalizarRedes,
  tieneDatosRestaurante,
  obtenerConfiguracionPublica,
  recargarConfiguracion,
} from './configuracionService';

const mockConfigBackend = {
  nombre: 'SmartDining',
  telefono: '+57 604 1234567',
  direccion: 'Calle 10 #43E-25, El Poblado, Medellín',
  url_logo: 'https://cdn.smartdining.co/logo.png',
  horario: {
    viernes: { abre: '12:00', cierra: '23:30' },
    lunes: { abre: '12:00', cierra: '22:00' },
  },
  propina_sugerida_pct: 10,
  moneda: 'COP',
};

describe('configuracionService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_MODO_SIMULADO', 'false');
    recargarConfiguracion();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('normalizarConfiguracion', () => {
    it('normaliza la forma real de GET /api/configuracion ordenando los dias del horario', () => {
      const resultado = normalizarConfiguracion(mockConfigBackend);

      expect(resultado).toEqual({
        nombre: 'SmartDining',
        direccion: 'Calle 10 #43E-25, El Poblado, Medellín',
        telefono: '+57 604 1234567',
        correo: null,
        redes: null,
        url_logo: 'https://cdn.smartdining.co/logo.png',
        moneda: 'COP',
        propina_sugerida_pct: 10,
        horario: [
          {
            dia: 'Lunes',
            abre: '12:00',
            cierra: '22:00',
            texto: '12:00 - 22:00',
          },
          {
            dia: 'Viernes',
            abre: '12:00',
            cierra: '23:30',
            texto: '12:00 - 23:30',
          },
        ],
      });
    });

    it('deja en null los campos faltantes o vacios sin inventar datos', () => {
      expect(normalizarConfiguracion(null)).toEqual({
        nombre: null,
        direccion: null,
        horario: null,
        telefono: null,
        correo: null,
        redes: null,
        url_logo: null,
        moneda: null,
        propina_sugerida_pct: null,
      });

      expect(
        normalizarConfiguracion({
          nombre: '   ',
          direccion: '',
          telefono: null,
          url_logo: '   ',
          horario: {},
          redes: {},
        })
      ).toEqual({
        nombre: null,
        direccion: null,
        horario: null,
        telefono: null,
        correo: null,
        redes: null,
        url_logo: null,
        moneda: null,
        propina_sugerida_pct: null,
      });
    });

    it('normaliza correo y redes cuando vienen en la respuesta', () => {
      const configConExtras = {
        nombre: 'SmartDining Centro',
        correo: '  contacto@smartdining.com.co ',
        redes: {
          instagram: 'https://instagram.com/smartdining',
          facebook: '   ',
          tiktok: '@smartdining',
        },
      };

      const res = normalizarConfiguracion(configConExtras);
      expect(res.nombre).toBe('SmartDining Centro');
      expect(res.correo).toBe('contacto@smartdining.com.co');
      expect(res.direccion).toBeNull();
      expect(res.horario).toBeNull();
      expect(res.telefono).toBeNull();
      expect(res.redes).toEqual([
        {
          nombre: 'Instagram',
          valor: 'https://instagram.com/smartdining',
          url: 'https://instagram.com/smartdining',
        },
        {
          nombre: 'TikTok',
          valor: '@smartdining',
          url: null,
        },
      ]);
    });
  });

  describe('normalizarHorario y normalizarRedes', () => {
    it('soporta dias cerrados explicitos y descarta entradas sin horas validas', () => {
      const horario = normalizarHorario({
        lunes: { cerrado: true },
        martes: { abre: '12:00', cierra: '' },
        miercoles: { abre: '12:00', cierra: '21:00' },
      });

      expect(horario).toEqual([
        { dia: 'Lunes', abre: null, cierra: null, texto: 'Cerrado' },
        {
          dia: 'Miércoles',
          abre: '12:00',
          cierra: '21:00',
          texto: '12:00 - 21:00',
        },
      ]);
    });

    it('normalizarRedes devuelve null si el arreglo o el objeto no tienen entradas validas', () => {
      expect(normalizarRedes([])).toBeNull();
      expect(normalizarRedes({ instagram: '' })).toBeNull();
    });

    it('tieneDatosRestaurante detecta si hay al menos un dato de contacto o ubicacion', () => {
      const vacia = normalizarConfiguracion({ nombre: 'SmartDining' });
      expect(tieneDatosRestaurante(vacia)).toBe(false);

      const conTelefono = normalizarConfiguracion({
        nombre: 'SmartDining',
        telefono: '6041234567',
      });
      expect(tieneDatosRestaurante(conTelefono)).toBe(true);
    });
  });

  describe('obtenerConfiguracionPublica', () => {
    it('llama a GET /configuracion sin token ni Authorization y cachea la respuesta', async () => {
      const spyPedirJson = vi
        .spyOn(apiModule, 'pedirJson')
        .mockResolvedValue(mockConfigBackend);

      const conf1 = await obtenerConfiguracionPublica();
      const conf2 = await obtenerConfiguracionPublica();

      expect(spyPedirJson).toHaveBeenCalledTimes(1);
      expect(spyPedirJson).toHaveBeenCalledWith('/configuracion');
      expect(conf1.nombre).toBe('SmartDining');
      expect(conf2.telefono).toBe('+57 604 1234567');
    });

    it('usa configuracion-simulada.json en modo simulado sin llamar a pedirJson', async () => {
      vi.stubEnv('VITE_MODO_SIMULADO', 'true');
      const spyPedirJson = vi.spyOn(apiModule, 'pedirJson');

      const conf = await obtenerConfiguracionPublica();

      expect(spyPedirJson).not.toHaveBeenCalled();
      expect(conf.nombre).toBe('SmartDining');
      expect(conf.horario.length).toBeGreaterThan(0);
    });
  });
});
