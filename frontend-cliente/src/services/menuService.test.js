import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as apiModule from './api';
import {
  adaptarCategorias,
  adaptarPlatos,
  adaptarPlatosArmables,
  adaptarPlatoArmable,
  actualizarDisponibilidadPlatoEnCache,
  aplicarDisponibilidad,
  aplicarDisponibilidadPlato,
  aplicarDisponibilidadEnListaPlatos,
  aplicarDisponibilidadIngredienteEnArmables,
  armableTieneStock,
  limpiarMarcaAgotado,
  aplicarFaltantesMenu,
  limpiarMarcasAgotadoLocal,
  marcarFaltantesEnCache,
  normalizarCategorias,
  obtenerCategorias,
  obtenerMarcasAgotadoLocal,
  obtenerPlatos,
  obtenerPlatosArmables,
  obtenerPlatoArmable,
  recargarMenu,
  tieneMarcasAgotadoLocal,
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
    limpiarMarcasAgotadoLocal();
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

  describe('aplicarDisponibilidad', () => {
    const menuConIngredientes = [
      {
        id_categoria: 10,
        categoria: 'Arma tu plato',
        platos: [
          {
            id_plato: 1001,
            nombre: 'Bowl',
            personalizable: true,
            pasos: [
              {
                id_paso: 1,
                nombre: 'Base',
                ingredientes: [
                  { id_ingrediente: 1, nombre: 'Arroz', disponible: true },
                  { id_ingrediente: 2, nombre: 'Quinoa', disponible: true },
                ],
              },
            ],
          },
        ],
      },
    ];

    it('actualiza inmutablemente la disponibilidad de un ingrediente en un array de categorias', () => {
      const menuActualizado = aplicarDisponibilidad(menuConIngredientes, 1, false);

      const ingOriginal = menuConIngredientes[0].platos[0].pasos[0].ingredientes[0];
      const ingActualizado = menuActualizado[0].platos[0].pasos[0].ingredientes[0];

      expect(ingOriginal.disponible).toBe(true);
      expect(ingActualizado.disponible).toBe(false);
      expect(menuActualizado).not.toBe(menuConIngredientes);
    });

    it('actualiza inmutablemente un objeto { categorias: [...] }', () => {
      const objetoMenu = { categorias: menuConIngredientes };
      const menuActualizado = aplicarDisponibilidad(objetoMenu, 1, false);
      expect(menuActualizado.categorias).toBeDefined();
      expect(
        menuActualizado.categorias[0].platos[0].pasos[0].ingredientes[0].disponible
      ).toBe(false);
      expect(
        menuConIngredientes[0].platos[0].pasos[0].ingredientes[0].disponible
      ).toBe(true);
    });

    it('retorna el menu intacto si recibe null o ingrediente inexistente', () => {
      expect(aplicarDisponibilidad(null, 1, false)).toBeNull();
      const sinCambios = aplicarDisponibilidad(menuConIngredientes, 99999, false);
      expect(sinCambios[0].platos[0].pasos[0].ingredientes[0].disponible).toBe(true);
    });
  });

  describe('aplicarDisponibilidadPlato', () => {
    const menuOriginal = [
      {
        id_categoria: 1,
        categoria: 'Entradas',
        platos: [
          { id_plato: 10, nombre: 'Empanadas', disponible: true },
          { id_plato: 20, nombre: 'Papas', disponible: true },
        ],
      },
      {
        id_categoria: 2,
        categoria: 'Favoritos',
        platos: [
          { id_plato: 10, nombre: 'Empanadas', disponible: true },
        ],
      },
    ];

    it('agota un plato en todas las categorias donde aparece sin mutar el original', () => {
      const menuActualizado = aplicarDisponibilidadPlato(menuOriginal, 10, false);

      // Comprobar que se actualizó en ambas categorías
      expect(menuActualizado[0].platos[0].disponible).toBe(false);
      expect(menuActualizado[1].platos[0].disponible).toBe(false);

      // Comprobar que los otros platos quedan intactos
      expect(menuActualizado[0].platos[1].disponible).toBe(true);

      // Inmutabilidad
      expect(menuActualizado).not.toBe(menuOriginal);
      expect(menuOriginal[0].platos[0].disponible).toBe(true);
      expect(menuOriginal[1].platos[0].disponible).toBe(true);
    });

    it('repone un plato agotado (disponible: true)', () => {
      const menuAgotado = [
        {
          id_categoria: 1,
          categoria: 'Entradas',
          platos: [{ id_plato: 10, nombre: 'Empanadas', disponible: false }],
        },
      ];

      const menuRepuesto = aplicarDisponibilidadPlato(menuAgotado, 10, true);
      expect(menuRepuesto[0].platos[0].disponible).toBe(true);
    });

    it('retorna el menu sin cambios si el id de plato es inexistente', () => {
      const res = aplicarDisponibilidadPlato(menuOriginal, 9999, false);
      expect(res[0].platos[0].disponible).toBe(true);
      expect(res[0].platos[1].disponible).toBe(true);
    });

    it('retorna null si recibe menu null', () => {
      expect(aplicarDisponibilidadPlato(null, 10, false)).toBeNull();
    });
  });

  describe('aplicarFaltantesMenu y marcarFaltantesEnCache (J-17)', () => {
    it('marca como no disponibles en el menu tanto platos como ingredientes de faltantes', async () => {
      const menuConAmbos = {
        categorias: [
          {
            id_categoria: 1,
            categoria: 'Bebidas',
            platos: [{ id_plato: 1008, nombre: 'Limonada de Coco' }],
          },
          {
            id_categoria: 2,
            categoria: 'Arma tu plato',
            platos: [
              {
                id_plato: 1001,
                nombre: 'Bowl Personalizado',
                personalizable: true,
                pasos: [
                  {
                    id_paso: 103,
                    nombre: 'Toppings',
                    ingredientes: [
                      { id_ingrediente: 10, nombre: 'Aguacate', disponible: true },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const faltantes = [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ];

      const actualizado = aplicarFaltantesMenu(menuConAmbos, faltantes);
      expect(actualizado.categorias[0].platos[0].disponible).toBe(false);
      expect(
        actualizado.categorias[1].platos[0].pasos[0].ingredientes[0].disponible
      ).toBe(false);

      // Tambien sobre la cache en memoria
      vi.spyOn(apiModule, 'pedirJson').mockResolvedValue(menuConAmbos);
      await obtenerPlatos();

      marcarFaltantesEnCache(faltantes);

      const platosDespues = await obtenerPlatos();
      expect(platosDespues[0].disponible).toBe(false);

      const bowlDespues = await obtenerPlatoArmable(1001);
      expect(bowlDespues.pasos[0].ingredientes[0].disponible).toBe(false);
    });

    it('limpia la marca local de 409 cuando recargarMenu vuelve a traer el plato en GET /menu', async () => {
      const menuServidor = {
        categorias: [
          {
            id_categoria: 1,
            categoria: 'Bebidas',
            platos: [{ id_plato: 1008, nombre: 'Limonada de Coco', precio: 12000 }],
          },
        ],
      };

      vi.spyOn(apiModule, 'pedirJson').mockResolvedValue(menuServidor);
      await obtenerPlatos();

      marcarFaltantesEnCache([
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
      ]);
      expect(tieneMarcasAgotadoLocal()).toBe(true);
      expect((await obtenerPlatos())[0].disponible).toBe(false);

      // Al recargar el menu, GET /menu sigue trayendo el plato porque aun tiene stock
      recargarMenu();
      const platosTrasRecarga = await obtenerPlatos();
      expect(platosTrasRecarga[0].disponible).toBe(true);
      expect(obtenerMarcasAgotadoLocal()).toEqual([]);
      expect(tieneMarcasAgotadoLocal()).toBe(false);
    });

    it('limpia la marca local de 409 cuando llega plato:disponibilidad con disponible: true', async () => {
      const menuServidor = {
        categorias: [
          {
            id_categoria: 1,
            categoria: 'Bebidas',
            platos: [{ id_plato: 1008, nombre: 'Limonada de Coco', precio: 12000 }],
          },
        ],
      };

      vi.spyOn(apiModule, 'pedirJson').mockResolvedValue(menuServidor);
      await obtenerPlatos();

      marcarFaltantesEnCache([
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
      ]);
      expect((await obtenerPlatos())[0].disponible).toBe(false);

      actualizarDisponibilidadPlatoEnCache(1008, true);
      expect((await obtenerPlatos())[0].disponible).toBe(true);
      expect(obtenerMarcasAgotadoLocal()).toEqual([]);
    });
  });

  describe('funciones puras de carta en vivo (T5)', () => {
    const listaPlatos = [
      { id: 101, nombre: 'Guacamole', disponible: true },
      { id: 102, nombre: 'Hamburguesa', disponible: true },
    ];

    it('agotar un plato en la lista de la carta', () => {
      const res = aplicarDisponibilidadEnListaPlatos(listaPlatos, 101, false);
      expect(res[0].disponible).toBe(false);
      expect(res[1].disponible).toBe(true);
      // Inmutabilidad
      expect(res).not.toBe(listaPlatos);
      expect(listaPlatos[0].disponible).toBe(true);
    });

    it('reponer un plato agotado en la lista de la carta', () => {
      const listaConAgotado = [
        { id: 101, nombre: 'Guacamole', disponible: false },
      ];
      const res = aplicarDisponibilidadEnListaPlatos(listaConAgotado, 101, true);
      expect(res[0].disponible).toBe(true);
    });

    it('ingrediente que agota un armable cuando un paso obligatorio queda sin opciones', () => {
      const armables = [
        {
          id_plato: 201,
          nombre: 'Bowl Personalizado',
          disponible: true,
          pasos: [
            {
              id_paso: 1,
              nombre: 'Base',
              obligatorio: true,
              ingredientes: [
                { id_ingrediente: 1, nombre: 'Arroz', disponible: true },
              ],
            },
            {
              id_paso: 2,
              nombre: 'Topping',
              obligatorio: false,
              ingredientes: [
                { id_ingrediente: 2, nombre: 'Semillas', disponible: true },
              ],
            },
          ],
        },
      ];

      // Agotar el único ingrediente de la base obligatoria
      const resAgotado = aplicarDisponibilidadIngredienteEnArmables(armables, 1, false);
      expect(resAgotado[0].pasos[0].ingredientes[0].disponible).toBe(false);
      expect(resAgotado[0].disponible).toBe(false);
      expect(armableTieneStock(resAgotado[0])).toBe(false);

      // Reponer el ingrediente de la base
      const resRepuesto = aplicarDisponibilidadIngredienteEnArmables(resAgotado, 1, true);
      expect(resRepuesto[0].pasos[0].ingredientes[0].disponible).toBe(true);
      expect(resRepuesto[0].disponible).toBe(true);
      expect(armableTieneStock(resRepuesto[0])).toBe(true);
    });

    it('ingrediente opcional agotado no agota el armable completo', () => {
      const armables = [
        {
          id_plato: 201,
          nombre: 'Bowl Personalizado',
          disponible: true,
          pasos: [
            {
              id_paso: 1,
              nombre: 'Base',
              obligatorio: true,
              ingredientes: [
                { id_ingrediente: 1, nombre: 'Arroz', disponible: true },
              ],
            },
            {
              id_paso: 2,
              nombre: 'Topping',
              obligatorio: false,
              ingredientes: [
                { id_ingrediente: 2, nombre: 'Semillas', disponible: true },
              ],
            },
          ],
        },
      ];

      const res = aplicarDisponibilidadIngredienteEnArmables(armables, 2, false);
      expect(res[0].pasos[1].ingredientes[0].disponible).toBe(false);
      expect(res[0].disponible).toBe(true);
    });

    describe('reglas de disponibilidad de armables por ingredientes (T5)', () => {
      const armableBase = [
        {
          id_plato: 201,
          nombre: 'Bowl Personalizado',
          disponible: true,
          pasos: [
            {
              id_paso: 1,
              nombre: 'Base',
              obligatorio: true,
              ingredientes: [
                { id_ingrediente: 1, nombre: 'Arroz', disponible: true },
                { id_ingrediente: 2, nombre: 'Lechuga', disponible: true },
                { id_ingrediente: 3, nombre: 'Quinoa', disponible: true },
              ],
            },
            {
              id_paso: 2,
              nombre: 'Salsa',
              obligatorio: false,
              ingredientes: [
                { id_ingrediente: 4, nombre: 'Vinagreta', disponible: true },
              ],
            },
          ],
        },
      ];

      it('(a) se agota quinoa pero quedan arroz y lechuga en la base → disponible', () => {
        const res = aplicarDisponibilidadIngredienteEnArmables(armableBase, 3, false);
        expect(res[0].pasos[0].ingredientes.find((i) => i.id_ingrediente === 3).disponible).toBe(false);
        expect(res[0].disponible).toBe(true);
        expect(armableTieneStock(res[0])).toBe(true);
      });

      it('(b) se agotan todas las opciones de un paso obligatorio → agotado', () => {
        let estado = aplicarDisponibilidadIngredienteEnArmables(armableBase, 1, false);
        estado = aplicarDisponibilidadIngredienteEnArmables(estado, 2, false);
        estado = aplicarDisponibilidadIngredienteEnArmables(estado, 3, false);
        expect(estado[0].pasos[0].ingredientes.every((i) => !i.disponible)).toBe(true);
        expect(estado[0].disponible).toBe(false);
        expect(armableTieneStock(estado[0])).toBe(false);
      });

      it('(c) se agota la única opción de un paso opcional → disponible', () => {
        const res = aplicarDisponibilidadIngredienteEnArmables(armableBase, 4, false);
        expect(res[0].pasos[1].ingredientes[0].disponible).toBe(false);
        expect(res[0].disponible).toBe(true);
        expect(armableTieneStock(res[0])).toBe(true);
      });

      it('(d) se repone una opción del paso vacío → vuelve a disponible', () => {
        let vacio = aplicarDisponibilidadIngredienteEnArmables(armableBase, 1, false);
        vacio = aplicarDisponibilidadIngredienteEnArmables(vacio, 2, false);
        vacio = aplicarDisponibilidadIngredienteEnArmables(vacio, 3, false);
        expect(vacio[0].disponible).toBe(false);

        // Reponer arroz
        const repuesto = aplicarDisponibilidadIngredienteEnArmables(vacio, 1, true);
        expect(repuesto[0].pasos[0].ingredientes.find((i) => i.id_ingrediente === 1).disponible).toBe(true);
        expect(repuesto[0].disponible).toBe(true);
        expect(armableTieneStock(repuesto[0])).toBe(true);
      });
    });

    it('limpiar marca local de agotado al reponerse un plato o ingrediente', () => {
      marcarFaltantesEnCache([
        { tipo: 'plato', id: 50, nombre: 'Sopa' },
        { tipo: 'ingrediente', id: 99, nombre: 'Queso' },
      ]);
      expect(tieneMarcasAgotadoLocal()).toBe(true);

      limpiarMarcaAgotado('plato', 50);
      expect(obtenerMarcasAgotadoLocal()).toEqual([
        { tipo: 'ingrediente', id: 99, nombre: 'Queso' },
      ]);

      limpiarMarcaAgotado('ingrediente', 99);
      expect(obtenerMarcasAgotadoLocal()).toEqual([]);
      expect(tieneMarcasAgotadoLocal()).toBe(false);
    });
  });
});
