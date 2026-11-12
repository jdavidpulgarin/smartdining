import { describe, expect, it } from 'vitest';
import {
  aplicarCambioEstado,
  aplicarItemCancelado,
  reemplazarPedido,
  puedeQuitar,
  accionErrorQuitar,
  etiquetaItemCancelado,
  haceCuanto,
  infoEstado,
  normalizarPedido,
  pedidoPrincipal,
  registrarMiPedidoId,
  separarPedidos,
  esPedidoMio,
  resumenPedidosActivos,
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

describe('registrarMiPedidoId y esPedidoMio', () => {
  it('registra y reconoce un pedido como propio', () => {
    let store = {};
    const originalSessionStorage = globalThis.sessionStorage;
    globalThis.sessionStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, val) => {
        store[key] = String(val);
      },
    };

    try {
      expect(esPedidoMio(501)).toBe(false);
      registrarMiPedidoId(501);
      expect(esPedidoMio(501)).toBe(true);
      expect(esPedidoMio(502)).toBe(false);
    } finally {
      globalThis.sessionStorage = originalSessionStorage;
    }
  });
});

describe('resumenPedidosActivos', () => {
  it('retorna ceros si no hay pedidos', () => {
    expect(resumenPedidosActivos([])).toEqual({
      cantidad: 0,
      estadoPrincipal: null,
      tienePedidos: false,
    });
    expect(resumenPedidosActivos(null)).toEqual({
      cantidad: 0,
      estadoPrincipal: null,
      tienePedidos: false,
    });
  });

  it('cuenta correctamente pedidos activos e identifica el estado principal', () => {
    const pedidos = [
      { id_pedido: 1, estado: 'recibido' },
      { id_pedido: 2, estado: 'en_preparacion' },
    ];
    const res = resumenPedidosActivos(pedidos);
    expect(res.cantidad).toBe(2);
    expect(res.estadoPrincipal).toBe('recibido');
    expect(res.tienePedidos).toBe(true);
  });

  it('si solo hay pedidos entregados, cantidad es 0 pero tienePedidos es true', () => {
    const pedidos = [{ id_pedido: 1, estado: 'entregado' }];
    const res = resumenPedidosActivos(pedidos);
    expect(res.cantidad).toBe(0);
    expect(res.estadoPrincipal).toBe('entregado');
    expect(res.tienePedidos).toBe(true);
  });
});

describe('puedeQuitar (J-14)', () => {
  it('devuelve true solo si recibido, pendiente y mismo comensal por clave (Ana vs ana)', () => {
    expect(
      puedeQuitar(
        { id_detalle: 1, comensal: 'Ana', estado_item: 'pendiente', cantidad: 3 },
        { yo: 'ana', estadoPedido: 'recibido' }
      )
    ).toBe(true);

    expect(
      puedeQuitar(
        { id_detalle: 2, comensal: 'Ána María', estado_item: 'pendiente' },
        { yo: 'ana  maria', estadoPedido: 'recibido' }
      )
    ).toBe(true);
  });

  it('devuelve false si el comensal es null, distinto, o estado no permite quitar', () => {
    expect(
      puedeQuitar(
        { id_detalle: 1, comensal: null, estado_item: 'pendiente' },
        { yo: 'Ana', estadoPedido: 'recibido' }
      )
    ).toBe(false);

    expect(
      puedeQuitar(
        { id_detalle: 1, comensal: 'Ana', estado_item: 'pendiente' },
        { yo: null, estadoPedido: 'recibido' }
      )
    ).toBe(false);

    expect(
      puedeQuitar(
        { id_detalle: 1, comensal: 'Beto', estado_item: 'pendiente' },
        { yo: 'Ana', estadoPedido: 'recibido' }
      )
    ).toBe(false);

    expect(
      puedeQuitar(
        { id_detalle: 1, comensal: 'Ana', estado_item: 'cancelado' },
        { yo: 'Ana', estadoPedido: 'recibido' }
      )
    ).toBe(false);

    expect(
      puedeQuitar(
        { id_detalle: 1, comensal: 'Ana', estado_item: 'pendiente' },
        { yo: 'Ana', estadoPedido: 'en_preparacion' }
      )
    ).toBe(false);
  });
});

