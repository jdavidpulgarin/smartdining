/**
 * Cómo se ve una mesa en su tarjeta (TableCard): la clase visual y la
 * etiqueta. Los cuatro estados de la base (CHECK de mesas.estado) son
 * disponible, ocupada, reservada y mantenimiento; con T12 (mesa:actualizada)
 * llegan en vivo, así que reservada y mantenimiento ya no pueden verse como
 * «DISPONIBLE». Encima del estado van los avisos de la mesa (llama al mesero,
 * pide la cuenta, pedido listo), en ese orden.
 *
 * @param {{ estado?: string, alerta?: string|null, activa?: boolean }} mesa
 *   estado: el de la mesa (o el `status` del panel), sin importar mayúsculas;
 *   alerta: 'llamado' | 'cuenta' | 'listo' (o el estado viejo con ese nombre);
 *   activa: el `active` del panel (sesión abierta).
 * @returns {{ visual: string, etiqueta: string }}
 */
export function estadoTarjetaMesa({ estado, alerta = null, activa = false } = {}) {
  const e = String(estado || 'disponible').toLowerCase()
  if (alerta === 'llamado' || e === 'llamado') return { visual: 'llamado', etiqueta: 'LLAMA AL MESERO' }
  if (alerta === 'cuenta' || e === 'cuenta' || e === 'cuenta_pedida') return { visual: 'cuenta', etiqueta: 'PIDE LA CUENTA' }
  if (alerta === 'listo' || e === 'listo' || e === 'pedido_listo') return { visual: 'listo', etiqueta: 'PEDIDO LISTO' }
  if (e === 'ocupada' || activa) return { visual: 'ocupada', etiqueta: 'OCUPADA' }
  if (e === 'reservada') return { visual: 'reservada', etiqueta: 'RESERVADA' }
  if (e === 'mantenimiento') return { visual: 'mantenimiento', etiqueta: 'EN MANTENIMIENTO' }
  return { visual: 'disponible', etiqueta: 'DISPONIBLE' }
}

/** El texto corto de la tarjeta («detail») según el estado de la mesa. */
export function detalleMesa(estado, sesionAbierta = false) {
  switch (String(estado || '').toLowerCase()) {
    case 'disponible':
      return 'Lista para asignar'
    case 'ocupada':
      return sesionAbierta ? 'Sesión activa · QR generado' : 'Ocupada'
    case 'reservada':
      return 'Reservada'
    case 'mantenimiento':
      return 'En mantenimiento: no se asigna'
    default:
      return 'Lista para asignar'
  }
}
