/**
 * Utilidades puras para el estado, formato y seguimiento del pedido.
 */
import { claveAlias } from './apodo';

export { claveAlias };

const ESTADOS_INFO = {
  recibido: {
    clave: 'recibido',
    label: 'RECIBIDO',
    pill: 'RECIBIDO',
    pillBg: '#2A2A2A',
    pillTexto: '#FFFFFF',
    color: '#FFFFFF',
    rgb: '255,255,255',
    titulo: 'YA LO TENEMOS',
    mensaje: 'Recibimos tu pedido y ya lo estamos revisando.',
    indicePaso: 0,
    conTimeline: true,
  },
  en_preparacion: {
    clave: 'en_preparacion',
    label: 'EN PREPARACIÓN',
    pill: 'EN PREPARACIÓN',
    pillBg: '#F2B705',
    pillTexto: '#0B0B0B',
    color: '#F2B705',
    rgb: '242,183,5',
    titulo: 'ESTAMOS COCINANDO',
    mensaje: 'El chef está preparando tu pedido.',
    indicePaso: 1,
    conTimeline: true,
  },
  listo: {
    clave: 'listo',
    label: 'LISTO',
    pill: 'LISTO',
    pillBg: '#E3242B',
    pillTexto: '#FFFFFF',
    color: '#FF5A5F',
    rgb: '227,36,43',
    titulo: '¡SALE CALIENTE!',
    mensaje: (mesa) =>
      mesa
        ? `Tu pedido va camino a la mesa ${mesa}. Prepara el tenedor.`
        : 'Tu pedido va camino a tu mesa. Prepara el tenedor.',
    indicePaso: 2,
    conTimeline: true,
  },
  entregado: {
    clave: 'entregado',
    label: 'EN TU MESA',
    pill: 'ENTREGADO',
    pillBg: '#2FA35A',
    pillTexto: '#0B0B0B',
    color: '#2FA35A',
    rgb: '47,163,90',
    titulo: '¡BUEN PROVECHO!',
    mensaje: (mesa) =>
      mesa
        ? `Tu pedido ya está en la mesa ${mesa}.`
        : 'Tu pedido ya está en tu mesa.',
    indicePaso: 3,
    conTimeline: true,
  },
  pagado: {
    clave: 'pagado',
    label: 'EN TU MESA',
    pill: 'ENTREGADO',
    pillBg: '#2FA35A',
    pillTexto: '#0B0B0B',
    color: '#2FA35A',
    rgb: '47,163,90',
    titulo: '¡BUEN PROVECHO!',
    mensaje: (mesa) =>
      mesa
        ? `Tu pedido ya está en la mesa ${mesa}.`
        : 'Tu pedido ya está en tu mesa.',
    indicePaso: 3,
    conTimeline: true,
  },
  cancelado: {
    clave: 'cancelado',
    label: 'CANCELADO',
    pill: 'CANCELADO',
    pillBg: '#2A2A2A',
    pillTexto: '#A3A3A3',
    color: '#A3A3A3',
    rgb: '163,163,163',
    titulo: 'PEDIDO CANCELADO',
    mensaje: 'Habla con el mesero si tienes dudas.',
    indicePaso: -1,
    conTimeline: false,
  },
};

/**
 * Devuelve la configuración visual y descriptiva asociada a un estado de pedido.
 *
 * @param {string} estado - Clave del estado (recibido, en_preparacion, listo, entregado, pagado, cancelado)
 * @param {number|string|null} [numeroMesa] - Número de la mesa para personalizar el mensaje
 * @returns {object} Metadatos para pintar la tarjeta y la línea de tiempo
 */
export function infoEstado(estado, numeroMesa = null) {
  const norm = String(estado || '').trim().toLowerCase();
  const cfg = ESTADOS_INFO[norm] || ESTADOS_INFO.recibido;

  const mensaje =
    typeof cfg.mensaje === 'function' ? cfg.mensaje(numeroMesa) : cfg.mensaje;

  const halo = `radial-gradient(circle at 50% 55%, rgba(${cfg.rgb},.16), rgba(${cfg.rgb},0) 62%)`;

  return {
    clave: cfg.clave,
    label: cfg.label,
    pill: cfg.pill,
    pillBg: cfg.pillBg,
    pillTexto: cfg.pillTexto,
    color: cfg.color,
    rgb: cfg.rgb,
    halo,
    colores: {
      pillBg: cfg.pillBg,
      pillTexto: cfg.pillTexto,
      color: cfg.color,
      rgb: cfg.rgb,
      halo,
    },
    titulo: cfg.titulo,
    mensaje,
    indicePaso: cfg.indicePaso,
    conTimeline: cfg.conTimeline,
  };
}

