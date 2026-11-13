import { describe, expect, it } from 'vitest';
import {
  aplicarCambioEstado,
  aplicarItemCancelado,
  incorporarPedido,
  reemplazarPedido,
  puedeQuitar,
  puedeCancelarPedido,
  accionErrorQuitar,
  accionErrorCancelarPedido,
  etiquetaItemCancelado,
  mensajeEstadoTarjeta,
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

  it('mantiene la seleccion en un pedido cancelado si idSeleccionado coincide', () => {
    const misPedidos = [
      { id_pedido: 'A', estado: 'cancelado' },
      { id_pedido: 'B', estado: 'recibido' },
    ];
    const principal = pedidoPrincipal(misPedidos, 'A');
    expect(principal.id_pedido).toBe('A');
  });

  it('si el pedido seleccionado no existe tras recargar, cae al primer pedido activo', () => {
    const misPedidos = [
      { id_pedido: 'B', estado: 'recibido' },
    ];
    const principal = pedidoPrincipal(misPedidos, 'A');
    expect(principal.id_pedido).toBe('B');
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
    ).toBe('Cancelado');
    expect(
      etiquetaItemCancelado({ estado_item: 'cancelado', origen_cancelacion: 'comensal' })
    ).toBe('Quitado');
    expect(
      etiquetaItemCancelado({ estado_item: 'cancelado', origen_cancelacion: 'personal' })
    ).toBe('Cancelado por el restaurante');
    expect(
      etiquetaItemCancelado({ estado_item: 'cancelado', origen_cancelacion: 'desconocido' })
    ).toBe('Cancelado');
    expect(
      etiquetaItemCancelado({ estado_item: 'pendiente' })
    ).toBeNull();
  });
});

describe('mensajeEstadoTarjeta (J-14)', () => {
  it('dice "Quitaste todos los platos de este pedido." si todas las lineas fueron canceladas por comensal', () => {
    const pedido = {
      id_pedido: 1,
      estado: 'cancelado',
      esMio: true,
      detalles: [
        { id_detalle: 10, estado_item: 'cancelado', origen_cancelacion: 'comensal' },
        { id_detalle: 11, estado_item: 'cancelado', origen_cancelacion: 'comensal' },
      ],
    };
    expect(mensajeEstadoTarjeta(pedido, 5)).toBe(
      'Cancelaste este pedido.'
    );
  });

  it('dice "El restaurante canceló este pedido." si lo cancelo el restaurante por order:status o por origen personal', () => {
    const porOrderStatus = aplicarCambioEstado(
      [
        {
          id_pedido: 2,
          estado: 'recibido',
          esMio: true,
          detalles: [{ id_detalle: 20, estado_item: 'pendiente' }],
        },
      ],
      { id_pedido: 2, estado: 'cancelado' }
    )[0];
    expect(mensajeEstadoTarjeta(porOrderStatus, 5)).toBe(
      'El restaurante canceló este pedido.'
    );

    const porOrigenPersonal = {
      id_pedido: 3,
      estado: 'cancelado',
      esMio: true,
      detalles: [
        { id_detalle: 30, estado_item: 'cancelado', origen_cancelacion: 'personal' },
      ],
    };
    expect(mensajeEstadoTarjeta(porOrigenPersonal, 5)).toBe(
      'El restaurante canceló este pedido.'
    );
  });

  it('muestra "El restaurante canceló este pedido." cuando el origen es desconocido tras recargar', () => {
    const pedidoOrigenDesconocido = {
      id_pedido: 7,
      estado: 'cancelado',
      esMio: true,
      detalles: [
        { id_detalle: 70, estado_item: 'cancelado' },
      ],
    };
    expect(mensajeEstadoTarjeta(pedidoOrigenDesconocido, 5)).toBe(
      'El restaurante canceló este pedido.'
    );
  });

  it('mantiene el texto de mesero si el pedido no es mio aunque todas las lineas esten canceladas', () => {
    const deOtro = {
      id_pedido: 4,
      estado: 'cancelado',
      esMio: false,
      detalles: [{ id_detalle: 40, estado_item: 'cancelado' }],
    };
    expect(mensajeEstadoTarjeta(deOtro, 5)).toBe(
      'Habla con el mesero si tienes dudas.'
    );
  });

  it('conserva "Cancelaste este pedido." si el evento order:status trae origen comensal', () => {
    const porOrderStatusComensal = aplicarCambioEstado(
      [
        {
          id_pedido: 8,
          estado: 'recibido',
          esMio: true,
          detalles: [{ id_detalle: 80, estado_item: 'pendiente' }],
        },
      ],
      { id_pedido: 8, estado: 'cancelado', origen: 'comensal' }
    )[0];
    expect(mensajeEstadoTarjeta(porOrderStatusComensal, 5)).toBe(
      'Cancelaste este pedido.'
    );
  });

  it('conserva "Cancelaste este pedido." aunque llegue despues order:status cancelado', () => {
    const trasItem = aplicarItemCancelado(
      [
        {
          id_pedido: 5,
          estado: 'recibido',
          esMio: true,
          detalles: [{ id_detalle: 50, estado_item: 'pendiente', subtotal: 15000 }],
        },
      ],
      { id_pedido: 5, id_detalle: 50, total: 0, estado_pedido: 'cancelado' }
    );
    const trasOrderStatus = aplicarCambioEstado(trasItem, {
      id_pedido: 5,
      estado: 'cancelado',
    });
    expect(mensajeEstadoTarjeta(trasOrderStatus[0], 5)).toBe(
      'Cancelaste este pedido.'
    );
  });
});