describe('accionErrorQuitar (J-14)', () => {
  it('mapea los motivos del contrato y errores sin red', () => {
    expect(accionErrorQuitar({ status: 409, motivo: 'item_ya_cancelado' })).toEqual({
      tipo: 'silencioso',
      mensaje: null,
      refrescar: true,
    });

    expect(accionErrorQuitar({ status: 409, motivo: 'item_en_preparacion' })).toEqual({
      tipo: 'en_preparacion',
      mensaje: 'Cocina ya empezó a preparar este plato.',
      refrescar: true,
    });

    expect(accionErrorQuitar({ status: 409, motivo: 'pago_registrado' })).toEqual({
      tipo: 'pago_registrado',
      mensaje: 'Ya hay un pago registrado; pídele ayuda al mesero.',
      refrescar: false,
    });

    expect(accionErrorQuitar({ status: 403, motivo: 'no_es_tuyo' })).toEqual({
      tipo: 'no_disponible',
      mensaje: 'No pudimos quitar este plato.',
      refrescar: true,
    });

    expect(accionErrorQuitar({ status: 404, motivo: 'no_encontrado' })).toEqual({
      tipo: 'no_disponible',
      mensaje: 'No pudimos quitar este plato.',
      refrescar: true,
    });

    expect(accionErrorQuitar({ status: 0, motivo: 'sin_conexion' })).toEqual({
      tipo: 'error',
      mensaje: 'No pudimos quitar el plato. Inténtalo de nuevo.',
      refrescar: false,
    });

    expect(accionErrorQuitar(new Error('Fallo inesperado'))).toEqual({
      tipo: 'error',
      mensaje: 'No pudimos quitar el plato. Inténtalo de nuevo.',
      refrescar: false,
    });
  });
});

