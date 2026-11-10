/**
 * Reglas del formulario "Datos del restaurante" (P-21, pestaña Restaurante).
 *
 * Contrato: backend/docs/api-spec.md, "Configuración del restaurante (D-16
 * parte B)". GET /configuracion/completa trae la fila; PUT /configuracion es
 * PARCIAL y `.strict()`: solo se mandan los campos que cambiaron, y nunca
 * `id`, `actualizado_en` ni `actualizado_por`.
 *
 * El backend valida lo mismo (y la base tiene sus CHECK). Esto solo evita mandar
 * algo que se sabe que va a rechazar y da el mensaje antes. Sobre `horario` el
 * backend solo exige que sea un objeto, así que la forma por día (`abre` y
 * `cierra` en HH:MM, día ausente = cerrado) la cuida este formulario.
 */

/** Claves de `horario` (sin tildes, como el script 26) y cómo se muestran. */
export const DIAS = [
  { clave: 'lunes', etiqueta: 'Lunes' },
  { clave: 'martes', etiqueta: 'Martes' },
  { clave: 'miercoles', etiqueta: 'Miércoles' },
  { clave: 'jueves', etiqueta: 'Jueves' },
  { clave: 'viernes', etiqueta: 'Viernes' },
  { clave: 'sabado', etiqueta: 'Sábado' },
  { clave: 'domingo', etiqueta: 'Domingo' },
]

/** Los campos que el PUT acepta. Ni uno más (el cuerpo es `.strict()`). */
export const CAMPOS_EDITABLES = ['nombre', 'telefono', 'direccion', 'url_logo', 'horario', 'propina_sugerida_pct', 'moneda']

/** Largos máximos: los de las columnas de `configuracion_restaurante`. */
export const LIMITES = { nombre: 120, telefono: 30, direccion: 200, url_logo: 255 }

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const MONEDA = /^[A-Z]{3}$/
const HORARIO_VACIO = { abierto: false, abre: '', cierra: '' }

/**
 * Fila de GET /configuracion/completa → estado del formulario (todo texto, como
 * los inputs). Un día que no está en `horario` sale cerrado.
 */
export function formDesdeConfig(config = {}) {
  const horario = config.horario && typeof config.horario === 'object' && !Array.isArray(config.horario) ? config.horario : {}
  return {
    nombre: config.nombre ?? '',
    telefono: config.telefono ?? '',
    direccion: config.direccion ?? '',
    url_logo: config.url_logo ?? '',
    propina_sugerida_pct: config.propina_sugerida_pct === null || config.propina_sugerida_pct === undefined ? '' : String(config.propina_sugerida_pct),
    moneda: config.moneda ?? '',
    horario: Object.fromEntries(
      DIAS.map(({ clave }) => {
        const dia = horario[clave]
        return [clave, dia ? { abierto: true, abre: dia.abre ?? '', cierra: dia.cierra ?? '' } : { ...HORARIO_VACIO }]
      })
    ),
  }
}

/** Texto opcional: vacío → null (así se borra el teléfono o el logo). */
function opcional(valor) {
  const t = String(valor ?? '').trim()
  return t === '' ? null : t
}

/**
 * Formulario → { datos } con los 7 campos ya en el tipo del contrato, o
 * { error } con el primer problema, en el orden en que se ven en pantalla.
 */
export function validarConfig(form) {
  const nombre = String(form.nombre ?? '').trim()
  if (!nombre) return { error: 'El nombre del restaurante es obligatorio.' }
  if (nombre.length > LIMITES.nombre) return { error: `El nombre admite hasta ${LIMITES.nombre} caracteres.` }

  const telefono = opcional(form.telefono)
  if (telefono && telefono.length > LIMITES.telefono) return { error: `El teléfono admite hasta ${LIMITES.telefono} caracteres.` }

  const direccion = opcional(form.direccion)
  if (direccion && direccion.length > LIMITES.direccion) return { error: `La dirección admite hasta ${LIMITES.direccion} caracteres.` }

  const url_logo = opcional(form.url_logo)
  if (url_logo && url_logo.length > LIMITES.url_logo) return { error: `La URL del logo admite hasta ${LIMITES.url_logo} caracteres.` }

  const textoPropina = String(form.propina_sugerida_pct ?? '').trim().replace(',', '.')
  if (textoPropina === '') return { error: 'La propina sugerida es obligatoria (pon 0 si no se sugiere).' }
  if (!/^\d+(\.\d{1,2})?$/.test(textoPropina)) return { error: 'La propina sugerida es un número con hasta 2 decimales.' }
  const propina_sugerida_pct = Number(textoPropina)
  if (propina_sugerida_pct > 30) return { error: 'La propina sugerida va de 0 a 30 %.' }

  const moneda = String(form.moneda ?? '').trim().toUpperCase()
  if (!MONEDA.test(moneda)) return { error: 'La moneda son 3 letras (código ISO, p. ej. COP o USD).' }

  const horario = {}
  for (const { clave, etiqueta } of DIAS) {
    const dia = form.horario?.[clave] || HORARIO_VACIO
    if (!dia.abierto) continue
    if (!HORA.test(dia.abre || '') || !HORA.test(dia.cierra || '')) {
      return { error: `${etiqueta}: pon la hora de apertura y de cierre (HH:MM).` }
    }
    if (dia.abre === dia.cierra) return { error: `${etiqueta}: la apertura y el cierre no pueden ser la misma hora.` }
    horario[clave] = { abre: dia.abre, cierra: dia.cierra }
  }

  return { datos: { nombre, telefono, direccion, url_logo, horario, propina_sugerida_pct, moneda } }
}

/** El horario en un orden fijo, para comparar sin depender del orden de las claves. */
function horarioCanonico(horario) {
  const h = horario && typeof horario === 'object' ? horario : {}
  return JSON.stringify(DIAS.filter(({ clave }) => h[clave]).map(({ clave }) => [clave, h[clave].abre, h[clave].cierra]))
}

/**
 * Solo los campos que cambiaron respecto a la fila cargada: es lo que va en el
 * PUT. Así guardar el teléfono no reescribe el horario con lo que había en
 * pantalla (si otro admin lo cambió mientras tanto, se respeta).
 */
export function cambiosDeConfig(original = {}, datos) {
  const cambios = {}
  for (const campo of CAMPOS_EDITABLES) {
    if (campo === 'horario') {
      if (horarioCanonico(original.horario) !== horarioCanonico(datos.horario)) cambios.horario = datos.horario
    } else if (campo === 'propina_sugerida_pct') {
      if (Number(original.propina_sugerida_pct) !== datos.propina_sugerida_pct) cambios[campo] = datos[campo]
    } else if ((original[campo] ?? null) !== datos[campo]) {
      cambios[campo] = datos[campo]
    }
  }
  return cambios
}

/** Un horario que cierra "antes" de abrir cruza la medianoche (p. ej. 18:00–02:00). */
export function cruzaMedianoche(dia) {
  return Boolean(dia?.abierto && HORA.test(dia.abre || '') && HORA.test(dia.cierra || '') && dia.cierra < dia.abre)
}

/** "8 nov 2026, 14:05" en la zona del navegador, o null si no hay fecha. */
export function fechaLegible(iso) {
  if (!iso) return null
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  return fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
