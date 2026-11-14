/**
 * Excedentes del pago en línea (T4, EVENTS.md §8.7; backend #273, script 44).
 *
 * Un pago que Wompi ya cobró nunca se rechaza: si supera lo que se debía, el
 * backend lo registra, aplica lo que corresponde y deja el resto como
 * EXCEDENTE pendiente. La Caja lo devuelve en efectivo y lo marca devuelto
 * (PATCH /api/excedentes-pago-en-linea/:id/devuelto). El aviso en vivo es
 * `pago:excedente` (solo al panel); al conectar se cargan los pendientes con
 * GET /api/excedentes-pago-en-linea?estado=pendiente.
 */

import { horaBogota } from './caja'

/** Por qué sobró, en palabras del cajero. */
const POR_QUE = {
  excede_saldo_comensal: 'pagó en línea más de lo que debía',
  excede_saldo_mesa: 'pagó la cuenta de la mesa por más del saldo',
  sin_cuenta: 'la mesa ya estaba cerrada: se devuelve todo',
  otra_visita: 'pagó después de que su grupo se fue: se devuelve todo',
}

const entero = (v) => {
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * La respuesta de GET …?estado=pendiente → lista limpia, del más viejo al más
 * nuevo: { id, idMesa, comensal, excedente (pesos), motivo, creadoEn }.
 * Se descarta lo que no sirve para devolver (sin id, sin monto o ya devuelto).
 */
export function listaExcedentes(respuesta) {
  const filas = Array.isArray(respuesta) ? respuesta : Array.isArray(respuesta?.excedentes) ? respuesta.excedentes : []
  return filas
    .filter((x) => x && typeof x === 'object' && (x.estado === undefined || x.estado === 'pendiente'))
    .map((x) => ({
      id: entero(x.id),
      idMesa: entero(x.id_mesa),
      comensal: typeof x.comensal === 'string' && x.comensal.trim() ? x.comensal.trim() : null,
      excedente: entero(x.excedente_centavos) !== null ? entero(x.excedente_centavos) / 100 : null,
      motivo: typeof x.motivo === 'string' ? x.motivo : null,
      creadoEn: typeof x.creado_en === 'string' ? x.creado_en : null,
    }))
    .filter((x) => x.id > 0 && x.excedente > 0)
    .sort((a, b) => (Date.parse(a.creadoEn) || 0) - (Date.parse(b.creadoEn) || 0) || a.id - b.id)
}

/**
 * El texto de un excedente para la Caja: a quién, cuánto y por qué.
 * `numeroMesa(idMesa)` traduce el id al número que ve el cajero (si no, el id).
 */
export function textoExcedente(x, formatear = (n) => String(n), numeroMesa = (id) => id) {
  const quien = x.comensal ? `Mesa ${numeroMesa(x.idMesa)} · ${x.comensal}` : `Mesa ${numeroMesa(x.idMesa)}`
  const porQue = POR_QUE[x.motivo] || 'el pago en línea superó lo que se debía'
  // Sin fecha no hay hora (horaBogota(null) daría la época, 19:00).
  const hora = x.creadoEn ? horaBogota(x.creadoEn) : ''
  return `${hora ? `${hora} · ` : ''}${quien}: devuélvele ${formatear(x.excedente)} en efectivo (${porQue}).`
}

/** ¿Este error de PATCH …/devuelto quiere decir que ya no está pendiente? */
export function yaNoPendiente(err) {
  return err?.motivo === 'ya_devuelto' || err?.status === 404
}

/** El error al marcar devuelto, en palabras del cajero. */
export function mensajeErrorDevuelto(err) {
  if (err?.sinConexion) return 'Sin conexión con el servidor: no se sabe si quedó marcado. Vuelve a intentarlo.'
  if (err?.motivo === 'ya_devuelto') return 'Otro cajero ya lo había marcado como devuelto.'
  if (err?.status === 404) return 'Ese excedente ya no existe.'
  if (err?.status === 403) return 'Tu rol no puede marcar devoluciones (solo admin y cajero).'
  return `No se pudo marcar como devuelto: ${err?.message || 'error desconocido'}`
}
