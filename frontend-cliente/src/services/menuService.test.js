import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as apiModule from './api';
import {
  adaptarCategorias,
  adaptarPlatos,
  adaptarPlatosArmables,
  adaptarPlatoArmable,
  normalizarCategorias,
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  obtenerPlatoArmable,
  recargarMenu,
} from './menuService';

const mockMenuApi = {
  categorias: [
    {
      id_categoria: 1,
      categoria: 'Entradas',
      descripcion: 'Para picar',
      orden: 2,
      platos: [
        {
          id_plato: 101,
          nombre: 'Guacamole',
          descripcion: 'Con totopos',
          precio: 15000,
          url_imagen: 'https://img.com/guac.jpg',
          tiempo_estimado: 10,
          personalizable: false,
          calorias: 300,
        },
      ],
    },
    {
      id_categoria: 2,
      categoria: 'Platos Fuertes',
      descripcion: 'Platos principales',
      orden: 1,
      platos: [
        {
          id_plato: 102,
          nombre: 'Hamburguesa Clásica',
          descripcion: 'Carne y queso',
          precio: '28000',
          url_imagen: null,
          tiempo_estimado: 20,
          personalizable: false,
          calorias: null,
        },
        {
          id_plato: 201,
          nombre: 'Bowl Personalizado',
          descripcion: 'Arma tu bowl',
          precio: 32000,
          url_imagen: 'https://img.com/bowl.jpg',
          tiempo_estimado: 15,
          personalizable: true,
          calorias: 500,
          pasos: [
            { id_paso: 2, nombre: 'Proteína', orden: 2, ingredientes: [] },
            { id_paso: 1, nombre: 'Base', orden: 1, ingredientes: [] },
          ],
        },
      ],
    },
    {
      id_categoria: 3,
      categoria: 'Arma tu combo',
      descripcion: 'Solo personalizables',
      orden: 3,
      platos: [
        {
          id_plato: 202,
          nombre: 'Salad Bar',
          descripcion: 'Solo armable',
          precio: 20000,
          url_imagen: null,
          tiempo_estimado: 10,
          personalizable: true,
          pasos: [],
        },
      ],
    },
  ],
};

const mockMenuArray = mockMenuApi.categorias;