/**
 * Normaliza un pedido proveniente de la API (con `detalles` y `plato_nombre`)
 * o del cliente / modo simulado (con `items` / `lineas` y `nombre`).
 *
 * Determina `esMio` según el alias del comensal en los detalles o en la raíz.
 *
 * @param {object} pedido - Objeto de pedido crudo
 * @param {string|null} [miAlias] - Alias del usuario actual
 * @returns {object|null} Pedido normalizado con estructura consistente
 */
export function normalizarPedido(pedido, miAlias = null) {
  if (!pedido || typeof pedido !== 'object') return null;

  const miClave = claveAlias(miAlias);

  const rawItems = Array.isArray(pedido.detalles)
    ? pedido.detalles
    : Array.isArray(pedido.items)
    ? pedido.items
    : Array.isArray(pedido.lineas)
    ? pedido.lineas
    : [];

  const detalles = rawItems.map((item, idx) => {
    const nombre = item.plato_nombre || item.nombre || item.plato || 'Plato';
    const cantidad = Number(item.cantidad) || 1;
    const precioUnitario = Number(item.precio_unitario ?? item.precio ?? 0);
    const subtotal = Number(
      item.subtotal ?? (precioUnitario * cantidad)
    );
    const comensal = item.comensal ? String(item.comensal).trim() : null;
    const estadoItem = item.estado_item
      ? String(item.estado_item).trim().toLowerCase()
      : null;
    const claveComensal = claveAlias(comensal);
    const esMio = Boolean(
      miClave &&
        claveComensal &&
        claveComensal === miClave
    );

    return {
      id_detalle: item.id_detalle ?? item.id ?? idx,
      id_plato: item.id_plato ?? null,
      plato_nombre: nombre,
      nombre,
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
      estado_item: estadoItem,
      notas: item.notas || null,
      comensal,
      esMio,
      ingredientes: Array.isArray(item.ingredientes) ? item.ingredientes : [],
    };
  });

  const clavePedidoComensal = claveAlias(pedido.comensal);
  const algunItemEsMio = detalles.some((d) => d.esMio);
  const raizEsMio = Boolean(
    (miClave && clavePedidoComensal && clavePedidoComensal === miClave) ||
      pedido.esMio === true
  );
  const esMio = algunItemEsMio || raizEsMio;

  const totalCalculado = detalles
    .filter((d) => d.estado_item !== 'cancelado')
    .reduce((acc, d) => acc + d.subtotal, 0);
  const total = Number(pedido.total ?? totalCalculado);

  const id_pedido = pedido.id_pedido ?? pedido.id ?? null;
  if (esMio && id_pedido != null) {
    registrarMiPedidoId(id_pedido);
  }

  return {
    id_pedido,
    codigo_pedido: pedido.codigo_pedido ?? pedido.codigo ?? '',
    id_mesa: pedido.id_mesa ?? null,
    estado: String(pedido.estado || 'recibido').toLowerCase(),
    total,
    creado_en: pedido.creado_en || pedido.fecha || new Date().toISOString(),
    detalles,
    items: detalles,
    esMio,
  };
}

/**
 * Actualiza el estado de un pedido en una lista cuando llega un evento order:status.
 *
 * @param {Array<object>} pedidos - Lista de pedidos normalizados
 * @param {object} evento - { id_pedido, estado }
 * @returns {Array<object>} Nueva lista con el estado actualizado
 */
export function aplicarCambioEstado(pedidos, evento) {
  if (!Array.isArray(pedidos) || !evento || !evento.id_pedido) {
    return Array.isArray(pedidos) ? pedidos : [];
  }

  const idBuscado = String(evento.id_pedido);
  const nuevoEstado = String(evento.estado || '').toLowerCase();

  return pedidos.map((p) => {
    if (String(p.id_pedido) === idBuscado) {
      return {
        ...p,
        estado: nuevoEstado,
        actualizado_en: evento.emitidoEn || new Date().toISOString(),
      };
    }
    return p;
  });
}

