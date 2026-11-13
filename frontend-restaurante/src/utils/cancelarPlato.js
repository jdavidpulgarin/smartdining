/**
 * «Cancelar plato» del personal (D-13):
 * POST /api/pedidos/:id/items/:id_detalle/cancelar con { motivo }.
 * Contrato: backend/docs/api-spec.md, «Camino del personal (D-13)».
 */

/** Solo admin y mesero (el backend da 403 a cajero y cocina). */
export const ROLES_CANCELAR_PLATO = ['admin', 'mesero']

export function puedeCancelarPlato(rol) {
  return ROLES_CANCELAR_PLATO.includes(rol)
}

/** Estados del pedido en los que el personal puede cancelar una línea. */
const ESTADOS_PEDIDO_CANCELABLES = ['recibido', 'en_preparacion', 'listo']

/**
 * ¿Se le muestra el botón a esta línea? Pedido sin entregar, pagar ni cancelar,
 * y línea viva (ni cancelada ni servida). Lo demás (pagos, última línea) lo
 * decide el backend y vuelve como 409 con su motivo.
 */
export function lineaCancelable(estadoPedido, estadoItem) {
  return ESTADOS_PEDIDO_CANCELABLES.includes(estadoPedido)
    && estadoItem !== 'cancelado'
    && estadoItem !== 'servido'
}

export const MOTIVO_MAX = 200

/** El motivo es obligatorio: recortado, de 1 a 200 caracteres. */
export function validarMotivo(texto) {
  const motivo = typeof texto === 'string' ? texto.trim() : ''
  if (!motivo) return { error: 'Escribe el motivo: queda en el historial del pedido.' }
  if ([...motivo].length > MOTIVO_MAX) return { error: `El motivo admite hasta ${MOTIVO_MAX} caracteres.` }
  return { motivo }
}

/** El error del backend en palabras del mesero, según el `motivo` del contrato. */
export function mensajeErrorCancelarPlato(err) {
  if (err?.sinConexion) return 'Sin conexión con el servidor: no se sabe si se canceló. Revisa el pedido antes de intentarlo otra vez.'
  switch (err?.motivo) {
    case 'item_ya_cancelado':
      return 'Ese plato ya estaba cancelado.'
    case 'item_no_cancelable':
      return 'Ese plato ya no se puede cancelar: ya se sirvió, el pedido está entregado, o es el último plato de un pedido que no puede cancelarse.'
    case 'pago_registrado':
      return 'Lo ya pagado supera el total que quedaría sin ese plato: hay que reembolsar antes de cancelarlo.'
    case 'motivo_requerido':
      return 'Escribe el motivo (hasta 200 caracteres).'
    case 'no_encontrado':
      return 'Ese plato o ese pedido ya no existe. Recarga los pedidos.'
    case 'autor_inexistente':
      return 'Tu usuario ya no existe; vuelve a iniciar sesión.'
    default:
      if (err?.status === 403) return 'Tu rol no puede cancelar platos (solo admin y mesero).'
      return `No se pudo cancelar el plato: ${err?.message || 'error desconocido'}`
  }
}
