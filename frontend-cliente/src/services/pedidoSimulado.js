import { ErrorApi } from './api';
import { faltantesDelItem } from '../utils/sinStock';
import { obtenerSesion } from '../utils/sesion';

export const CLAVE_PEDIDOS_SIMULADOS = 'smartdining_pedidos_simulados';
export const CLAVE_SIM_PEDIDO = 'smartdining_sim_pedido';
export const CLAVE_SIM_QUITAR = 'smartdining_sim_quitar';

export const FALTANTES_SIMULADOS_DEFAULT = [
  { tipo: 'plato', id: 1008, nombre: 'Limonada de Coco' },
  { tipo: 'ingrediente', id: 10, nombre: 'Aguacate' },
];
export const INGREDIENTE_AGOTADO_SIMULADO = 'Aguacate';

/**
 * Obtiene la lista de pedidos simulados guardados en sessionStorage.
 *
 * @param {number|string|null} [idMesa] - ID de mesa para filtrar (por defecto 5)
 * @returns {Array<object>} Lista de pedidos simulados
 */
export function listarPedidosMesaSimulados(idMesa = 5) {
  try {
    const raw = sessionStorage.getItem(CLAVE_PEDIDOS_SIMULADOS);
    const lista = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(lista)) return [];
    if (idMesa != null) {
      return lista.filter((p) => Number(p.id_mesa) === Number(idMesa));
    }
    return lista;
  } catch {
    return [];
  }
}

/**
 * Crea un pedido simulado, guardándolo en la lista de sessionStorage
 * con el formato retornado por la API del backend.
 */