/**
 * Separa una lista de pedidos normalizados en mis pedidos y pedidos de otros comensales.
 *
 * @param {Array<object>} pedidos - Lista de pedidos
 * @param {string|null} [miAlias] - Alias opcional para evaluar pertenencia
 * @returns {{ misPedidos: Array<object>, otrosPedidos: Array<object> }}
 */
export function separarPedidos(pedidos, miAlias = null) {
  if (!Array.isArray(pedidos)) {
    return { misPedidos: [], otrosPedidos: [] };
  }

  const miClave = claveAlias(miAlias);
  const misPedidos = [];
  const otrosPedidos = [];

  for (const p of pedidos) {
    const esMio = miClave
      ? Boolean(
          p.esMio ||
          p.detalles?.some((d) => claveAlias(d.comensal) === miClave) ||
          claveAlias(p.comensal) === miClave
        )
      : Boolean(p.esMio);

    if (esMio) {
      misPedidos.push({ ...p, esMio: true });
    } else {
      otrosPedidos.push(p);
    }
  }

  return { misPedidos, otrosPedidos };
}

/**
 * Determina el pedido principal a mostrar en la tarjeta de seguimiento.
 * Si hay un ID seleccionado, lo prioriza; si no, el primer pedido activo, o el más reciente.
 *
 * @param {Array<object>} misPedidos - Lista de mis pedidos
 * @param {number|string|null} [idSeleccionado] - ID del pedido seleccionado
 * @returns {object|null}
 */
export function pedidoPrincipal(misPedidos, idSeleccionado = null) {
  if (!Array.isArray(misPedidos) || misPedidos.length === 0) return null;

  if (idSeleccionado != null) {
    const hallado = misPedidos.find(
      (p) => String(p.id_pedido) === String(idSeleccionado)
    );
    if (hallado) return hallado;
  }

  // Priorizar el primer pedido activo (no entregado, pagado ni cancelado)
  const activos = ['recibido', 'en_preparacion', 'listo'];
  const primerActivo = misPedidos.find((p) => activos.includes(p.estado));
  if (primerActivo) return primerActivo;

  return misPedidos[0];
}

/**
 * Calcula un texto amigable de tiempo transcurrido (e.g. "hace 6 min", "hace 1 h").
 *
 * @param {string|number|Date} fecha - Timestamp o fecha ISO
 * @param {number} [ahora] - Timestamp de referencia
 * @returns {string}
 */
export function haceCuanto(fecha, ahora = Date.now()) {
  if (!fecha) return '';
  const timestamp = new Date(fecha).getTime();
  if (Number.isNaN(timestamp)) return '';

  const diffSegundos = Math.max(0, Math.floor((ahora - timestamp) / 1000));
  const diffMinutos = Math.floor(diffSegundos / 60);

  if (diffMinutos < 1) return 'hace un momento';
  if (diffMinutos < 60) return `hace ${diffMinutos} min`;

  const diffHoras = Math.floor(diffMinutos / 60);
  if (diffHoras < 24) return `hace ${diffHoras} h`;

  const diffDias = Math.floor(diffHoras / 24);
  return `hace ${diffDias} d`;
}

export const CLAVE_MIS_PEDIDOS_IDS = 'smartdining_mis_pedidos_ids';
export const CLAVE_ULTIMO_PEDIDO = 'smartdining_ultimo_pedido';

/**
 * Registra el ID de un pedido perteneciente al comensal actual en sessionStorage.
 *
 * @param {number|string|null} idPedido - ID del pedido a registrar
 */
export function registrarMiPedidoId(idPedido) {
  if (idPedido == null) return;
  try {
    const raw = sessionStorage.getItem(CLAVE_MIS_PEDIDOS_IDS);
    const lista = raw ? JSON.parse(raw) : [];
    const set = new Set(Array.isArray(lista) ? lista.map(String) : []);
    set.add(String(idPedido));
    sessionStorage.setItem(CLAVE_MIS_PEDIDOS_IDS, JSON.stringify([...set]));
  } catch {
    // Ignorar errores de almacenamiento
  }
}

