import { describe, expect, it } from 'vitest';
import {
  aplicarCambioEstado,
  haceCuanto,
  infoEstado,
  normalizarPedido,
  pedidoPrincipal,
  separarPedidos,
} from './seguimiento';

describe('infoEstado', () => {
  it('retorna la información correcta para estado "recibido"', () => {
    const res = infoEstado('recibido', 5);
    expect(res.titulo).toBe('YA LO TENEMOS');
    expect(res.pill).toBe('RECIBIDO');
    expect(res.indicePaso).toBe(0);
    expect(res.conTimeline).toBe(true);
    expect(res.color).toBe('#FFFFFF');
    expect(res.mensaje).toBe('Recibimos tu pedido y ya lo estamos revisando.');
  });

  it('retorna la información correcta para estado "en_preparacion"', () => {
    const res = infoEstado('en_preparacion');
    expect(res.titulo).toBe('ESTAMOS COCINANDO');
    expect(res.pill).toBe('EN PREPARACIÓN');
    expect(res.indicePaso).toBe(1);
    expect(res.conTimeline).toBe(true);
    expect(res.color).toBe('#F2B705');
    expect(res.mensaje).toBe('El chef está preparando tu pedido.');
  });

  it('retorna la información correcta para estado "listo" con mesa', () => {
    const res = infoEstado('listo', 5);
    expect(res.titulo).toBe('¡SALE CALIENTE!');
    expect(res.pill).toBe('LISTO');
    expect(res.indicePaso).toBe(2);
    expect(res.conTimeline).toBe(true);
    expect(res.color).toBe('#FF5A5F');
    expect(res.mensaje).toBe(
      'Tu pedido va camino a la mesa 5. Prepara el tenedor.'
    );
  });

  it('retorna la información correcta para estado "entregado" y "pagado"', () => {
    const entregado = infoEstado('entregado', 5);
    expect(entregado.titulo).toBe('¡BUEN PROVECHO!');
    expect(entregado.pill).toBe('ENTREGADO');
    expect(entregado.indicePaso).toBe(3);
    expect(entregado.conTimeline).toBe(true);
    expect(entregado.mensaje).toBe('Tu pedido ya está en la mesa 5.');

    const pagado = infoEstado('pagado', 5);
    expect(pagado.titulo).toBe('¡BUEN PROVECHO!');
    expect(pagado.indicePaso).toBe(3);
  });

  it('retorna la información correcta para estado "cancelado"', () => {
    const res = infoEstado('cancelado');
    expect(res.titulo).toBe('PEDIDO CANCELADO');
    expect(res.pill).toBe('CANCELADO');
    expect(res.indicePaso).toBe(-1);
    expect(res.conTimeline).toBe(false);
    expect(res.color).toBe('#A3A3A3');
    expect(res.mensaje).toBe('Habla con el mesero si tienes dudas.');
  });

  it('usa recibido como fallback para estados desconocidos o nulos', () => {
    const resVacio = infoEstado(null);
    expect(resVacio.titulo).toBe('YA LO TENEMOS');
    const resRaro = infoEstado('estado_inexistente');
    expect(resRaro.titulo).toBe('YA LO TENEMOS');
  });
});