export async function crearPedidoSimulado({ lineas = [], notasGenerales = '' } = {}) {
  await new Promise((resolve) => setTimeout(resolve, 400));

  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    let simPedido = null;
    try {
      simPedido = sessionStorage.getItem(CLAVE_SIM_PEDIDO);
    } catch {
      simPedido = null;
    }

    if (simPedido === 'reintentar') {
      throw new ErrorApi({
        status: 503,
        motivo: 'reintentar',
        mensaje: 'intenta de nuevo',
      });
    }

    if (simPedido === 'sin_stock_vacio') {
      throw new ErrorApi({
        status: 409,
        motivo: 'sin_stock',
        mensaje: 'No alcanza el inventario para completar el pedido',
        faltantes: [],
      });
    }

    if (simPedido === 'ingrediente_agotado') {
      const faltantesIngSimulados = [
        { tipo: 'ingrediente', id: 10, nombre: INGREDIENTE_AGOTADO_SIMULADO },
        { tipo: 'ingrediente', id: 34, nombre: INGREDIENTE_AGOTADO_SIMULADO },
        { tipo: 'ingrediente', id: null, nombre: INGREDIENTE_AGOTADO_SIMULADO },
      ];
      const tieneIngredienteEnCarrito = lineas.some(
        (l) => faltantesDelItem(l, faltantesIngSimulados).length > 0
      );
      const sonPlatosDelMenuSimulado =
        lineas.length > 0 &&
        lineas.every((l) => Number(l.id_plato || l.idPlato) >= 1000);

      if (tieneIngredienteEnCarrito || !sonPlatosDelMenuSimulado) {
        throw new ErrorApi({
          status: 409,
          motivo: 'ingrediente_agotado',
          mensaje: `El ingrediente "${INGREDIENTE_AGOTADO_SIMULADO}" está agotado`,
        });
      }
    }

    if (simPedido === 'sin_stock') {
      const tieneFaltanteEnCarrito = lineas.some(
        (l) => faltantesDelItem(l, FALTANTES_SIMULADOS_DEFAULT).length > 0
      );
      const sonPlatosDelMenuSimulado =
        lineas.length > 0 &&
        lineas.every((l) => Number(l.id_plato || l.idPlato) >= 1000);

      if (tieneFaltanteEnCarrito || !sonPlatosDelMenuSimulado) {
        throw new ErrorApi({
          status: 409,
          motivo: 'sin_stock',
          mensaje: 'No alcanza el inventario para completar el pedido',
          faltantes: FALTANTES_SIMULADOS_DEFAULT,
        });
      }
    }
  }

  const hayAgotado =
    /agotado/i.test(notasGenerales || '') ||
    lineas.some((l) =>
      /agotado/i.test(l.notas || l.notasCliente || l.notasCocina || '')
    );

  if (hayAgotado) {
    throw new ErrorApi({
      status: 409,
      motivo: 'agotado',
      mensaje: 'El plato o ingrediente seleccionado se agotó. Revisa tu pedido.',
    });
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomSuffix = '';
  for (let i = 0; i < 4; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const id_pedido = Math.floor(1000 + Math.random() * 9000);
  const codigo_pedido = `PED-${randomSuffix}`;

  const sesion = obtenerSesion();
  const aliasPorDefecto = sesion?.comensal || 'Beto';

  const detalles = lineas.map((linea, idx) => {
    const precio = Number(linea.precioUnitario ?? linea.precio ?? 0);
    const cantidad = Number(linea.cantidad ?? 1);
    const subtotal = Number(linea.subtotal ?? (precio * cantidad));
    const nombre = linea.nombre || linea.plato_nombre || 'Plato';
    return {
      id_detalle: idx + 1,
      id_pedido,
      id_plato: Number(linea.id_plato || linea.idPlato || 1),
      plato_nombre: nombre,
      nombre,
      cantidad,
      precio_unitario: precio,
      subtotal,
      estado_item: 'pendiente',
      notas: linea.notas || linea.notasCliente || linea.notasCocina || null,
      comensal: linea.comensal || aliasPorDefecto,
      ingredientes: Array.isArray(linea.ingredientes) ? linea.ingredientes : [],
    };
  });

  const total = detalles.reduce((acc, d) => acc + d.subtotal, 0);

  const nuevoPedido = {
    id_pedido,
    codigo_pedido,
    id_mesa: 5,
    estado: 'recibido',
    total,
    creado_en: new Date().toISOString(),
    detalles,
  };

  try {
    const lista = listarPedidosMesaSimulados(null);
    const nuevaLista = [nuevoPedido, ...lista.filter((p) => p.id_pedido !== id_pedido)];
    sessionStorage.setItem(CLAVE_PEDIDOS_SIMULADOS, JSON.stringify(nuevaLista));
  } catch {
    // Ignorar errores de almacenamiento
  }

  return nuevoPedido;
}

const ERRORES_SIM_QUITAR = {
  item_ya_cancelado: {
    status: 409,
    motivo: 'item_ya_cancelado',
    mensaje: 'Ese plato ya estaba quitado del pedido',
  },
  item_en_preparacion: {
    status: 409,
    motivo: 'item_en_preparacion',
    mensaje: 'Ese plato ya se está preparando: pídeselo al mesero',
  },
  pago_registrado: {
    status: 409,
    motivo: 'pago_registrado',
    mensaje: 'El pedido ya tiene un pago que quedaría por encima del total: pídeselo al mesero',
  },
  no_es_tuyo: {
    status: 403,
    motivo: 'no_es_tuyo',
    mensaje: 'Solo puedes quitar tus propios platos de un pedido de tu mesa',
  },
};

/**
 * Simula `POST /api/pedidos/:id/items/:id_detalle/cancelar` en modo de prueba (solo DEV).
 * Soporta errores forzados mediante `sessionStorage.getItem('smartdining_sim_quitar')`.
 *
 * @param {number|string} idPedido
 * @param {number|string} idDetalle
 * @returns {Promise<{ pedido: object }>}
 */
export async function cancelarItemSimulado(idPedido, idDetalle) {
  await new Promise((resolve) => setTimeout(resolve, 150));

  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    let simQuitar = null;
    try {
      simQuitar = sessionStorage.getItem(CLAVE_SIM_QUITAR);
    } catch {
      simQuitar = null;
    }

    if (simQuitar === 'item_en_preparacion') {
      try {
        const listaActual = listarPedidosMesaSimulados(null);
        const existe = listaActual.some((p) => String(p.id_pedido) === String(idPedido));
        if (existe) {
          const listaEnCocina = listaActual.map((p) => {
            if (String(p.id_pedido) !== String(idPedido)) return p;
            const rawLineas = Array.isArray(p.detalles)
              ? p.detalles
              : Array.isArray(p.items)
                ? p.items
                : [];
            const lineasCocina = rawLineas.map((d) =>
              String(d.estado_item || '').toLowerCase() === 'cancelado'
                ? d
                : { ...d, estado_item: 'en_preparacion' }
            );
            return {
              ...p,
              estado: 'en_preparacion',
              detalles: lineasCocina,
            };
          });
          sessionStorage.setItem(CLAVE_PEDIDOS_SIMULADOS, JSON.stringify(listaEnCocina));
        }
      } catch {
        // Ignorar errores de almacenamiento
      }
      throw new ErrorApi(ERRORES_SIM_QUITAR.item_en_preparacion);
    }

    if (simQuitar && ERRORES_SIM_QUITAR[simQuitar]) {
      throw new ErrorApi(ERRORES_SIM_QUITAR[simQuitar]);
    }
  }

  const lista = listarPedidosMesaSimulados(null);
  const idxPedido = lista.findIndex(
    (p) => String(p.id_pedido) === String(idPedido)
  );
  if (idxPedido === -1) {
    throw new ErrorApi({
      status: 404,
      motivo: 'no_encontrado',
      mensaje: 'Ese plato no está en ese pedido',
    });
  }

  const pedido = lista[idxPedido];
  const rawItems = Array.isArray(pedido.detalles)
    ? pedido.detalles
    : Array.isArray(pedido.items)
      ? pedido.items
      : [];

  const idxLinea = rawItems.findIndex(
    (d) => String(d.id_detalle ?? d.id) === String(idDetalle)
  );
  if (idxLinea === -1) {
    throw new ErrorApi({
      status: 404,
      motivo: 'no_encontrado',
      mensaje: 'Ese plato no está en ese pedido',
    });
  }

  const lineaActual = rawItems[idxLinea];
  if (String(lineaActual.estado_item || '').toLowerCase() === 'cancelado') {
    throw new ErrorApi(ERRORES_SIM_QUITAR.item_ya_cancelado);
  }
  if (
    String(pedido.estado || '').toLowerCase() !== 'recibido' ||
    String(lineaActual.estado_item || '').toLowerCase() !== 'pendiente'
  ) {
    throw new ErrorApi(ERRORES_SIM_QUITAR.item_en_preparacion);
  }

  const itemsActualizados = rawItems.map((d, i) => {
    const platoNombre = d.plato_nombre || d.nombre || 'Plato';
    return {
      ...d,
      plato_nombre: platoNombre,
      estado_item: i === idxLinea ? 'cancelado' : d.estado_item || 'pendiente',
      ingredientes: Array.isArray(d.ingredientes) ? d.ingredientes : [],
    };
  });

  const totalNuevo = Number(
    itemsActualizados
      .filter((d) => d.estado_item !== 'cancelado')
      .reduce((acc, d) => acc + (Number(d.subtotal) || 0), 0)
  );

  const quedanVivos = itemsActualizados.some((d) => d.estado_item !== 'cancelado');
  const estadoNuevo = quedanVivos ? pedido.estado : 'cancelado';

  const pedidoGuardado = {
    ...pedido,
    estado: estadoNuevo,
    total: totalNuevo,
    detalles: itemsActualizados,
  };

  try {
    const nuevaLista = lista.map((p, i) => (i === idxPedido ? pedidoGuardado : p));
    sessionStorage.setItem(CLAVE_PEDIDOS_SIMULADOS, JSON.stringify(nuevaLista));
    sessionStorage.removeItem('smartdining_cuenta_simulada');
  } catch {
    // Ignorar errores de almacenamiento
  }

  return {
    pedido: {
      id_pedido: pedido.id_pedido,
      codigo_pedido: pedido.codigo_pedido,
      estado: estadoNuevo,
      total: Number(totalNuevo),
      items: itemsActualizados,
    },
  };
}

export default {
  CLAVE_PEDIDOS_SIMULADOS,
  CLAVE_SIM_PEDIDO,
  CLAVE_SIM_QUITAR,
  FALTANTES_SIMULADOS_DEFAULT,
  listarPedidosMesaSimulados,
  crearPedidoSimulado,
  cancelarItemSimulado,
};
