/**
 * Detalle de la mesa (TableDetailModal): consumo, pagado, saldo, reparto por
 * comensal y comandas, todo de GET /mesas/:id/cuenta, igual que la Caja.
 *
 * Antes el modal sumaba los pedidosActivos del panel filtrando solo por
 * id_mesa: entraban pedidos de visitas anteriores (un 'entregado' que quedó
 * sin cerrar) y el pagado era siempre 0, así que una mesa libre podía enseñar
 * consumo y saldo de otro grupo.
 *
 * Reglas:
 *   - Mesa sin visita en curso (mesaConSesionActiva, la regla de la Caja): sin
 *     consumo, sin saldo y sin comandas, diga lo que diga la cuenta (que para
 *     una mesa libre es la de la visita anterior).
 *   - Los números son los de la cuenta (la base reparte y suma; aquí no).
 *   - Comandas: los pedidos de la cuenta (ya limitados a la visita por
 *     sesion_iniciada_en) que no están cerrados. Los ítems se toman del pedido
 *     del panel con el mismo id_pedido, que es el que llega en vivo.
 *   - Pagada con pedidos sin entregar: aviso. El backend solo cierra un pedido
 *     (→ 'pagado') cuando está entregado y cubierto, y la mesa solo se libera
 *     sin pedidos abiertos; esa regla no se toca aquí.
 */
import { mesaConSesionActiva } from './caja'

/** Pedidos que aún no llegaron a la mesa. */
export const ESTADOS_SIN_ENTREGAR = Object.freeze(['recibido', 'en_preparacion', 'listo'])

/** Pedidos que ya no son comandas en curso. */
const ESTADOS_CERRADOS = ['pagado', 'cancelado']

export const AVISO_PAGADA_SIN_ENTREGAR =
  'Pagada: marca los pedidos como entregados para cerrar la mesa'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const VACIO = Object.freeze({
  conSesion: false,
  total: 0,
  pagado: 0,
  saldo: 0,
  items: 0,
  comensales: [],
  comandas: [],
  pagadaSinEntregar: false,
})

/**
 * @param {object} p
 * @param {object} p.mesa             la mesa del panel (estado/status, sesion_abierta)
 * @param {object|null} p.cuenta      respuesta de GET /mesas/:id/cuenta (o null mientras carga)
 * @param {object[]} [p.pedidosPanel] pedidosActivos del contexto (para los ítems)
 */
export function resumenDetalleMesa({ mesa, cuenta, pedidosPanel = [] } = {}) {
  // La cuenta también trae el estado: si ya dice que la mesa está libre, gana
  // (el panel pudo no haberse enterado todavía de la liberación).
  const libreSegunCuenta =
    cuenta?.estado_mesa != null && !mesaConSesionActiva({ estado: cuenta.estado_mesa, sesion_abierta: mesa?.sesion_abierta })
  if (!mesaConSesionActiva(mesa) || libreSegunCuenta) return { ...VACIO }
  if (!cuenta) return { ...VACIO, conSesion: true }

  const itemsPorPedido = new Map(
    (pedidosPanel || []).map((p) => [Number(p.id_pedido), p.detalles || p.items || []])
  )

  const comandas = (cuenta.pedidos || [])
    .filter((p) => !ESTADOS_CERRADOS.includes(String(p.estado || '').toLowerCase()))
    .map((p) => ({ ...p, detalles: itemsPorPedido.get(Number(p.id_pedido)) || [] }))

  const total = num(cuenta.total_mesa)
  const pagado = num(cuenta.pagado_mesa)
  const saldo = Math.max(0, num(cuenta.saldo_mesa))

  // Mesa saldada: nadie debe nada. Al cobrar "toda la cuenta" el pago queda a
  // nombre de "General" y el reparto de la base deja a los demás comensales con
  // su subtotal como saldo; con el saldo de la mesa en 0 eso no es deuda real.
  const cuentaSaldada = total > 0 && saldo === 0

  const comensales = (cuenta.comensales || [])
    .map((c) => ({
      nombre: (c.comensal || 'General').trim() || 'General',
      items: num(c.items_pedidos),
      subtotal: num(c.subtotal),
      pagado: num(c.pagado),
      saldo: cuentaSaldada ? 0 : num(c.saldo),
    }))
    .filter((c) => c.subtotal > 0 || c.pagado > 0)

  const pagadaSinEntregar =
    cuentaSaldada &&
    comandas.some((p) => ESTADOS_SIN_ENTREGAR.includes(String(p.estado || '').toLowerCase()))

  return {
    conSesion: true,
    total,
    pagado,
    saldo,
    items: num(cuenta.items_totales),
    comensales,
    comandas,
    pagadaSinEntregar,
  }
}

/** ¿Este aviso del socket es de esta mesa? Sin id_mesa en el aviso, por si acaso sí. */
export function avisoDeEstaMesa(data, idMesa) {
  if (data?.id_mesa == null) return true
  return Number(data.id_mesa) === Number(idMesa)
}
