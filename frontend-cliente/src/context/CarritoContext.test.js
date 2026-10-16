import { describe, expect, it } from 'vitest';
import {
  carritoReducer,
  cargarCarritoDeStorage,
  guardarCarritoEnStorage,
  obtenerClaveCarrito,
} from './CarritoContext';

describe('CarritoContext helpers y reducer', () => {
  describe('obtenerClaveCarrito', () => {
    it('devuelve null si la mesa no está definida', () => {
      expect(obtenerClaveCarrito(null)).toBeNull();
      expect(obtenerClaveCarrito(undefined)).toBeNull();
      expect(obtenerClaveCarrito('')).toBeNull();
    });

    it('devuelve la clave con el número o string de la mesa', () => {
      expect(obtenerClaveCarrito(5)).toBe('smartdining_carrito_mesa_5');
      expect(obtenerClaveCarrito('12')).toBe('smartdining_carrito_mesa_12');
    });
  });

  describe('carritoReducer', () => {
    const estadoInicial = { lineas: [] };

    it('agrega líneas correctamente', () => {
      const linea = { id_linea: 'l-1', id_plato: 10, cantidad: 2 };
      const siguiente = carritoReducer(estadoInicial, {
        type: 'AGREGAR_LINEA',
        payload: linea,
      });
      expect(siguiente.lineas).toEqual([linea]);
    });

    it('actualiza la cantidad clampada entre 1 y 20', () => {
      const estadoConLinea = {
        lineas: [{ id_linea: 'l-1', id_plato: 10, cantidad: 2 }],
      };

      const actualizadoNormal = carritoReducer(estadoConLinea, {
        type: 'ACTUALIZAR_CANTIDAD',
        payload: { id_linea: 'l-1', cantidad: 5 },
      });
      expect(actualizadoNormal.lineas[0].cantidad).toBe(5);

      const actualizadoExceso = carritoReducer(estadoConLinea, {
        type: 'ACTUALIZAR_CANTIDAD',
        payload: { id_linea: 'l-1', cantidad: 50 },
      });
      expect(actualizadoExceso.lineas[0].cantidad).toBe(20);

      const actualizadoMinimo = carritoReducer(estadoConLinea, {
        type: 'ACTUALIZAR_CANTIDAD',
        payload: { id_linea: 'l-1', cantidad: -3 },
      });
      expect(actualizadoMinimo.lineas[0].cantidad).toBe(1);

      // Cantidad no finita no modifica estado
      const noFinita = carritoReducer(estadoConLinea, {
        type: 'ACTUALIZAR_CANTIDAD',
        payload: { id_linea: 'l-1', cantidad: NaN },
      });
      expect(noFinita.lineas[0].cantidad).toBe(2);
    });

    it('elimina líneas por id_linea', () => {
      const estado = {
        lineas: [
          { id_linea: 'l-1', id_plato: 1 },
          { id_linea: 'l-2', id_plato: 2 },
        ],
      };
      const siguiente = carritoReducer(estado, {
        type: 'ELIMINAR_LINEA',
        payload: { id_linea: 'l-1' },
      });
      expect(siguiente.lineas).toHaveLength(1);
      expect(siguiente.lineas[0].id_linea).toBe('l-2');
    });

    it('vacía el carrito', () => {
      const estado = {
        lineas: [{ id_linea: 'l-1' }, { id_linea: 'l-2' }],
      };
      const siguiente = carritoReducer(estado, { type: 'VACIAR_CARRITO' });
      expect(siguiente.lineas).toEqual([]);
    });

    it('carga líneas externas en el carrito', () => {
      const lineas = [{ id_linea: 'recuperada-1', cantidad: 1 }];
      const siguiente = carritoReducer(estadoInicial, {
        type: 'CARGAR_CARRITO',
        payload: lineas,
      });
      expect(siguiente.lineas).toEqual(lineas);

      // Si el payload no es arreglo, asigna []
      const fallback = carritoReducer(estadoInicial, {
        type: 'CARGAR_CARRITO',
        payload: null,
      });
      expect(fallback.lineas).toEqual([]);
    });

    it('retorna el mismo estado si la acción no es reconocida', () => {
      const siguiente = carritoReducer(estadoInicial, { type: 'DESCONOCIDA' });
      expect(siguiente).toBe(estadoInicial);
    });
  });

  describe('cargarCarritoDeStorage y guardarCarritoEnStorage', () => {
    it('devuelve array vacio si la clave es nula o vacia', () => {
      expect(cargarCarritoDeStorage(null)).toEqual([]);
      expect(cargarCarritoDeStorage('')).toEqual([]);
    });

    it('maneja almacenamiento simulado', () => {
      const clave = 'test_clave_storage';
      const mockStorage = new Map();
      const storageOriginal = globalThis.localStorage;

      globalThis.localStorage = {
        getItem: (k) => mockStorage.get(k) || null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: (k) => mockStorage.delete(k),
        clear: () => mockStorage.clear(),
      };

      try {
        guardarCarritoEnStorage(clave, [{ id_linea: 'item-1' }]);
        const cargado = cargarCarritoDeStorage(clave);
        expect(cargado).toEqual([{ id_linea: 'item-1' }]);

        // Almacenar formato { lineas: [...] }
        mockStorage.set(clave, JSON.stringify({ lineas: [{ id_linea: 'item-2' }] }));
        expect(cargarCarritoDeStorage(clave)).toEqual([{ id_linea: 'item-2' }]);

        // JSON corrupto devuelve []
        mockStorage.set(clave, 'json corrupto {');
        expect(cargarCarritoDeStorage(clave)).toEqual([]);
      } finally {
        globalThis.localStorage = storageOriginal;
      }
    });
  });
});