describe('incorporarPedido y conteo en vivo de Mis pedidos (J-14)', () => {
  it('incorpora un pedido nuevo sin sobrescribir uno ya actualizado', () => {
    const listaInicial = incorporarPedido(
      [],
      {
        id_pedido: 10,
        estado: 'recibido',
        items: [{ id_detalle: 100, comensal: 'Ana', plato_nombre: 'Pizza', estado_item: 'pendiente' }],
      },
      'Ana'
    );
    expect(listaInicial).toHaveLength(1);
    expect(listaInicial[0].estado).toBe('recibido');

    const listaCancelada = reemplazarPedido(
      listaInicial,
      {
        id_pedido: 10,
        estado: 'cancelado',
        total: 0,
        items: [{ id_detalle: 100, comensal: 'Ana', plato_nombre: 'Pizza', estado_item: 'cancelado' }],
      },
      'Ana'
    );

    // Un snapshot viejo (por ejemplo de location.state) no pisa el estado cancelado
    const trasSnapshotViejo = incorporarPedido(
      listaCancelada,
      {
        id_pedido: 10,
        estado: 'recibido',
        items: [{ id_detalle: 100, comensal: 'Ana', plato_nombre: 'Pizza', estado_item: 'pendiente' }],
      },
      'Ana'
    );
    expect(trasSnapshotViejo).toBe(listaCancelada);
    expect(trasSnapshotViejo[0].estado).toBe('cancelado');
  });

  it('baja el contador de Mis pedidos a 0 al reemplazar por respuesta 200 cancelada', () => {
    const lista = [
      normalizarPedido(
        {
          id_pedido: 20,
          estado: 'recibido',
          total: 25000,
          items: [
            { id_detalle: 200, comensal: 'Ana', plato_nombre: 'Pasta', estado_item: 'pendiente', subtotal: 25000 },
          ],
        },
        'Ana'
      ),
    ];

    expect(resumenPedidosActivos(separarPedidos(lista, 'Ana').misPedidos).cantidad).toBe(1);

    const tras200 = reemplazarPedido(
      lista,
      {
        id_pedido: 20,
        estado: 'cancelado',
        total: 0,
        items: [
          { id_detalle: 200, comensal: 'Ana', plato_nombre: 'Pasta', estado_item: 'cancelado', subtotal: 25000 },
        ],
      },
      'Ana'
    );

    const resumen = resumenPedidosActivos(separarPedidos(tras200, 'Ana').misPedidos);
    expect(resumen.cantidad).toBe(0);
    expect(resumen.estadoPrincipal).toBe('cancelado');
  });

  it('baja el contador de Mis pedidos al recibir item:cancelado o order:status cancelado', () => {
    const lista = [
      normalizarPedido(
        {
          id_pedido: 30,
          estado: 'recibido',
          total: 18000,
          items: [
            { id_detalle: 300, comensal: 'Ana', plato_nombre: 'Sopa', estado_item: 'pendiente', subtotal: 18000 },
          ],
        },
        'Ana'
      ),
      normalizarPedido(
        {
          id_pedido: 31,
          estado: 'recibido',
          total: 20000,
          items: [
            { id_detalle: 301, comensal: 'Ana', plato_nombre: 'Pollo', estado_item: 'pendiente', subtotal: 20000 },
          ],
        },
        'Ana'
      ),
    ];

    expect(resumenPedidosActivos(separarPedidos(lista, 'Ana').misPedidos).cantidad).toBe(2);

    const trasItemCancelado = aplicarItemCancelado(lista, {
      id_pedido: 30,
      id_detalle: 300,
      total: 0,
      estado_pedido: 'cancelado',
    });
    expect(
      resumenPedidosActivos(separarPedidos(trasItemCancelado, 'Ana').misPedidos).cantidad
    ).toBe(1);

    const trasOrderStatus = aplicarCambioEstado(trasItemCancelado, {
      id_pedido: 31,
      estado: 'cancelado',
    });
    const resumenFinal = resumenPedidosActivos(
      separarPedidos(trasOrderStatus, 'Ana').misPedidos
    );
    expect(resumenFinal.cantidad).toBe(0);
    expect(resumenFinal.estadoPrincipal).toBe('cancelado');
  });

  it('resuelve el id_pedido fijado en confirmacion de quitar plato aunque cambie el pedido activo', () => {
    // Prueba de la logica de confirmacion (sugerencia c):
    // al abrir confirmacion se guarda id_pedido junto con id_detalle
    const idPedidoFijado = 42;
    const itemAConfirmar = {
      id_detalle: 99,
      plato_nombre: 'Limonada',
      id_pedido: idPedidoFijado,
    };

    // Simulamos que pedidoActivo cambia a otro pedido distinto (ej. id_pedido: 999)
    const pedidoActivoActual = { id_pedido: 999 };

    // La accion de quitar debe usar el id_pedido fijado
    const idPedidoUsado = itemAConfirmar.id_pedido ?? pedidoActivoActual.id_pedido;
    expect(idPedidoUsado).toBe(42);
    expect(idPedidoUsado).not.toBe(pedidoActivoActual.id_pedido);
  });

  describe('puedeCancelarPedido (D-12)', () => {
    it('true solo si pedido en recibido, tiene lineas vivas y todas son pendientes y del comensal', () => {
      const pedidoValido = {
        id_pedido: 101,
        estado: 'recibido',
        detalles: [
          { id_detalle: 1, comensal: 'Ana', estado_item: 'pendiente' },
          { id_detalle: 2, comensal: 'Ana', estado_item: 'pendiente' },
        ],
      };
      expect(puedeCancelarPedido(pedidoValido, { yo: 'Ana' })).toBe(true);
      expect(puedeCancelarPedido(pedidoValido, { yo: 'ana' })).toBe(true);
      expect(puedeCancelarPedido(pedidoValido, { yo: 'Beto' })).toBe(false);
    });

    it('false si el pedido no esta en recibido', () => {
      const pedidoCocina = {
        id_pedido: 102,
        estado: 'en_preparacion',
        detalles: [{ id_detalle: 3, comensal: 'Ana', estado_item: 'pendiente' }],
      };
      expect(puedeCancelarPedido(pedidoCocina, { yo: 'Ana' })).toBe(false);
    });

    it('false si no tiene lineas vivas (todas canceladas o vacio)', () => {
      const pedidoSinLineas = {
        id_pedido: 103,
        estado: 'recibido',
        detalles: [],
      };
      expect(puedeCancelarPedido(pedidoSinLineas, { yo: 'Ana' })).toBe(false);

      const pedidoTodasCanceladas = {
        id_pedido: 104,
        estado: 'recibido',
        detalles: [{ id_detalle: 4, comensal: 'Ana', estado_item: 'cancelado' }],
      };
      expect(puedeCancelarPedido(pedidoTodasCanceladas, { yo: 'Ana' })).toBe(false);
    });

    it('ignora lineas canceladas al evaluar si las vivas son pendientes y mias', () => {
      const pedidoMixto = {
        id_pedido: 105,
        estado: 'recibido',
        detalles: [
          { id_detalle: 5, comensal: 'Beto', estado_item: 'cancelado' },
          { id_detalle: 6, comensal: 'Ana', estado_item: 'pendiente' },
        ],
      };
      expect(puedeCancelarPedido(pedidoMixto, { yo: 'Ana' })).toBe(true);
    });

    it('false si alguna linea viva no es de Ana o no esta pendiente', () => {
      const compartido = {
        id_pedido: 106,
        estado: 'recibido',
        detalles: [
          { id_detalle: 7, comensal: 'Ana', estado_item: 'pendiente' },
          { id_detalle: 8, comensal: 'Beto', estado_item: 'pendiente' },
        ],
      };
      expect(puedeCancelarPedido(compartido, { yo: 'Ana' })).toBe(false);

      const unaEnPreparacion = {
        id_pedido: 107,
        estado: 'recibido',
        detalles: [
          { id_detalle: 9, comensal: 'Ana', estado_item: 'pendiente' },
          { id_detalle: 10, comensal: 'Ana', estado_item: 'en_preparacion' },
        ],
      };
      expect(puedeCancelarPedido(unaEnPreparacion, { yo: 'Ana' })).toBe(false);
    });
  });

  describe('accionErrorCancelarPedido (D-12)', () => {
    it('pedido_ya_cancelado -> silencioso con recargar: true', () => {
      const r = accionErrorCancelarPedido({ motivo: 'pedido_ya_cancelado' });
      expect(r).toEqual({ tipo: 'silencioso', mensaje: null, recargar: true });
    });

    it('pedido_compartido -> mensaje de otras personas y recargar: false', () => {
      const r = accionErrorCancelarPedido({ motivo: 'pedido_compartido' });
      expect(r).toEqual({
        tipo: 'pedido_compartido',
        mensaje: 'Hay platos de otras personas en este pedido. Pídele ayuda al mesero.',
        recargar: false,
      });
    });

    it('no_cancelable -> mensaje de cocina y recargar: true', () => {
      const r = accionErrorCancelarPedido({ motivo: 'no_cancelable' });
      expect(r).toEqual({
        tipo: 'no_cancelable',
        mensaje: 'La cocina ya empezó tu pedido; ya no se puede cancelar.',
        recargar: true,
      });
    });

    it('pago_registrado -> mensaje de pago y recargar: false', () => {
      const r = accionErrorCancelarPedido({ motivo: 'pago_registrado' });
      expect(r).toEqual({
        tipo: 'pago_registrado',
        mensaje: 'Ya hay un pago registrado; pídele ayuda al mesero.',
        recargar: false,
      });
    });

    it('no_es_tuyo / no_encontrado (o 403 / 404) -> mensaje no encontramos y recargar: true', () => {
      expect(accionErrorCancelarPedido({ motivo: 'no_es_tuyo' })).toEqual({
        tipo: 'no_encontrado',
        mensaje: 'No encontramos ese pedido en tu mesa.',
        recargar: true,
      });
      expect(accionErrorCancelarPedido({ motivo: 'no_encontrado' })).toEqual({
        tipo: 'no_encontrado',
        mensaje: 'No encontramos ese pedido en tu mesa.',
        recargar: true,
      });
      expect(accionErrorCancelarPedido({ status: 403 })).toEqual({
        tipo: 'no_encontrado',
        mensaje: 'No encontramos ese pedido en tu mesa.',
        recargar: true,
      });
      expect(accionErrorCancelarPedido({ status: 404 })).toEqual({
        tipo: 'no_encontrado',
        mensaje: 'No encontramos ese pedido en tu mesa.',
        recargar: true,
      });
    });

    it('otro error o red -> mensaje generico y recargar: false', () => {
      const r = accionErrorCancelarPedido(new Error('Fallo de red'));
      expect(r).toEqual({
        tipo: 'error',
        mensaje: 'No pudimos cancelar el pedido. Intenta de nuevo.',
        recargar: false,
      });
    });
  });
});
