/**
 * Reporte de consumo de inventario (P-22, paso 5): GET /api/reportes/consumo.
 * Contrato: backend/docs/api-spec.md, «GET /reportes/consumo» (solo admin).
 *
 * Las fechas son días de Bogotá (AAAA-MM-DD), como las calcula la base. El
 * rango va de `desde` a `hasta`, ambos incluidos, con 31 días como máximo y sin
 * días futuros. Aquí se repite esa regla para avisar antes de pedir; la que
 * manda es la de la base (400 consulta_invalida).
 *
 * Los totales vienen calculados por la base y cuadran con la suma de los días:
 * la pantalla los muestra tal cual y no suma nada.
 */

export const MAX_DIAS = 31
const ZONA = 'America/Bogota'
const FORMATO = /^\d{4}-\d{2}-\d{2}$/

/** "Hoy" en Bogotá como AAAA-MM-DD, venga de donde venga el navegador. */
export function hoyBogota(ahora = new Date()) {
  // en-CA da AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
}

/** ¿La fecha AAAA-MM-DD existe en el calendario? (2026-02-30 no.) */
export function fechaValida(texto) {
  if (typeof texto !== 'string' || !FORMATO.test(texto)) return false
  const [a, m, d] = texto.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

/** La fecha AAAA-MM-DD más `n` días (sin horas, así no la mueve el huso). */
export function sumarDias(fecha, n) {
  const [a, m, d] = fecha.split('-').map(Number)
  const f = new Date(Date.UTC(a, m - 1, d + n))
  return f.toISOString().slice(0, 10)
}

/** Días del rango contando los dos extremos (del 1 al 31 son 31). */
export function diasDelRango(desde, hasta) {
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000) + 1
}

/** Rangos de un clic. Todos terminan hoy y caben en 31 días. */
export const RANGOS_RAPIDOS = [
  { id: 'hoy', etiqueta: 'Hoy' },
  { id: '7', etiqueta: 'Últimos 7 días' },
  { id: 'mes', etiqueta: 'Este mes' },
]

export function rangoRapido(id, hoy = hoyBogota()) {
  if (id === 'hoy') return { desde: hoy, hasta: hoy }
  if (id === 'mes') return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy }
  return { desde: sumarDias(hoy, -6), hasta: hoy }
}

/**
 * La misma regla del contrato, para no gastar una petición en un 400. Devuelve
 * el mensaje para el admin, o null si el rango sirve.
 */
export function validarRango({ desde, hasta }, hoy = hoyBogota()) {
  if (!fechaValida(desde) || !fechaValida(hasta)) return 'Elige las dos fechas (desde y hasta).'
  if (hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».'
  if (hasta > hoy) return 'La fecha «hasta» no puede ser futura.'
  if (diasDelRango(desde, hasta) > MAX_DIAS) return `El rango puede tener como mucho ${MAX_DIAS} días.`
  return null
}

/** Query de la petición: desde y hasta siempre; id_insumo solo si se eligió uno. */
export function consultaDeConsumo({ desde, hasta, idInsumo = null }) {
  const p = new URLSearchParams({ desde, hasta })
  if (idInsumo) p.set('id_insumo', String(idInsumo))
  return p.toString()
}

/** El error de la API en palabras del admin. */
export function mensajeErrorConsumo(err) {
  if (err?.sinConexion) return 'Sin conexión con el servidor: no se pudo traer el reporte.'
  if (err?.status === 403) return 'Solo el administrador puede ver el reporte de consumo.'
  if (err?.status === 404) return 'Ese insumo ya no existe. Actualiza la lista.'
  if (err?.motivo === 'consulta_invalida') return `El servidor no aceptó el rango: ${err.message || 'revisa las fechas'}.`
  return `No se pudo traer el reporte: ${err?.message || 'error desconocido'}`
}

/** Filtra los insumos del reporte por nombre (sin distinguir mayúsculas ni tildes). */
export function filtrarConsumo(insumos = [], busqueda = '') {
  const clave = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const q = clave(busqueda)
  if (!q) return insumos
  return insumos.filter((i) => clave(i.nombre).includes(q))
}

/** "lun 2 nov" para una fecha AAAA-MM-DD (día de Bogotá, sin mover por huso). */
export function fechaCorta(fecha) {
  if (!fechaValida(fecha)) return fecha || ''
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** Ajustes con su signo: "+50 g", "−20 g", "0 g". */
export function conSigno(valor, formatear) {
  const n = Number(valor) || 0
  if (n > 0) return `+${formatear(n)}`
  if (n < 0) return `−${formatear(-n)}`
  return formatear(0)
}
