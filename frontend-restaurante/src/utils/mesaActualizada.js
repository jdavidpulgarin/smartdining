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

/**
 * ¿Es esta la mesa con este id_mesa? SIEMPRE y SOLO por id_mesa: el número es
 * lo que se ve, el id es lo que usan el backend y el socket. Comparar «por id o
 * por número» confunde dos mesas en cuanto el id de una es el número de otra
 * (mesas creadas o borradas en Configuración): abrir la 13 abría la 10.
 */
export const mismaMesa = (t, id) => {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 && Number(t?.id_mesa ?? t?.id) === n
}

/** La mesa de la lista con ese id_mesa (o undefined). */
export const buscarMesa = (tablas, id) => (Array.isArray(tablas) ? tablas.find((t) => mismaMesa(t, id)) : undefined)

/**
 * El número que se le muestra a la gente para un id_mesa. Si la mesa no está
 * en la lista, el id (mejor que nada).
 */
export function numeroDeMesa(tablas, id) {
  const m = buscarMesa(tablas, id)
  return m?.numero ?? m?.number ?? id
}

/**
 * El resultado de GET /api/mesas cuando, MIENTRAS se pedía, llegaron avisos
 * mesa:actualizada (pasa al recargar tras reconectar). La respuesta es más
 * vieja que esos avisos: no los puede pisar (una mesa recién abierta volvería a
 * «disponible»). Revisión de Roberto en el #278.
 *
 * @param {Array} previa      la lista actual (ya con los avisos aplicados)
 * @param {Array} delBackend  las mesas de GET /api/mesas
 * @param {Map<number, 'actualizada'|'eliminada'>} avisadas  lo que avisó el socket durante la carga
 * @param {Function} normalizar  normalizarMesa de TablesContext
 */
export function fusionarCargaConAvisos(previa, delBackend, avisadas, normalizar) {
  const actual = Array.isArray(previa) ? previa : []
  const porId = new Map(actual.map((t) => [Number(t?.id_mesa ?? t?.id), t]))
  const marcas = avisadas instanceof Map ? avisadas : new Map()
  const vistas = new Set()
  const salida = []
  for (const m of Array.isArray(delBackend) ? delBackend : []) {
    const id = Number(m?.id_mesa)
    vistas.add(id)
    const marca = marcas.get(id)
    if (marca === 'eliminada') continue // se borró durante la carga
    if (marca === 'actualizada' && porId.has(id)) {
      salida.push(porId.get(id)) // el aviso es más nuevo que esta respuesta
      continue
    }
    salida.push(normalizar(m, porId.get(id) || porId.get(Number(m?.numero)) || {}))
  }
  // Creadas por aviso durante la carga y que la respuesta todavía no trae.
  for (const [id, marca] of marcas) {
    if (marca === 'actualizada' && !vistas.has(id) && porId.has(id)) salida.push(porId.get(id))
  }
  return salida.sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0))
}

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