describe('menuService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_MODO_SIMULADO', 'false');
    recargarMenu();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('normalizarCategorias', () => {
    it('normaliza objeto con clave categorias', () => {
      expect(normalizarCategorias(mockMenuApi)).toHaveLength(3);
    });

    it('normaliza arreglo directo (ejemplo-menu.json)', () => {
      expect(normalizarCategorias(mockMenuArray)).toHaveLength(3);
    });

    it('devuelve arreglo vacio si los datos son invalidos', () => {
      expect(normalizarCategorias(null)).toEqual([]);
      expect(normalizarCategorias({})).toEqual([]);
    });
  });

  describe('adaptarCategorias', () => {
    it('filtra categorias que no tienen platos NO personalizables y ordena por orden', () => {
      const categorias = adaptarCategorias(mockMenuApi);
      // Categoria 3 solo tiene platos personalizables, por ende debe excluirse
      expect(categorias).toHaveLength(2);
      expect(categorias[0].id).toBe(2); // orden 1
      expect(categorias[0].nombre).toBe('Platos Fuertes');
      expect(categorias[1].id).toBe(1); // orden 2
      expect(categorias[1].nombre).toBe('Entradas');
    });

    it('funciona con arreglo directo de categorias', () => {
      const categorias = adaptarCategorias(mockMenuArray);
      expect(categorias).toHaveLength(2);
      expect(categorias[0].id).toBe(2);
    });
  });

  describe('adaptarPlatos', () => {
    it('devuelve solo platos no personalizables con la estructura requerida', () => {
      const platos = adaptarPlatos(mockMenuApi);
      expect(platos).toHaveLength(2);

      const [guac, hamburguesa] = platos;
      expect(guac).toEqual({
        id: 101,
        nombre: 'Guacamole',
        descripcion: 'Con totopos',
        precio: 15000,
        categoriaId: 1,
        imagen: 'https://img.com/guac.jpg',
        alergenos: [],
        etiquetas: [],
        disponible: true,
        personalizaciones: [],
        tiempo_estimado: 10,
        calorias: 300,
      });

      expect(hamburguesa.precio).toBe(28000);
      expect(typeof hamburguesa.precio).toBe('number');
      expect(hamburguesa.imagen).toBeNull();
    });
  });

  describe('adaptarPlatosArmables y adaptarPlatoArmable', () => {
    it('adaptarPlatosArmables devuelve solo platos personalizables', () => {
      const armables = adaptarPlatosArmables(mockMenuApi);
      expect(armables).toHaveLength(2);
      expect(armables.map((p) => p.id_plato)).toEqual([201, 202]);
    });

    it('adaptarPlatoArmable encuentra el plato y ordena sus pasos', () => {
      const plato = adaptarPlatoArmable(mockMenuApi, '201');
      expect(plato).not.toBeNull();
      expect(plato.id_plato).toBe(201);
      expect(plato.pasos[0].id_paso).toBe(1);
      expect(plato.pasos[1].id_paso).toBe(2);
    });

    it('adaptarPlatoArmable devuelve null si el plato no existe o no es armable', () => {
      expect(adaptarPlatoArmable(mockMenuApi, 999)).toBeNull();
      expect(adaptarPlatoArmable(mockMenuApi, 101)).toBeNull();
    });
  });

  describe('Llamadas a API y caché en memoria', () => {
    it('cachea la respuesta y solo llama a pedirJson una vez', async () => {
      const spyPedirJson = vi
        .spyOn(apiModule, 'pedirJson')
        .mockResolvedValue(mockMenuApi);

      const cats1 = await obtenerCategorias();
      const platos1 = await obtenerPlatos();
      const armables1 = await obtenerPlatosArmables();
      const armable1 = await obtenerPlatoArmable(201);

      expect(spyPedirJson).toHaveBeenCalledTimes(1);
      expect(spyPedirJson).toHaveBeenCalledWith('/menu');
      expect(cats1).toHaveLength(2);
      expect(platos1).toHaveLength(2);
      expect(armables1).toHaveLength(2);
      expect(armable1.id_plato).toBe(201);
    });

    it('recargarMenu invalida la cache y vuelve a llamar a la API', async () => {
      const spyPedirJson = vi
        .spyOn(apiModule, 'pedirJson')
        .mockResolvedValue(mockMenuApi);

      await obtenerPlatos();
      expect(spyPedirJson).toHaveBeenCalledTimes(1);

      recargarMenu();

      await obtenerPlatos();
      expect(spyPedirJson).toHaveBeenCalledTimes(2);
    });

    it('si la API falla, limpia la promesa cacheada permitiendo reintentar', async () => {
      const spyPedirJson = vi
        .spyOn(apiModule, 'pedirJson')
        .mockRejectedValueOnce(new Error('Fallo de red'))
        .mockResolvedValueOnce(mockMenuApi);

      await expect(obtenerPlatos()).rejects.toThrow('Fallo de red');

      // Segundo intento sin llamar recargarMenu explícito porque se limpió al fallar
      const platos = await obtenerPlatos();
      expect(platos).toHaveLength(2);
      expect(spyPedirJson).toHaveBeenCalledTimes(2);
    });

    it('en modo simulado carga menu-simulado.json sin llamar a pedirJson', async () => {
      vi.stubEnv('VITE_MODO_SIMULADO', 'true');
      const spyPedirJson = vi.spyOn(apiModule, 'pedirJson');

      const categorias = await obtenerCategorias();
      const platos = await obtenerPlatos();

      expect(spyPedirJson).not.toHaveBeenCalled();
      expect(categorias.length).toBeGreaterThan(0);
      expect(platos.length).toBeGreaterThan(0);
    });
  });
});
