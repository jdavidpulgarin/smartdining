/**
 * T12: `mesa:actualizada` (socket-server/EVENTS.md §5.7, #247; el backend lo
 * avisa tras cada cambio de mesa, #276). Llega solo a room:admin:
 *   { eventId, id_mesa, numero, estado, capacidad, ubicacion,
 *     activa?, sesion_abierta?, motivo?, id_mesero?, emitidoEn }
 * Nunca trae token_qr. motivo: abierta | estado | creada | datos | liberada |
 * eliminada | mesero (o no viene).
 *
 *   - eliminada (solo trae id_mesa) → se quita la mesa;
 *   - creada, o un id_mesa que no está en la lista → se agrega;
 *   - lo demás (o sin motivo) → se actualiza por id_mesa con los campos que vengan.
 *
 * GET /api/mesas lista también las inactivas: `activa: false` sin `eliminada`
 * actualiza la mesa, no la quita. Al quedar disponible (liberada) se olvida el
 * QR que tuviera el panel: ya está revocado.
 */

const entero = (v) => (Number.isInteger(v) && v > 0 ? v : null)
const mismaMesa = (t, id) => Number(t?.id_mesa ?? t?.id) === id

/**
 * La lista de mesas del panel después de un `mesa:actualizada`.
 * `normalizar(mesaDelBackend, previa)` es la misma que usa la carga de
 * GET /api/mesas (TablesContext), así la fila queda igual que tras recargar.
 * Devuelve la MISMA lista si el evento no sirve (sin id_mesa válido).
 */
export function aplicarMesaActualizada(tablas, ev, normalizar) {
  const lista = Array.isArray(tablas) ? tablas : []
  const id = entero(ev?.id_mesa)
  if (!id) return lista

  if (ev.motivo === 'eliminada') {
    return lista.some((t) => mismaMesa(t, id)) ? lista.filter((t) => !mismaMesa(t, id)) : lista
  }

  const previa = lista.find((t) => mismaMesa(t, id))
  const campo = (nombre, deLaPrevia) => (ev[nombre] !== undefined ? ev[nombre] : deLaPrevia)
  const delBackend = {
    id_mesa: id,
    numero: campo('numero', previa?.numero),
    estado: campo('estado', previa?.estado),
    capacidad: campo('capacidad', previa?.capacidad),
    ubicacion: campo('ubicacion', previa?.ubicacion),
    sesion_abierta: campo('sesion_abierta', previa?.sesion_abierta),
  }
  // Disponible = la sesión terminó: el QR que guardaba el panel ya no sirve.
  const base = delBackend.estado === 'disponible' && previa ? { ...previa, token_qr: null, qr_url: null } : previa || {}
  const fila = { ...base, ...normalizar(delBackend, base) }
  if (ev.activa !== undefined) fila.activa = ev.activa
  if (ev.id_mesero !== undefined) fila.id_mesero = ev.id_mesero

  if (!previa) {
    return [...lista, fila].sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0))
  }
  return lista.map((t) => (mismaMesa(t, id) ? fila : t))
}
