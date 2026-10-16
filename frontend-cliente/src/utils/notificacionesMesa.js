/**
 * Utilidades puras para procesar y formatear eventos de la mesa en tiempo real.
 */

/**
 * Extrae el nombre o alias del comensal emisor de un evento de pedido.
 * Busca en order.comensal, alias, usuario o en el primer comensal definido en items.
 *
 * @param {object} data - Payload del evento order:created
 * @returns {string|null} - Nombre del comensal o null si no está disponible
 */
export function extraerEmisorPedido(data) {
  const pedido = data?.pedido;
  if (!pedido) return null;

  if (typeof pedido.comensal === 'string' && pedido.comensal.trim()) {
    return pedido.comensal.trim();
  }
  if (typeof pedido.alias === 'string' && pedido.alias.trim()) {
    return pedido.alias.trim();
  }
  if (typeof pedido.usuario === 'string' && pedido.usuario.trim()) {
    return pedido.usuario.trim();
  }

  if (Array.isArray(pedido.items)) {
    for (const item of pedido.items) {
      if (typeof item?.comensal === 'string' && item.comensal.trim()) {
        return item.comensal.trim();
      }
    }
  }

  return null;
}

/**
 * Determina el mensaje del toast para order:created.
 * - Si el pedido lo envió el usuario actual (mismo alias), devuelve null (no mostrar notificación a sí mismo).
 * - Si viene un emisor diferente, devuelve "[Emisor] envió su pedido a cocina".
 * - Si no hay nombre de emisor, devuelve "Se envió un pedido de la mesa".
 *
 * @param {object} data - Payload de order:created
 * @param {string} miAlias - Alias o apodo del comensal actual
 * @returns {string|null} - Mensaje a mostrar, o null si debe omitirse
 */
export function formatearMensajePedidoCreado(data, miAlias) {
  if (!data?.pedido) return null;

  const emisor = extraerEmisorPedido(data);
  const miAliasNorm = (miAlias || '').trim().toLowerCase();

  // No mostrar la notificación al propio comensal que envió el pedido
  if (emisor && miAliasNorm && emisor.toLowerCase() === miAliasNorm) {
    return null;
  }

  if (emisor) {
    return `${emisor} envió su pedido a cocina`;
  }

  return 'Se envió un pedido de la mesa';
}

export default {
  extraerEmisorPedido,
  formatearMensajePedidoCreado,
};
