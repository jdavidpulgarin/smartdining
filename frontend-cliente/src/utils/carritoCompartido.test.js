import { describe, expect, it } from 'vitest';
import {
  agruparPorComensal,
  buscarPlatoEnMenu,
  construirRemove,
  construirSet,
  enriquecerItems,
  puedoEnviar,
  totalesMesa,
  traducirErrorSocket,
} from './carritoCompartido';

describe('carritoCompartido utils', () => {
  const mockMenu = [
    {
      id_categoria: 1,
      categoria: 'Entradas',
      platos: [
        {
          id_plato: 501,
          nombre: 'Empanadas',
          precio: 12000,
          personalizable: false,
          url_imagen: 'https://ejemplo.com/empanada.jpg',
          calorias: 250,
          alergenos: ['gluten'],
          disponible: true,
        },
      ],
    },
    {
      id_categoria: 2,
      categoria: 'Arma tu plato',
      platos: [
        {
          id_plato: 1001,
          nombre: 'Bowl Personalizado',
          precio: 20000,
          personalizable: true,
          calorias: 450,
          disponible: true,
          pasos: [
            {
              id_paso: 101,
              nombre: 'Base',
              min_sel: 1,
              max_sel: 1,
              ingredientes: [
                {
                  id_ingrediente: 1,
                  nombre: 'Arroz Integral',
                  precio_extra: 0,
                  calorias: 180,
                  alergenos: ['gluten'],
                  disponible: true,
                },
                {
                  id_ingrediente: 2,
                  nombre: 'Quinoa',
                  precio_extra: 2000,
                  calorias: 160,
                  alergenos: [],
                  disponible: true,
                },
              ],
            },
            {
              id_paso: 102,
              nombre: 'Proteína',
              min_sel: 1,
              max_sel: 1,
              ingredientes: [
                {
                  id_ingrediente: 4,
                  nombre: 'Pollo a la Plancha',
                  precio_extra: 0,
                  calorias: 220,
                  alergenos: [],
                  disponible: true,
                },
                {
                  id_ingrediente: 7,
                  nombre: 'Panceta Crujiente',
                  precio_extra: 3000,
                  calorias: 340,
                  alergenos: [],
                  disponible: false,
                },
              ],
            },
          ],
        },
      ],
    },
  ];

  const platoSimple = mockMenu[0].platos[0];
  const platoArmable = mockMenu[1].platos[0];

  describe('buscarPlatoEnMenu', () => {
    it('encuentra un plato en un array de categorias', () => {
      const encontrado = buscarPlatoEnMenu(mockMenu, platoSimple.id_plato);
      expect(encontrado).toBeDefined();
      expect(encontrado.id_plato).toBe(platoSimple.id_plato);
    });

    it('encuentra un plato en un objeto con propiedad categorias', () => {
      const encontrado = buscarPlatoEnMenu(
        { categorias: mockMenu },
        platoSimple.id_plato
      );
      expect(encontrado).toBeDefined();
      expect(encontrado.id_plato).toBe(platoSimple.id_plato);
    });

    it('devuelve null si el plato no existe', () => {
      expect(buscarPlatoEnMenu(mockMenu, 999999)).toBeNull();
      expect(buscarPlatoEnMenu(null, 101)).toBeNull();
    });
  });

  describe('enriquecerItems', () => {
    it('devuelve array vacio si recibe items nulos o no array', () => {
      expect(enriquecerItems(null, mockMenu, 'Juan')).toEqual([]);
      expect(enriquecerItems(undefined, mockMenu, 'Juan')).toEqual([]);
    });

    it('enriquece platos simples y distingue esMia segun alias (case-insensitive)', () => {
      const items = [
        {
          id_linea: 'linea-1',
          comensal: 'juan',
          id_plato: platoSimple.id_plato,
          cantidad: 2,
          notas: 'Sin sal',
        },
        {
          id_linea: 'linea-2',
          comensal: 'Carlos',
          id_plato: platoSimple.id_plato,
          cantidad: 1,
        },
      ];

      const enriquecidos = enriquecerItems(items, mockMenu, 'Juan');
      expect(enriquecidos).toHaveLength(2);

      expect(enriquecidos[0].esMia).toBe(true);
      expect(enriquecidos[0].nombre).toBe(platoSimple.nombre);
      expect(enriquecidos[0].precioUnitario).toBe(platoSimple.precio);
      expect(enriquecidos[0].subtotal).toBe(platoSimple.precio * 2);
      expect(enriquecidos[0].notas).toBe('Sin sal');
      expect(enriquecidos[0].disponible).toBe(true);

      expect(enriquecidos[1].esMia).toBe(false);
      expect(enriquecidos[1].subtotal).toBe(platoSimple.precio);
    });

    it('maneja platos no encontrados en el menu', () => {
      const items = [
        {
          id_linea: 'linea-x',
          comensal: 'Juan',
          id_plato: 999999,
          cantidad: 1,
        },
      ];

      const [item] = enriquecerItems(items, mockMenu, 'Juan');
      expect(item.nombre).toBe('Plato no disponible');
      expect(item.precioUnitario).toBe(0);
      expect(item.subtotal).toBe(0);
      expect(item.disponible).toBe(false);
    });

    it('enriquece plato armable calculando precio con extras', () => {
      const items = [
        {
          id_linea: 'linea-armable',
          comensal: 'Juan',
          id_plato: platoArmable.id_plato,
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 2, porcion: 'extra' },
            { id_ingrediente: 4, porcion: 'normal' },
          ],
        },
      ];

      const [enriquecido] = enriquecerItems(items, mockMenu, 'Juan');
      expect(enriquecido.precioUnitario).toBe(platoArmable.precio + 2000);
      expect(enriquecido.subtotal).toBe(platoArmable.precio + 2000);
      expect(enriquecido.detalle.length).toBeGreaterThan(0);
      expect(enriquecido.disponible).toBe(true);
    });

    it('marca disponible = false si un ingrediente del plato armable esta agotado', () => {
      const items = [
        {
          id_linea: 'linea-agotada',
          comensal: 'Juan',
          id_plato: platoArmable.id_plato,
          cantidad: 1,
          ingredientes: [{ id_ingrediente: 7, porcion: 'normal' }], // panceta esta disponible: false
        },
      ];

      const [enriquecido] = enriquecerItems(items, mockMenu, 'Juan');
      expect(enriquecido.disponible).toBe(false);
    });

    it('clampa cantidad entre 1 y 20 y trunca notas a 200 caracteres', () => {
      const items = [
        {
          id_linea: 'linea-clamp',
          comensal: 'Juan',
          id_plato: platoSimple.id_plato,
          cantidad: 99,
          notas: 'A'.repeat(300),
        },
      ];

      const [enriquecido] = enriquecerItems(items, mockMenu, 'Juan');
      expect(enriquecido.cantidad).toBe(20);
      expect(enriquecido.notas.length).toBe(200);
    });
  });

  describe('agruparPorComensal', () => {
    it('separa mis platos de los de la mesa y ordena a los demas alfabeticamente', () => {
      const lineas = [
        { id_linea: '1', comensal: 'Juan', esMia: true, subtotal: 10000 },
        { id_linea: '2', comensal: 'Pedro', esMia: false, subtotal: 15000 },
        { id_linea: '3', comensal: 'Ana', esMia: false, subtotal: 8000 },
        { id_linea: '4', comensal: 'Pedro', esMia: false, subtotal: 5000 },
      ];

      const { mias, otros } = agruparPorComensal(lineas, 'Juan');
      expect(mias).toHaveLength(1);
      expect(mias[0].id_linea).toBe('1');

      expect(otros).toHaveLength(2);
      expect(otros[0].comensal).toBe('Ana');
      expect(otros[0].subtotal).toBe(8000);
      expect(otros[1].comensal).toBe('Pedro');
      expect(otros[1].subtotal).toBe(20000);
      expect(otros[1].lineas).toHaveLength(2);
    });

    it('maneja listas vacias o invalidas', () => {
      expect(agruparPorComensal(null)).toEqual({ mias: [], otros: [] });
      expect(agruparPorComensal([])).toEqual({ mias: [], otros: [] });
    });
  });

  describe('construirSet', () => {
    it('genera payload limpio para socket sin campos prohibidos', () => {
      const linea = {
        id_linea: 'lin-123',
        id_plato: '1001',
        cantidad: 3,
        notas: 'Bien cocido',
        comensal: 'Juan',
        nombre: 'Bowl Fit',
        precio: 25000,
        id_mesa: 5,
        ingredientes: [
          { id_ingrediente: 1, porcion: 'normal' },
          { id_ingrediente: 1, porcion: 'extra' }, // repetido
          { id_ingrediente: 2, porcion: 'extra' },
        ],
      };

      const payload = construirSet(linea);

      expect(payload).toEqual({
        accion: 'set',
        id_linea: 'lin-123',
        id_plato: 1001,
        cantidad: 3,
        notas: 'Bien cocido',
        ingredientes: [
          { id_ingrediente: 1, porcion: 'normal' },
          { id_ingrediente: 2, porcion: 'extra' },
        ],
      });

      expect(payload.comensal).toBeUndefined();
      expect(payload.nombre).toBeUndefined();
      expect(payload.precio).toBeUndefined();
      expect(payload.id_mesa).toBeUndefined();
    });

    it('limita cantidad entre 1 y 20 y maximo 20 ingredientes', () => {
      const muchosIngredientes = Array.from({ length: 30 }, (_, i) => ({
        id_ingrediente: i + 1,
        porcion: 'normal',
      }));

      const payload = construirSet({
        id_linea: 'lin-test',
        id_plato: 10,
        cantidad: 50,
        ingredientes: muchosIngredientes,
      });

      expect(payload.cantidad).toBe(20);
      expect(payload.ingredientes).toHaveLength(20);
    });

    it('lanza error si falta id_linea o id_plato', () => {
      expect(() => construirSet(null)).toThrow('linea es requerida');
      expect(() => construirSet({ id_linea: '1' })).toThrow(
        'id_plato válido es requerido'
      );
    });
  });

  describe('construirRemove', () => {
    it('genera payload de remove correctamente', () => {
      expect(construirRemove('lin-99')).toEqual({
        accion: 'remove',
        id_linea: 'lin-99',
      });
    });

    it('lanza error si id_linea es falsy', () => {
      expect(() => construirRemove('')).toThrow('id_linea es requerido');
      expect(() => construirRemove(null)).toThrow('id_linea es requerido');
    });
  });

  describe('totalesMesa', () => {
    it('calcula total mio, total de la mesa y unidades', () => {
      const lineas = [
        { esMia: true, subtotal: 15000, cantidad: 1 },
        { esMia: false, subtotal: 20000, cantidad: 2 },
        { esMia: true, subtotal: 10000, cantidad: 1 },
      ];

      const totales = totalesMesa(lineas);
      expect(totales.mio).toBe(25000);
      expect(totales.mesa).toBe(45000);
      expect(totales.unidades).toBe(4);
    });

    it('devuelve ceros con listas vacias', () => {
      expect(totalesMesa([])).toEqual({ mio: 0, mesa: 0, unidades: 0 });
      expect(totalesMesa(null)).toEqual({ mio: 0, mesa: 0, unidades: 0 });
    });
  });

  describe('puedoEnviar', () => {
    it('falla si misLineas esta vacio', () => {
      const res = puedoEnviar([]);
      expect(res.ok).toBe(false);
      expect(res.motivo).toBe('No tienes platos en tu pedido');
    });

    it('falla si supera 50 items', () => {
      const muchas = Array.from({ length: 51 }, () => ({ disponible: true }));
      const res = puedoEnviar(muchas);
      expect(res.ok).toBe(false);
      expect(res.motivo).toBe('No puedes enviar más de 50 ítems por pedido');
    });

    it('falla si algun plato tiene ingredientes agotados', () => {
      const lineas = [{ disponible: true }, { disponible: false }];
      const res = puedoEnviar(lineas);
      expect(res.ok).toBe(false);
      expect(res.motivo).toContain('ingredientes agotados');
    });

    it('permite envio si todo esta en orden', () => {
      const lineas = [{ disponible: true }, { disponible: true }];
      const res = puedoEnviar(lineas);
      expect(res.ok).toBe(true);
      expect(res.motivo).toBeNull();
    });
  });

  describe('traducirErrorSocket', () => {
    it('traduce codigos conocidos', () => {
      expect(traducirErrorSocket('NO_AUTORIZADO')).toBe(
        'Solo puedes cambiar tus propios platos'
      );
      expect(traducirErrorSocket('RATE_LIMIT')).toBe(
        'Vas muy rápido, espera un momento'
      );
      expect(traducirErrorSocket('PAYLOAD_INVALIDO')).toBe(
        'No se pudo guardar ese cambio'
      );
      expect(traducirErrorSocket('SIN_RESPUESTA')).toBe(
        'Sin conexión, reintentando…'
      );
      expect(traducirErrorSocket('ERROR_INTERNO')).toBe(
        'Sin conexión, reintentando…'
      );
      expect(traducirErrorSocket('SIN_SALA')).toBe('Conectando con la mesa…');
      expect(traducirErrorSocket('SESION_CERRADA')).toBe(
        'La sesión de la mesa terminó'
      );
    });

    it('acepta objetos de error con codigo o message', () => {
      expect(traducirErrorSocket(null, { codigo: 'NO_AUTORIZADO' })).toBe(
        'Solo puedes cambiar tus propios platos'
      );
      expect(traducirErrorSocket(null, new Error('RATE_LIMIT'))).toBe(
        'Vas muy rápido, espera un momento'
      );
    });

    it('usa fallback para codigos desconocidos', () => {
      expect(traducirErrorSocket('DESCONOCIDO')).toBe(
        'No se pudo actualizar el carrito'
      );
    });
  });
});