/**
 * Determina si un id_pedido corresponde a una orden del comensal actual.
 * Revisa el registro de IDs, el último pedido y los pedidos simulados guardados.
 *
 * @param {number|string|null} idPedido - ID a verificar
 * @param {string|null} [miAlias] - Alias del usuario actual
 * @returns {boolean}
 */
export function esPedidoMio(idPedido, miAlias = null) {
  if (idPedido == null) return false;
  const idStr = String(idPedido);

  try {
    const rawIds = sessionStorage.getItem(CLAVE_MIS_PEDIDOS_IDS);
    if (rawIds) {
      const lista = JSON.parse(rawIds);
      if (Array.isArray(lista) && lista.some((id) => String(id) === idStr)) {
        return true;
      }
    }

    const rawUltimo = sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO);
    if (rawUltimo) {
      const ultimo = JSON.parse(rawUltimo);
      if (String(ultimo?.id_pedido ?? ultimo?.id) === idStr) {
        return true;
      }
    }

    const rawSimulados = sessionStorage.getItem('smartdining_pedidos_simulados');
    if (rawSimulados && miAlias) {
      const aliasNorm = miAlias.toLowerCase();
      const simulados = JSON.parse(rawSimulados);
      if (Array.isArray(simulados)) {
        const hallado = simulados.find((p) => String(p.id_pedido) === idStr);
        if (
          hallado?.detalles?.some(
            (d) => d.comensal?.toLowerCase() === aliasNorm
          )
        ) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Resume los pedidos activos y el estado prioritario de los pedidos propios del comensal.
 *
 * @param {Array<object>} mios - Lista de pedidos pertenecientes al comensal
 * @returns {{ cantidad: number, estadoPrincipal: string|null, tienePedidos: boolean }}
 */
export function resumenPedidosActivos(mios) {
  if (!Array.isArray(mios) || mios.length === 0) {
    return {
      cantidad: 0,
      estadoPrincipal: null,
      tienePedidos: false,
    };
  }

  const activos = mios.filter((p) =>
    ['recibido', 'en_preparacion', 'listo'].includes(
      String(p.estado || '').toLowerCase()
    )
  );

  const principal = pedidoPrincipal(mios);

  return {
    cantidad: activos.length,
    estadoPrincipal: principal ? principal.estado : null,
    tienePedidos: true,
  };
}

/**
 * Indica si el comensal actual puede quitar una línea de un pedido (J-14).
 *
 * Solo es true cuando el pedido sigue en `recibido`, la línea está `pendiente`
 * y la clave normalizada del comensal de la línea coincide con `yo` (`null` → `false`).
 *
 * @param {object|null|undefined} item - Línea del pedido
 * @param {{ yo?: string|null, estadoPedido?: string|null }} [contexto]
 * @returns {boolean}
 */
export function puedeQuitar(item, { yo, estadoPedido } = {}) {
  if (!item || typeof item !== 'object') return false;
  if (String(estadoPedido || '').trim().toLowerCase() !== 'recibido') {
    return false;
  }
  if (String(item.estado_item || '').trim().toLowerCase() !== 'pendiente') {
    return false;
  }
  const claveItem = claveAlias(item.comensal);
  const claveYo = claveAlias(yo);
  if (!claveItem || !claveYo) return false;
  return claveItem === claveYo;
}

/**
 * Traduce un error de POST /pedidos/:id/items/:id_detalle/cancelar a la acción de UI (J-14).
 *
 * @param {unknown} error
 * @returns {{ tipo: string, mensaje: string|null, refrescar: boolean }}
 */
export function accionErrorQuitar(error) {
  const motivo = String(error?.motivo ?? error?.data?.motivo ?? '')
    .trim()
    .toLowerCase();
  const status = Number(error?.status ?? 0);

  if (motivo === 'item_ya_cancelado') {
    return { tipo: 'silencioso', mensaje: null, refrescar: true };
  }
  if (motivo === 'item_en_preparacion') {
    return {
      tipo: 'en_preparacion',
      mensaje: 'Cocina ya empezó a preparar este plato.',
      refrescar: true,
    };
  }
  if (motivo === 'pago_registrado') {
    return {
      tipo: 'pago_registrado',
      mensaje: 'Ya hay un pago registrado; pídele ayuda al mesero.',
      refrescar: false,
    };
  }
  if (
    motivo === 'no_es_tuyo' ||
    motivo === 'no_encontrado' ||
    status === 403 ||
    status === 404
  ) {
    return {
      tipo: 'no_disponible',
      mensaje: 'No pudimos quitar este plato.',
      refrescar: true,
    };
  }

  return {
    tipo: 'error',
    mensaje: 'No pudimos quitar el plato. Inténtalo de nuevo.',
    refrescar: false,
  };
}

/**
 * Aplica de forma idempotente un evento `item:cancelado` sobre la lista de pedidos (J-14).
 * Marca la línea como `cancelado` y actualiza el total y estado del pedido.
 *
 * @param {Array<object>} pedidos
 * @param {object} evento - `{ id_pedido, id_detalle, total, estado_pedido, emitidoEn }`
 * @returns {Array<object>}
 */
export function aplicarItemCancelado(pedidos, evento) {
  if (!Array.isArray(pedidos)) return [];
  if (!evento || evento.id_pedido == null || evento.id_detalle == null) {
    return pedidos;
  }

  const idPedidoBuscado = String(evento.id_pedido);
  const idDetalleBuscado = String(evento.id_detalle);

  return pedidos.map((pedido) => {
    if (String(pedido.id_pedido) !== idPedidoBuscado) return pedido;

    const rawDetalles = Array.isArray(pedido.detalles)
      ? pedido.detalles
      : Array.isArray(pedido.items)
        ? pedido.items
        : [];

    const detallesActualizados = rawDetalles.map((detalle) => {
      if (String(detalle.id_detalle ?? detalle.id) !== idDetalleBuscado) {
        return detalle;
      }
      return {
        ...detalle,
        estado_item: 'cancelado',
      };
    });

    const estadoEvento = evento.estado_pedido ?? evento.estado;
    const estadoNuevo = estadoEvento
      ? String(estadoEvento).trim().toLowerCase()
      : detallesActualizados.length > 0 &&
          detallesActualizados.every((d) => d.estado_item === 'cancelado')
        ? 'cancelado'
        : pedido.estado;

    const tieneTotalEvento =
      evento.total != null &&
      evento.total !== '' &&
      Number.isFinite(Number(evento.total));
    const totalNuevo = tieneTotalEvento
      ? Number(evento.total)
      : detallesActualizados
          .filter((d) => d.estado_item !== 'cancelado')
          .reduce((acc, d) => acc + (Number(d.subtotal) || 0), 0);

    return {
      ...pedido,
      estado: estadoNuevo,
      total: totalNuevo,
      detalles: detallesActualizados,
      items: detallesActualizados,
      ...(evento.emitidoEn ? { actualizado_en: evento.emitidoEn } : {}),
    };
  });
}

/**
 * Reemplaza en la lista un pedido con la respuesta completa devuelta por la API
 * (por ejemplo el `pedido` del 200 al cancelar un ítem).
 *
 * @param {Array<object>} pedidos
 * @param {object} pedidoCrudo
 * @param {string|null} [miAlias]
 * @returns {Array<object>}
 */
export function reemplazarPedido(pedidos, pedidoCrudo, miAlias = null) {
  if (!Array.isArray(pedidos)) return [];
  const normalizado = normalizarPedido(pedidoCrudo, miAlias);
  if (!normalizado || normalizado.id_pedido == null) return pedidos;

  const idBuscado = String(normalizado.id_pedido);
  const existe = pedidos.some((p) => String(p.id_pedido) === idBuscado);
  if (!existe) return [normalizado, ...pedidos];

  return pedidos.map((p) => {
    if (String(p.id_pedido) !== idBuscado) return p;
    return {
      ...p,
      ...normalizado,
      creado_en: pedidoCrudo.creado_en || p.creado_en,
      esMio: p.esMio || normalizado.esMio,
    };
  });
}

export default {
  CLAVE_MIS_PEDIDOS_IDS,
  CLAVE_ULTIMO_PEDIDO,
  claveAlias,
  infoEstado,
  normalizarPedido,
  aplicarCambioEstado,
  aplicarItemCancelado,
  reemplazarPedido,
  puedeQuitar,
  accionErrorQuitar,
  separarPedidos,
  pedidoPrincipal,
  haceCuanto,
  registrarMiPedidoId,
  esPedidoMio,
  resumenPedidosActivos,
};
