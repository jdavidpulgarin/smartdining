/**
 * Ayudas para eventos del socket-server (socket-server/EVENTS.md §5).
 */

/** Cuántos eventId recuerda cada ventana. Con los últimos 200 basta para los reintentos. */
export const TAMANO_VENTANA_EVENTOS = 200

/**
 * Ventana de eventId ya vistos, para deduplicar `order:created` y `order:status`
 * ("pueden llegar repetidos si el servidor reintenta; deduplica por eventId").
 *
 * Devuelve `yaVisto(eventId)`: true si ese eventId ya pasó (hay que ignorar el
 * evento); false si es nuevo, y desde ese momento queda registrado. Un evento
 * sin eventId no se puede deduplicar y siempre cuenta como nuevo. Se olvida el
 * más antiguo al pasar del tope, así la memoria no crece con el turno.
 *
 * Usa una ventana por tipo de evento: así un tipo no le quita lugar al otro.
 */
export function crearVentanaEventos(tamano = TAMANO_VENTANA_EVENTOS) {
  const vistos = new Set()
  return function yaVisto(eventId) {
    if (!eventId) return false
    if (vistos.has(eventId)) return true
    vistos.add(eventId)
    if (vistos.size > tamano) vistos.delete(vistos.values().next().value)
    return false
  }
}

/**
 * Para eventos de ESTADO COMPLETO sin eventId (`plato:disponibilidad`,
 * `ingrediente:disponibilidad`): no hay nada que deduplicar, pero dos avisos del
 * mismo id pueden llegar desordenados. Devuelve `esViejo(id, emitidoEn)`: true
 * si ya se aplicó un aviso MÁS RECIENTE de ese id (hay que ignorarlo). Sin un
 * `emitidoEn` legible no se puede comparar y el aviso se aplica.
 */
export function crearUltimoPorId() {
  const ultimo = new Map()
  return function esViejo(id, emitidoEn) {
    const instante = Date.parse(emitidoEn)
    if (!Number.isFinite(instante)) return false
    const previo = ultimo.get(id)
    if (previo !== undefined && instante < previo) return true
    ultimo.set(id, instante)
    return false
  }
}
