/**
 * Utilidades puras para el estado, formato y seguimiento del pedido.
 */

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

  const aliasNormalizado = String(miAlias || '').trim().toLowerCase();

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
    const esMio = Boolean(
      aliasNormalizado &&
        comensal &&
        comensal.toLowerCase() === aliasNormalizado
    );

    return {
      id_detalle: item.id_detalle ?? item.id ?? idx,
      plato_nombre: nombre,
      nombre,
      cantidad,
      precio_unitario: precioUnitario,
      subtotal,
      notas: item.notas || null,
      comensal,
      esMio,
      ingredientes: Array.isArray(item.ingredientes) ? item.ingredientes : [],
    };
  });

  const pedidoComensal = pedido.comensal
    ? String(pedido.comensal).trim().toLowerCase()
    : null;
  const algunItemEsMio = detalles.some((d) => d.esMio);
  const raizEsMio = Boolean(
    (aliasNormalizado && pedidoComensal && pedidoComensal === aliasNormalizado) ||
      pedido.esMio === true
  );
  const esMio = algunItemEsMio || raizEsMio;

  const totalCalculado = detalles.reduce((acc, d) => acc + d.subtotal, 0);
  const total = Number(pedido.total ?? totalCalculado);

  return {
    id_pedido: pedido.id_pedido ?? pedido.id ?? null,
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

  const aliasNorm = String(miAlias || '').trim().toLowerCase();
  const misPedidos = [];
  const otrosPedidos = [];

  for (const p of pedidos) {
    const esMio = aliasNorm
      ? Boolean(
          p.esMio ||
          p.detalles?.some((d) => d.comensal?.toLowerCase() === aliasNorm) ||
          p.comensal?.toLowerCase() === aliasNorm
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

export default {
  infoEstado,
  normalizarPedido,
  aplicarCambioEstado,
  separarPedidos,
  pedidoPrincipal,
  haceCuanto,
};