describe('aplicarItemCancelado y reemplazarPedido (J-14)', () => {
  it('marca una linea con cantidad > 1 como cancelada, actualiza total e idempotencia', () => {
    const inicial = [
      {
        id_pedido: 87,
        estado: 'recibido',
        total: 54000,
        detalles: [
          {
            id_detalle: 210,
            plato_nombre: 'Bandeja paisa',
            cantidad: 2,
            subtotal: 36000,
            estado_item: 'pendiente',
            comensal: 'Ana',
          },
          {
            id_detalle: 211,
            plato_nombre: 'Bowl Personalizado',
            cantidad: 1,
            subtotal: 18000,
            estado_item: 'pendiente',
            comensal: 'Ana',
          },
        ],
      },
    ];

    const evento = {
      id_pedido: 87,
      id_detalle: 210,
      total: 18000,
      estado_pedido: 'recibido',
      emitidoEn: '2026-11-11T20:00:00.000Z',
    };

    const trasPrimero = aplicarItemCancelado(inicial, evento);
    expect(trasPrimero[0].estado).toBe('recibido');
    expect(trasPrimero[0].total).toBe(18000);
    expect(trasPrimero[0].detalles[0].estado_item).toBe('cancelado');
    expect(trasPrimero[0].detalles[1].estado_item).toBe('pendiente');

    const trasSegundo = aplicarItemCancelado(trasPrimero, evento);
    expect(trasSegundo).toEqual(trasPrimero);
  });

  it('cuando era el ultimo plato deja total 0 y pedido cancelado', () => {
    const inicial = [
      {
        id_pedido: 88,
        estado: 'recibido',
        total: 18000,
        items: [
          {
            id_detalle: 300,
            plato_nombre: 'Bowl Personalizado',
            cantidad: 1,
            subtotal: 18000,
            estado_item: 'pendiente',
            comensal: 'Ana',
          },
        ],
      },
    ];

    const evento = {
      id_pedido: 88,
      id_detalle: 300,
      total: 0,
      estado_pedido: 'cancelado',
    };

    const res = aplicarItemCancelado(inicial, evento);
    expect(res[0].estado).toBe('cancelado');
    expect(res[0].total).toBe(0);
    expect(res[0].items[0].estado_item).toBe('cancelado');
    expect(res[0].detalles[0].estado_item).toBe('cancelado');
  });

  it('reemplazarPedido normaliza el 200 de cancelarItem y no suma items cancelados al calcular total', () => {
    const lista = [
      normalizarPedido(
        {
          id_pedido: 87,
          codigo_pedido: 'PED-87',
          estado: 'recibido',
          total: 54000,
          detalles: [
            { id_detalle: 210, plato_nombre: 'A', cantidad: 2, subtotal: 36000, estado_item: 'pendiente', comensal: 'Ana' },
            { id_detalle: 211, plato_nombre: 'B', cantidad: 1, subtotal: 18000, estado_item: 'pendiente', comensal: 'Ana' },
          ],
        },
        'ana'
      ),
    ];

    const actualizado = reemplazarPedido(
      lista,
      {
        id_pedido: 87,
        codigo_pedido: 'PED-87',
        estado: 'cancelado',
        total: 0,
        items: [
          { id_detalle: 210, plato_nombre: 'A', cantidad: 2, subtotal: 36000, estado_item: 'cancelado', comensal: 'Ana' },
          { id_detalle: 211, plato_nombre: 'B', cantidad: 1, subtotal: 18000, estado_item: 'cancelado', comensal: 'Ana' },
        ],
      },
      'ana'
    );

    expect(actualizado[0].estado).toBe('cancelado');
    expect(actualizado[0].total).toBe(0);
    expect(actualizado[0].esMio).toBe(true);
    expect(actualizado[0].detalles.every((d) => d.estado_item === 'cancelado')).toBe(true);

    const sinTotal = normalizarPedido(
      {
        id_pedido: 89,
        items: [
          { id_detalle: 1, plato_nombre: 'A', cantidad: 1, subtotal: 15000, estado_item: 'cancelado', comensal: 'Ana' },
          { id_detalle: 2, plato_nombre: 'B', cantidad: 1, subtotal: 12000, estado_item: 'pendiente', comensal: 'Ana' },
        ],
      },
      'Ana'
    );
    expect(sinTotal.total).toBe(12000);
  });

  it('distingue origen personal vs comensal en aplicarItemCancelado y etiquetaItemCancelado', () => {
    const base = [
      {
        id_pedido: 90,
        estado: 'recibido',
        total: 36000,
        detalles: [
          {
            id_detalle: 1,
            plato_nombre: 'Bandeja paisa',
            cantidad: 1,
            subtotal: 20000,
            estado_item: 'pendiente',
            comensal: 'Ana',
          },
          {
            id_detalle: 2,
            plato_nombre: 'Limonada',
            cantidad: 1,
            subtotal: 16000,
            estado_item: 'pendiente',
            comensal: 'Ana',
          },
        ],
      },
    ];

    const trasPersonal = aplicarItemCancelado(base, {
      id_pedido: 90,
      id_detalle: 1,
      total: 16000,
      estado_pedido: 'recibido',
      origen: 'personal',
    });
    expect(etiquetaItemCancelado(trasPersonal[0].detalles[0])).toBe(
      'Cancelado por el restaurante'
    );
    expect(etiquetaItemCancelado(trasPersonal[0].detalles[1])).toBeNull();

    const trasComensal = aplicarItemCancelado(trasPersonal, {
      id_pedido: 90,
      id_detalle: 2,
      total: 0,
      estado_pedido: 'cancelado',
      origen: 'comensal',
    });
    expect(etiquetaItemCancelado(trasComensal[0].detalles[1])).toBe('Quitado');

    expect(
      etiquetaItemCancelado({ estado_item: 'cancelado' })
    ).toBe('Quitado');
    expect(
      etiquetaItemCancelado({ estado_item: 'pendiente' })
    ).toBeNull();
  });
});
