import { describe, expect, it } from 'vitest';
import {
  extraerNombreIngredienteAgotado,
  faltantesDelItem,
  resumenFaltantes,
  accionErrorPedido,
  marcasAgotadoTrasRecarga,
  actualizarMarcasPorDisponibilidad,
  estadoStockPlato,
  MENSAJE_CRUCE_PEDIDO,
  MENSAJE_ERROR_PEDIDO_GENERICO,
  MENSAJE_SIN_STOCK_GENERICO,
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

    it('cuando faltantes viene vacio ([]), ausente o null deja el carrito intacto y expone el aviso generico', () => {
      const carrito = [
        { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 1 },
      ];

      for (const caso of [[], undefined, null]) {
        const res = resumenFaltantes(carrito, caso);
        expect(res.hayFaltantes).toBe(false);
        expect(res.faltantes).toEqual([]);
        expect(res.itemsAfectados).toEqual([]);
        expect(res.idsLineasAfectadas).toEqual([]);
        expect(res.texto).toBe('');
        expect(res.mensaje).toBe(
          'Algo de tu pedido se acabó. Revisa el carrito e inténtalo de nuevo.'
        );
        expect(res.mensaje).toBe(MENSAJE_SIN_STOCK_GENERICO);
      }
    });

    describe('ajuste de cantidad por stock disponible (T5)', () => {
      it('disponible 2 con cantidad 3 → Ajustar a 2', () => {
        const carrito = [
          { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 3 },
        ];
        const faltantes = [
          { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco', disponible: 2 },
        ];

        const res = resumenFaltantes(carrito, faltantes);
        expect(res.hayFaltantes).toBe(true);
        expect(res.itemsAfectados).toHaveLength(1);
        expect(res.itemsAfectados[0].disponible).toBe(2);
        expect(res.itemsAfectados[0].puedeAjustar).toBe(true);
        expect(res.itemsAfectados[0].idLinea).toBe('l-1');
        expect(res.itemsAfectados[0].etiqueta).toBe('Solo quedan 2');
        expect(res.lineasAfectadas).toEqual([
          { idLinea: 'l-1', id_linea: 'l-1', disponible: 2, puedeAjustar: true },
        ]);
      });

      it('0 → solo Quitar', () => {
        const carrito = [
          { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 3 },
        ];
        const faltantes = [
          { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco', disponible: 0 },
        ];

        const res = resumenFaltantes(carrito, faltantes);
        expect(res.itemsAfectados[0].disponible).toBe(0);
        expect(res.itemsAfectados[0].puedeAjustar).toBe(false);
      });

      it('sin campo disponible → solo Quitar', () => {
        const carrito = [
          { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 3 },
        ];
        const faltantes = [
          { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
        ];

        const res = resumenFaltantes(carrito, faltantes);
        expect(res.itemsAfectados[0].disponible).toBeNull();
        expect(res.itemsAfectados[0].puedeAjustar).toBe(false);
      });

      it('ingrediente que afecta a 1 línea armable → ajusta la cantidad del plato', () => {
        const carrito = [
          {
            id_linea: 'l-bowl',
            id_plato: 1001,
            nombre: 'Bowl Personalizado',
            cantidad: 3,
            ingredientes: [{ id_ingrediente: 10, nombre: 'Aguacate' }],
          },
        ];
        const faltantes = [
          { tipo: 'ingrediente', id: 10, nombre: 'Aguacate', disponible: 1 },
        ];

        const res = resumenFaltantes(carrito, faltantes);
        expect(res.itemsAfectados[0].disponible).toBe(1);
        expect(res.itemsAfectados[0].puedeAjustar).toBe(true);
        expect(res.itemsAfectados[0].cantidad).toBe(3);
        expect(res.itemsAfectados[0].idLinea).toBe('l-bowl');
      });

      it('ingrediente que afecta a 2 líneas → solo Quitar', () => {
        const carrito = [
          {
            id_linea: 'l-bowl-1',
            id_plato: 1001,
            nombre: 'Bowl 1',
            cantidad: 2,
            ingredientes: [{ id_ingrediente: 10, nombre: 'Aguacate' }],
          },
          {
            id_linea: 'l-bowl-2',
            id_plato: 1001,
            nombre: 'Bowl 2',
            cantidad: 2,
            ingredientes: [{ id_ingrediente: 10, nombre: 'Aguacate' }],
          },
        ];
        const faltantes = [
          { tipo: 'ingrediente', id: 10, nombre: 'Aguacate', disponible: 2 },
        ];

        const res = resumenFaltantes(carrito, faltantes);
        expect(res.itemsAfectados[0].puedeAjustar).toBe(false);
        expect(res.itemsAfectados[1].puedeAjustar).toBe(false);
      });

      it('disponible inválido (negativo, texto) → solo Quitar', () => {
        const carrito = [
          { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 3 },
        ];

        const resNeg = resumenFaltantes(carrito, [
          { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco', disponible: -1 },
        ]);
        expect(resNeg.itemsAfectados[0].disponible).toBeNull();
        expect(resNeg.itemsAfectados[0].puedeAjustar).toBe(false);

        const resTxt = resumenFaltantes(carrito, [
          { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco', disponible: 'no-disponible' },
        ]);
        expect(resTxt.itemsAfectados[0].disponible).toBeNull();
        expect(resTxt.itemsAfectados[0].puedeAjustar).toBe(false);
      });
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
      expect(accion.puedeEnviar).toBe(false);
    });

    it('409 sin_stock con faltantes [] muestra el aviso generico, no marca lineas y deja enviar', () => {
      const carrito = [
        { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 1 },
      ];
      const err = new ErrorApi({
        status: 409,
        motivo: 'sin_stock',
        mensaje: 'Sin stock suficiente para el pedido',
        faltantes: [],
      });

      const accion = accionErrorPedido(err, carrito);

      expect(accion.tipo).toBe('sin_stock');
      expect(accion.hayFaltantes).toBe(false);
      expect(accion.puedeEnviar).toBe(true);
      expect(accion.faltantes).toEqual([]);
      expect(accion.itemsAfectados).toEqual([]);
      expect(accion.idsLineasAfectadas).toEqual([]);
      expect(accion.mensaje).toBe(
        'Algo de tu pedido se acabó. Revisa el carrito e inténtalo de nuevo.'
      );
      expect(accion.ayuda).toBeNull();
    });

    it('409 sin_stock con faltantes ausente muestra el aviso generico, no marca lineas y deja enviar', () => {
      const carrito = [
        { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 1 },
      ];
      const err = {
        status: 409,
        motivo: 'sin_stock',
        mensaje: 'Sin stock suficiente para el pedido',
      };

      const accion = accionErrorPedido(err, carrito);

      expect(accion.tipo).toBe('sin_stock');
      expect(accion.hayFaltantes).toBe(false);
      expect(accion.puedeEnviar).toBe(true);
      expect(accion.faltantes).toEqual([]);
      expect(accion.idsLineasAfectadas).toEqual([]);
      expect(accion.mensaje).toBe(
        'Algo de tu pedido se acabó. Revisa el carrito e inténtalo de nuevo.'
      );
      expect(accion.ayuda).toBeNull();
    });

    it('409 sin_stock con faltantes null muestra el aviso generico, no marca lineas y deja enviar', () => {
      const carrito = [
        { id_linea: 'l-1', id_plato: 1008, nombre: 'Limonada de Coco', cantidad: 1 },
      ];
      const err = new ErrorApi({
        status: 409,
        motivo: 'sin_stock',
        mensaje: 'Sin stock suficiente para el pedido',
        faltantes: null,
      });

      const accion = accionErrorPedido(err, carrito);

      expect(accion.tipo).toBe('sin_stock');
      expect(accion.hayFaltantes).toBe(false);
      expect(accion.puedeEnviar).toBe(true);
      expect(accion.faltantes).toEqual([]);
      expect(accion.idsLineasAfectadas).toEqual([]);
      expect(accion.mensaje).toBe(
        'Algo de tu pedido se acabó. Revisa el carrito e inténtalo de nuevo.'
      );
      expect(accion.ayuda).toBeNull();
    });

    it('409 ingrediente_agotado con la forma real del backend marca la linea del carrito con el ingrediente agotado', () => {
      const carrito = [
        {
          id_linea: 'l-bowl-1',
          id_plato: 1001,
          nombre: 'Bowl Personalizado',
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 1, porcion: 'normal' },
            { id_ingrediente: 10, porcion: 'extra' },
          ],
          detalle: [
            { paso: 'Elige tu Base', nombre: 'Arroz Integral', porcion: 'normal' },
            { paso: 'Añade Toppings', nombre: 'Aguacate', porcion: 'extra' },
          ],
        },
        {
          id_linea: 'l-bowl-2',
          id_plato: 1001,
          nombre: 'Bowl Personalizado',
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 1, porcion: 'normal' },
            { id_ingrediente: 4, porcion: 'normal' },
          ],
          detalle: [
            { paso: 'Elige tu Base', nombre: 'Arroz Integral', porcion: 'normal' },
            { paso: 'Elige tu Proteína', nombre: 'Pollo a la Plancha', porcion: 'normal' },
          ],
        },
        {
          id_linea: 'l-hamb',
          id_plato: 1006,
          nombre: 'Hamburguesa Smart Angus',
          cantidad: 1,
        },
      ];

      // Forma real de backend/src/middleware/inventario-errores.js:
      // 409 { error: 'El ingrediente "Aguacate" está agotado', motivo: 'ingrediente_agotado' }
      const err = new ErrorApi({
        status: 409,
        motivo: 'ingrediente_agotado',
        mensaje: 'El ingrediente "Aguacate" está agotado',
      });

      expect(extraerNombreIngredienteAgotado(err)).toBe('Aguacate');

      const accion = accionErrorPedido(err, carrito);

      expect(accion.tipo).toBe('sin_stock');
      expect(accion.motivo).toBe('ingrediente_agotado');
      expect(accion.hayFaltantes).toBe(true);
      expect(accion.puedeEnviar).toBe(false);
      expect(accion.idsLineasAfectadas).toEqual(['l-bowl-1']);
      expect(accion.faltantes).toEqual([
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ]);
      expect(accion.mensaje).toBe(
        'Se acabó el ingrediente Aguacate en tu Bowl Personalizado. Quítalo para enviar el resto.'
      );

      // Verifica que faltantesDelItem marque la linea afectada igual que sin_stock de ingrediente
      expect(faltantesDelItem(carrito[0], accion.faltantes)).toEqual([
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
      ]);
      expect(faltantesDelItem(carrito[1], accion.faltantes)).toEqual([]);
      expect(faltantesDelItem(carrito[2], accion.faltantes)).toEqual([]);
    });

    it('con dos platos armables (Bowl CON Aguacate y Wrap SIN Aguacate), 409 ingrediente_agotado de Aguacate solo marca el Bowl y no el Wrap', () => {
      const carrito = [
        {
          id_linea: 'l-bowl',
          id_plato: 1001,
          nombre: 'Bowl Personalizado',
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 1, porcion: 'normal' },
            { id_ingrediente: 10, porcion: 'normal' },
          ],
          detalle: [
            { paso: 'Elige tu Base', nombre: 'Arroz Integral', porcion: 'normal' },
            { paso: 'Añade Toppings', nombre: 'Aguacate', porcion: 'normal' },
          ],
        },
        {
          id_linea: 'l-wrap',
          id_plato: 1002,
          nombre: 'Wrap Personalizado',
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 17, porcion: 'normal' },
            { id_ingrediente: 19, porcion: 'normal' },
          ],
          detalle: [
            { paso: 'Tipo de Tortilla', nombre: 'Tortilla de Harina', porcion: 'normal' },
            { paso: 'Elige tu Proteína', nombre: 'Pollo a la Plancha', porcion: 'normal' },
          ],
        },
      ];
      const err = {
        status: 409,
        motivo: 'ingrediente_agotado',
        error: 'El ingrediente "Aguacate" está agotado',
      };

      const accion = accionErrorPedido(err, carrito);

      expect(accion.tipo).toBe('sin_stock');
      expect(accion.motivo).toBe('ingrediente_agotado');
      expect(accion.idsLineasAfectadas).toEqual(['l-bowl']);
      expect(faltantesDelItem(carrito[0], accion.faltantes)).toHaveLength(1);
      expect(faltantesDelItem(carrito[0], accion.faltantes)[0].nombre).toBe(
        'Aguacate'
      );
      expect(faltantesDelItem(carrito[1], accion.faltantes)).toEqual([]);
    });

    it('en carrito compartido con lineas de dos comensales distintos, 409 ingrediente_agotado marca solo la linea que lleva ese ingrediente', () => {
      const carritoCompartido = [
        {
          id_linea: 'l-ana-wrap',
          comensal: 'Ana',
          esMia: true,
          id_plato: 1002,
          nombre: 'Wrap Personalizado',
          cantidad: 1,
          ingredientes: [{ id_ingrediente: 17, porcion: 'normal' }],
          detalle: [
            { paso: 'Tipo de Tortilla', nombre: 'Tortilla de Harina', porcion: 'normal' },
          ],
        },
        {
          id_linea: 'l-luis-bowl',
          comensal: 'Luis',
          esMia: false,
          id_plato: 1001,
          nombre: 'Bowl Personalizado',
          cantidad: 1,
          ingredientes: [
            { id_ingrediente: 1, porcion: 'normal' },
            { id_ingrediente: 7, porcion: 'normal' },
          ],
          detalle: [
            { paso: 'Elige tu Base', nombre: 'Arroz Integral', porcion: 'normal' },
            { paso: 'Elige tu Proteína', nombre: 'Panceta Crujiente', porcion: 'normal' },
          ],
        },
      ];
      const err = new ErrorApi({
        status: 409,
        motivo: 'ingrediente_agotado',
        mensaje: 'El ingrediente "Panceta Crujiente" está agotado',
      });

      const accion = accionErrorPedido(err, carritoCompartido);

      expect(accion.idsLineasAfectadas).toEqual(['l-luis-bowl']);
      expect(faltantesDelItem(carritoCompartido[0], accion.faltantes)).toEqual([]);
      expect(faltantesDelItem(carritoCompartido[1], accion.faltantes)).toEqual([
        { tipo: 'ingrediente', id: 7, nombre: 'Panceta Crujiente' },
      ]);
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

  describe('marcasAgotadoTrasRecarga y actualizarMarcasPorDisponibilidad', () => {
    const menuNuevo = {
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
                    { id_ingrediente: 7, nombre: 'Panceta Crujiente', disponible: false },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    it('limpia la marca local si el plato vuelve a aparecer en GET /menu y conserva los que no aparecen', () => {
      const marcasObjetos = [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
        { tipo: 'plato', id: 1099, nombre: 'Plato Sin Stock' },
      ];
      expect(marcasAgotadoTrasRecarga(marcasObjetos, menuNuevo)).toEqual([
        { tipo: 'plato', id: 1099, nombre: 'Plato Sin Stock' },
      ]);

      const marcasIds = [1008, 1099];
      expect(marcasAgotadoTrasRecarga(marcasIds, menuNuevo)).toEqual([1099]);

      const marcasSet = new Set([1008, 1099]);
      expect(marcasAgotadoTrasRecarga(marcasSet, menuNuevo)).toEqual(
        new Set([1099])
      );
    });

    it('limpia ingrediente que vuelve disponible en GET /menu y conserva el que sigue disponible: false', () => {
      const marcasIng = [
        { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
        { tipo: 'ingrediente', id: 7, nombre: 'Panceta Crujiente' },
      ];
      expect(marcasAgotadoTrasRecarga(marcasIng, menuNuevo)).toEqual([
        { tipo: 'ingrediente', id: 7, nombre: 'Panceta Crujiente' },
      ]);
    });

    it('limpia la marca local cuando llega plato:disponibilidad con disponible: true', () => {
      const marcas = [
        { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
        { tipo: 'plato', id: 1099, nombre: 'Otro Plato' },
      ];
      const trasReponer = actualizarMarcasPorDisponibilidad(marcas, {
        tipo: 'plato',
        id_plato: 1008,
        disponible: true,
      });
      expect(trasReponer).toEqual([
        { tipo: 'plato', id: 1099, nombre: 'Otro Plato' },
      ]);
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