describe('normalizarPedido', () => {
  it('normaliza la estructura de la API (detalles con plato_nombre y comensal)', () => {
    const apiPedido = {
      id_pedido: 101,
      codigo_pedido: 'PED-261016-A1B2C',
      id_mesa: 5,
      estado: 'en_preparacion',
      total: 35000,
      creado_en: '2026-10-16T15:30:00.000Z',
      detalles: [
        {
          id_detalle: 1,
          id_plato: 4,
          plato_nombre: 'Bowl Personalizado',
          cantidad: 1,
          precio_unitario: 25000,
          subtotal: 25000,
          comensal: 'Beto',
          notas: 'Sin cebolla',
          ingredientes: [{ id_ingrediente: 10, nombre: 'Pollo' }],
        },
        {
          id_detalle: 2,
          id_plato: 8,
          plato_nombre: 'Limonada de Coco',
          cantidad: 1,
          precio_unitario: 10000,
          subtotal: 10000,
          comensal: 'Beto',
          notas: null,
          ingredientes: [],
        },
      ],
    };

    const norm = normalizarPedido(apiPedido, 'Beto');
    expect(norm.id_pedido).toBe(101);
    expect(norm.codigo_pedido).toBe('PED-261016-A1B2C');
    expect(norm.estado).toBe('en_preparacion');
    expect(norm.total).toBe(35000);
    expect(norm.esMio).toBe(true);
    expect(norm.detalles).toHaveLength(2);
    expect(norm.detalles[0].plato_nombre).toBe('Bowl Personalizado');
    expect(norm.detalles[0].nombre).toBe('Bowl Personalizado');
    expect(norm.detalles[0].esMio).toBe(true);
    expect(norm.detalles[0].comensal).toBe('Beto');
  });

  it('normaliza la estructura del cliente / simulado (items/lineas con nombre)', () => {
    const simuladoPedido = {
      id: 'sim-99',
      codigo: 'PED-SIM99',
      estado: 'recibido',
      lineas: [
        {
          id: 1,
          nombre: 'Hamburguesa Clásica',
          cantidad: 2,
          precio: 18000,
          subtotal: 36000,
          comensal: 'Ana',
        },
      ],
    };

    const norm = normalizarPedido(simuladoPedido, 'Ana');
    expect(norm.id_pedido).toBe('sim-99');
    expect(norm.codigo_pedido).toBe('PED-SIM99');
    expect(norm.estado).toBe('recibido');
    expect(norm.total).toBe(36000);
    expect(norm.esMio).toBe(true);
    expect(norm.detalles[0].plato_nombre).toBe('Hamburguesa Clásica');
    expect(norm.detalles[0].esMio).toBe(true);
  });

  it('identifica correctamente cuando un pedido NO es mío', () => {
    const pedidoOtro = {
      id_pedido: 202,
      detalles: [
        {
          plato_nombre: 'Alitas BBQ x8',
          cantidad: 1,
          subtotal: 22000,
          comensal: 'Carlos',
        },
      ],
    };

    const norm = normalizarPedido(pedidoOtro, 'Beto');
    expect(norm.esMio).toBe(false);
    expect(norm.detalles[0].esMio).toBe(false);
  });

  it('maneja pedidos nulos o vacíos con seguridad', () => {
    expect(normalizarPedido(null)).toBeNull();
    expect(normalizarPedido(undefined)).toBeNull();
  });
});

describe('aplicarCambioEstado', () => {
  it('actualiza el estado del pedido especificado en el evento', () => {
    const pedidos = [
      { id_pedido: 1, estado: 'recibido' },
      { id_pedido: 2, estado: 'recibido' },
    ];
    const evento = { id_pedido: 1, estado: 'en_preparacion' };

    const actualizados = aplicarCambioEstado(pedidos, evento);
    expect(actualizados[0].estado).toBe('en_preparacion');
    expect(actualizados[1].estado).toBe('recibido');
  });
});

describe('separarPedidos', () => {
  it('separa mis pedidos de los de otros comensales', () => {
    const lista = [
      { id_pedido: 1, esMio: true },
      { id_pedido: 2, esMio: false },
      { id_pedido: 3, esMio: true },
    ];
    const { misPedidos, otrosPedidos } = separarPedidos(lista);
    expect(misPedidos).toHaveLength(2);
    expect(otrosPedidos).toHaveLength(1);
    expect(misPedidos[0].id_pedido).toBe(1);
    expect(otrosPedidos[0].id_pedido).toBe(2);
  });

  it('separa evaluando miAlias si los pedidos no estaban previamente marcados', () => {
    const lista = [
      { id_pedido: 1, comensal: 'Beto' },
      { id_pedido: 2, comensal: 'Carlos' },
      { id_pedido: 3, detalles: [{ comensal: 'Beto' }] },
    ];
    const { misPedidos, otrosPedidos } = separarPedidos(lista, 'Beto');
    expect(misPedidos).toHaveLength(2);
    expect(otrosPedidos).toHaveLength(1);
    expect(otrosPedidos[0].id_pedido).toBe(2);
  });
});

describe('pedidoPrincipal', () => {
  it('prioriza el pedido seleccionado por ID', () => {
    const misPedidos = [
      { id_pedido: 1, estado: 'recibido' },
      { id_pedido: 2, estado: 'listo' },
    ];
    const principal = pedidoPrincipal(misPedidos, 2);
    expect(principal.id_pedido).toBe(2);
  });

  it('si no hay ID seleccionado, prioriza el primer pedido activo', () => {
    const misPedidos = [
      { id_pedido: 1, estado: 'entregado' },
      { id_pedido: 2, estado: 'en_preparacion' },
    ];
    const principal = pedidoPrincipal(misPedidos, null);
    expect(principal.id_pedido).toBe(2);
  });
});

describe('haceCuanto', () => {
  it('formatea tiempos relativos correctamente', () => {
    const ahora = 1000000000000;
    expect(haceCuanto(ahora - 30 * 1000, ahora)).toBe('hace un momento');
    expect(haceCuanto(ahora - 5 * 60 * 1000, ahora)).toBe('hace 5 min');
    expect(haceCuanto(ahora - 2 * 60 * 60 * 1000, ahora)).toBe('hace 2 h');
    expect(haceCuanto(ahora - 48 * 60 * 60 * 1000, ahora)).toBe('hace 2 d');
    expect(haceCuanto(null)).toBe('');
  });
});
