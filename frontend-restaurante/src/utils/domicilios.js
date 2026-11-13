// P-24 · Despacho y repartidor en el panel, sobre la D-20a del backend (#231).
// Lógica pura: roles, qué puede hacer cada uno con una entrega, cómo se nombra
// un pedido que no tiene mesa y los mensajes de error por motivo.

export const ROL_REPARTIDOR = 'repartidor'
/** Quién despacha (asigna repartidores): los mismos del backend. */
export const ROLES_DESPACHO = ['admin', 'cajero']

export const esRepartidor = (rol) => rol === ROL_REPARTIDOR
export const puedeDespachar = (rol) => ROLES_DESPACHO.includes(rol)

/**
 * ¿Ve este rol el enlace de la barra? Con `roles`, solo esos; sin `roles`, todos
 * menos lo marcado `soloAdmin`. El repartidor solo ve los enlaces que lo nombran.
 */
export function enlaceVisible(item, rol) {
  if (esRepartidor(rol)) return Boolean(item.roles?.includes(rol))
  if (item.roles) return item.roles.includes(rol)
  return !item.soloAdmin || rol === 'admin'
}

/** Estados de la entrega (pedidos_domicilio.estado_entrega, script 36). */
export const ESTADOS_ENTREGA = ['por_asignar', 'asignado', 'en_camino', 'entregado', 'fallido']
export const ESTADOS_SIN_TERMINAR = ['por_asignar', 'asignado', 'en_camino']
export const ESTADOS_TERMINADOS = ['entregado', 'fallido']

const ETIQUETAS_ENTREGA = {
  por_asignar: 'Por asignar',
  asignado: 'Asignado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  fallido: 'No se entregó',
}
export const etiquetaEntrega = (estado) => ETIQUETAS_ENTREGA[estado] || estado || '—'

const ETIQUETAS_COCINA = {
  recibido: 'Recibido en cocina',
  en_preparacion: 'En preparación',
  listo: 'Listo para salir',
  entregado: 'Entregado',
  pagado: 'Cerrado',
  cancelado: 'Cancelado',
}
export const etiquetaCocina = (estado) => ETIQUETAS_COCINA[estado] || estado || '—'

/**
 * Lo que el repartidor puede hacer con SU entrega. `salir` solo con el pedido
 * listo en cocina: el backend da 409 pedido_no_listo; aquí se avisa antes.
 *
 * @returns {{ salir: boolean, entregar: boolean, fallar: boolean, esperandoCocina: boolean }}
 */
export function accionesRepartidor(entrega) {
  const estado = entrega?.estado_entrega
  const listo = entrega?.pedido?.estado === 'listo'
  return {
    salir: estado === 'asignado' && listo,
    esperandoCocina: estado === 'asignado' && !listo,
    entregar: estado === 'en_camino',
    fallar: estado === 'en_camino',
  }
}

/** ¿Se le puede asignar o cambiar el repartidor? (mientras no haya salido). */
export const puedeAsignar = (entrega) =>
  ['por_asignar', 'asignado'].includes(entrega?.estado_entrega) && entrega?.pedido?.estado !== 'cancelado'

/**
 * Un fallido es final (D-20a, opción (a) de Jarrison): el pedido se queda en
 * 'listo' y solo el admin lo cancela. El reembolso va aparte.
 */
export const puedeCancelarFallido = (entrega, rol) =>
  entrega?.estado_entrega === 'fallido' && entrega?.pedido?.estado === 'listo' && rol === 'admin'

export const MAX_MOTIVO_FALLO = 200

/** null si el motivo vale; si no, el mensaje (el backend pide 1 a 200 caracteres). */
export function validarMotivoFallo(motivo) {
  const m = typeof motivo === 'string' ? motivo.trim() : ''
  if (!m) return 'Escribe por qué no se pudo entregar.'
  if (m.length > MAX_MOTIVO_FALLO) return `Máximo ${MAX_MOTIVO_FALLO} caracteres.`
  return null
}

/** id_pedido → domicilio, para nombrar los pedidos sin mesa en Pedidos y Caja. */
export function indexarPorPedido(domicilios = []) {
  return new Map(domicilios.map((d) => [Number(d.pedido?.id_pedido), d]))
}

/**
 * Cómo se nombra el lugar de un pedido donde el panel esperaba un número de
 * mesa. `domicilio` es la entrega del despacho, si se tiene (el mesero no
 * puede leer /domicilios: para él sale solo «Domicilio»).
 *
 * @param {{ canal?: string, mesa_numero?: number, numero_mesa?: number, id_mesa?: number }} pedido
 * @param {object} [domicilio]
 * @returns {{ tipo: 'mesa' | 'domicilio' | 'para_llevar' | 'desconocido', texto: string, detalle: string | null }}
 */
export function ubicacionPedido(pedido = {}, domicilio = null) {
  const numero = pedido.mesa_numero ?? pedido.numero_mesa ?? null
  if (pedido.canal === 'domicilio') {
    const partes = [domicilio?.zona?.nombre, domicilio?.direccion?.direccion].filter(Boolean)
    return { tipo: 'domicilio', texto: 'Domicilio', detalle: partes.length ? partes.join(' · ') : null }
  }
  if (pedido.canal === 'para_llevar') return { tipo: 'para_llevar', texto: 'Para llevar', detalle: null }
  if (numero != null) return { tipo: 'mesa', texto: `Mesa ${numero}`, detalle: null }
  if (pedido.id_mesa != null) return { tipo: 'mesa', texto: `Mesa ${pedido.id_mesa}`, detalle: null }
  return { tipo: 'desconocido', texto: 'Sin mesa', detalle: null }
}

/**
 * Un domicilio lo entrega el repartidor (POST /domicilios/:id/entregar), nunca
 * el botón «Entregar» de Pedidos: ese camino se saltaría la entrega.
 */
export const loEntregaElRepartidor = (pedido) => pedido?.canal === 'domicilio'

const MENSAJES = {
  pedido_no_listo: 'El pedido todavía no está listo en cocina.',
  entrega_ya_salio: 'La entrega ya salió: no se puede cambiar el repartidor.',
  no_es_tu_entrega: 'Esa entrega no es tuya.',
  transicion_invalida: 'La entrega ya cambió de estado. Actualiza la lista.',
  repartidor_no_valido: 'Ese repartidor ya no está activo.',
  pedido_cancelado: 'El pedido está cancelado.',
  entrega_en_camino: 'El pedido va en camino: no se puede cancelar.',
  no_encontrado: 'Ese domicilio ya no existe.',
}

/** Mensaje para un error de las rutas de domicilios, por su motivo. */
export function mensajeErrorDomicilio(err) {
  if (err?.sinConexion) return 'Sin conexión: no se guardó.'
  if (err?.motivo && MENSAJES[err.motivo]) return MENSAJES[err.motivo]
  return err?.message ? `No se pudo: ${err.message}` : 'No se pudo.'
}
