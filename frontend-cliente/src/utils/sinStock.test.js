import { describe, expect, it } from 'vitest';
import {
  faltantesDelItem,
  resumenFaltantes,
  accionErrorPedido,
  estadoStockPlato,
  MENSAJE_CRUCE_PEDIDO,
  MENSAJE_ERROR_PEDIDO_GENERICO,
} from './sinStock';
import { ErrorApi } from '../services/api';

describe('sinStock - logica pura de faltantes de inventario (J-17)', () => {
  describe('faltantesDelItem', () => {
    it('detecta un plato faltante cuando f.tipo === "plato" y f.id === item.id_plato', () => {
      const item = {
        id_linea: 'l-1',
        id_plato: 1008,
        nombre: 'Limonada de Coco',
        cantidad: 2,
      };
      const faltantes = [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
      ];

      expect(faltantesDelItem(item, faltantes)).toEqual([
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
      ]);
    });

    it('detecta un ingrediente faltante dentro de un plato del constructor (f.tipo === "ingrediente")', () => {
      const itemBowl = {
        id_linea: 'l-2',
        id_plato: 1001,
        nombre: 'Bowl Personalizado',
        cantidad: 1,
        ingredientes: [
          { id_ingrediente: 1, porcion: 'normal' },
          { id_ingrediente: 10, porcion: 'extra' },
        ],
      };
      const faltantes = [
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ];

      expect(faltantesDelItem(itemBowl, faltantes)).toEqual([
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ]);
    });

    it('devuelve arreglo vacio cuando el item no tiene faltantes', () => {
      const item = {
        id_linea: 'l-3',
        id_plato: 1006,
        nombre: 'Hamburguesa Smart Angus',
        cantidad: 1,
      };
      const faltantes = [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ];

      expect(faltantesDelItem(item, faltantes)).toEqual([]);
      expect(faltantesDelItem(item, [])).toEqual([]);
    });

    it('NO marca nada cuando faltantes viene con la forma vieja ({ id_plato } o { id_ingrediente } sin tipo ni id)', () => {
      const item = {
        id_linea: 'l-4',
        id_plato: 1008,
        nombre: 'Limonada de Coco',
        cantidad: 1,
        ingredientes: [{ id_ingrediente: 10, porcion: 'normal' }],
      };
      const faltantesFormaVieja = [
        { id_plato: 1008, nombre: 'Limonada de Coco' },
        { id_ingrediente: 10, nombre: 'Aguacate' },
      ];

      expect(faltantesDelItem(item, faltantesFormaVieja)).toEqual([]);
    });
  });

  describe('resumenFaltantes', () => {
    it('identifica que items del carrito quedan afectados y arma el texto con f.nombre para un plato', () => {
      const carrito = [
        { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 1 },
        { id_linea: 'l-2', id_plato: 1006, nombre: 'Hamburguesa Smart Angus', cantidad: 1 },
      ];
      const faltantes = [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
      ];

      const res = resumenFaltantes(carrito, faltantes);

      expect(res.hayFaltantes).toBe(true);
      expect(res.idsLineasAfectadas).toEqual(['l-1']);
      expect(res.idsPlatosAgotados).toEqual([1008]);
      expect(res.texto).toBe(
        'Se acabó: Limonada de Coco. Quítalo para enviar el resto.'
      );
    });

    it('arma el texto explicando que ingrediente se acabo en un plato del constructor', () => {
      const carrito = [
        {
          id_linea: 'l-bowl',
          id_plato: 1001,
          nombre: 'Bowl Personalizado',
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 1, porcion: 'normal' },
            { id_ingrediente: 10, porcion: 'extra' },
          ],
        },
        { id_linea: 'l-hamb', id_plato: 1006, nombre: 'Hamburguesa Smart Angus', cantidad: 1 },
      ];
      const faltantes = [
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ];

      const res = resumenFaltantes(carrito, faltantes);

      expect(res.hayFaltantes).toBe(true);
      expect(res.idsLineasAfectadas).toEqual(['l-bowl']);
      expect(res.idsIngredientesAgotados).toEqual([10]);
      expect(res.itemsAfectados[0].platoAgotado).toBe(false);
      expect(res.itemsAfectados[0].ingredientesAgotados).toEqual([
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ]);
      expect(res.texto).toBe(
        'Se acabó el ingrediente Aguacate en tu Bowl Personalizado. Quítalo para enviar el resto.'
      );
    });
  });

  describe('accionErrorPedido', () => {
    it('409 sin_stock devuelve { tipo: "sin_stock", faltantes, mensaje } con los datos reales', () => {
      const carrito = [
        { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 1 },
      ];
      const err = new ErrorApi({
        status: 409,
        motivo: 'sin_stock',
        mensaje: 'Sin stock suficiente para el pedido',
        faltantes: [{ tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' }],
      });

      const accion = accionErrorPedido(err, carrito);

      expect(accion.tipo).toBe('sin_stock');
      expect(accion.faltantes).toEqual([
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
      ]);
      expect(accion.mensaje).toContain('Limonada de Coco');
      expect(accion.idsLineasAfectadas).toEqual(['l-1']);
    });

    it('503 reintentar devuelve el mensaje exacto de cruce de pedidos', () => {
      const err = new ErrorApi({
        status: 503,
        motivo: 'reintentar',
        mensaje: 'intenta de nuevo',
      });

      const accion = accionErrorPedido(err);

      expect(accion.tipo).toBe('reintentar');
      expect(accion.mensaje).toBe(MENSAJE_CRUCE_PEDIDO);
      expect(accion.mensaje).toBe(
        'Hubo un cruce con otro pedido, vuelve a enviarlo.'
      );
    });

    it('otros errores devuelven el mensaje generico de siempre', () => {
      const err500 = new ErrorApi({
        status: 500,
      });
      const accion500 = accionErrorPedido(err500);
      expect(accion500.tipo).toBe(500);
      expect(accion500.mensaje).toBe(MENSAJE_ERROR_PEDIDO_GENERICO);

      const err503Timeout = new ErrorApi({
        status: 503,
        mensaje:
          'La operación tardó demasiado y se canceló, vuelve a intentarlo en un momento',
      });
      const accionTimeout = accionErrorPedido(err503Timeout);
      expect(accionTimeout.tipo).toBe(503);
      expect(accionTimeout.mensaje).toContain('tardó demasiado');
    });
  });

  describe('estadoStockPlato', () => {
    it('devuelve "agotado", "pocas" o "normal" segun los campos del plato', () => {
      expect(estadoStockPlato({ id_plato: 1, disponible: false })).toBe('agotado');
      expect(estadoStockPlato({ id_plato: 1, stock_suficiente: false })).toBe('agotado');
      expect(estadoStockPlato({ id_plato: 1, pocas_unidades: true })).toBe('pocas');
      expect(estadoStockPlato({ id_plato: 1 })).toBe('normal');
      expect(estadoStockPlato(null)).toBe('agotado');
    });
  });
});
