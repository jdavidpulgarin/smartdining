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

/**
 * Los campos que el PUT acepta. Ni uno más (el cuerpo es `.strict()`).
 *
 * `correo` y `redes` son del script 29 (P-21). Mientras el backend no los
 * acepte en el PUT, mandarlos da 400; por eso, igual que el resto, solo viajan
 * si cambiaron: con los dos vacíos, guardar lo demás sigue funcionando.
 */
export const CAMPOS_EDITABLES = ['nombre', 'telefono', 'correo', 'direccion', 'url_logo', 'redes', 'horario', 'propina_sugerida_pct', 'moneda']

/** Largos máximos: los de las columnas de `configuracion_restaurante`. */
export const LIMITES = { nombre: 120, telefono: 30, correo: 254, direccion: 200, url_logo: 255, red: 200 }

/**
 * Las redes del local (script 29, `fn_redes_contacto_validas`), en el orden en
 * que se muestran. Las reglas son las mismas que el CHECK de la base: las tres
 * primeras, un enlace https de su dominio; WhatsApp, el número en E.164.
 */
export const REDES = [
  {
    clave: 'instagram',
    etiqueta: 'INSTAGRAM',
    ejemplo: 'https://instagram.com/smartdining',
    patron: /^https:\/\/([a-z0-9-]+\.)?instagram\.com\/\S+$/i,
    error: 'Instagram: pega el enlace completo del perfil (https://instagram.com/…).',
  },
  {
    clave: 'facebook',
    etiqueta: 'FACEBOOK',
    ejemplo: 'https://facebook.com/smartdining',
    patron: /^https:\/\/([a-z0-9-]+\.)?(facebook|fb)\.com\/\S+$/i,
    error: 'Facebook: pega el enlace completo de la página (https://facebook.com/…).',
  },
  {
    clave: 'tiktok',
    etiqueta: 'TIKTOK',
    ejemplo: 'https://tiktok.com/@smartdining',
    patron: /^https:\/\/([a-z0-9-]+\.)?tiktok\.com\/\S+$/i,
    error: 'TikTok: pega el enlace completo del perfil (https://tiktok.com/@…).',
  },
  {
    clave: 'whatsapp',
    etiqueta: 'WHATSAPP',
    ejemplo: '+57 300 123 4567',
    patron: /^\+[1-9]\d{6,14}$/,
    error: 'WhatsApp: escribe el número con el indicativo del país, p. ej. +57 300 123 4567.',
  },
]

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const MONEDA = /^[A-Z]{3}$/
/** El mismo CHECK que `ck_configuracion_correo`: algo@algo.algo, sin espacios ni dos arrobas. */
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/
const HORARIO_VACIO = { abierto: false, abre: '', cierra: '' }

/** `redes` de la fila → objeto con las cuatro claves en texto ('' = sin esa red). */
function redesDelForm(redes) {
  const r = redes && typeof redes === 'object' && !Array.isArray(redes) ? redes : {}
  return Object.fromEntries(REDES.map(({ clave }) => [clave, typeof r[clave] === 'string' ? r[clave] : '']))
}

/**
 * El número de WhatsApp como lo guarda la base: sin espacios, guiones, puntos
 * ni paréntesis ("+57 300-123 4567" → "+573001234567").
 */
export function normalizarWhatsapp(texto) {
  return String(texto ?? '').replace(/[\s().-]/g, '')
}

/**
 * Fila de GET /configuracion/completa → estado del formulario (todo texto, como
 * los inputs). Un día que no está en `horario` sale cerrado.
 */
export function formDesdeConfig(config = {}) {
  const horario = config.horario && typeof config.horario === 'object' && !Array.isArray(config.horario) ? config.horario : {}
  return {
    nombre: config.nombre ?? '',
    telefono: config.telefono ?? '',
    correo: config.correo ?? '',
    direccion: config.direccion ?? '',
    url_logo: config.url_logo ?? '',
    redes: redesDelForm(config.redes),
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
 * Formulario → { datos } con los 9 campos ya en el tipo del contrato, o
 * { error } con el primer problema, en el orden en que se ven en pantalla.
 */
export function validarConfig(form) {
  const nombre = String(form.nombre ?? '').trim()
  if (!nombre) return { error: 'El nombre del restaurante es obligatorio.' }
  if (nombre.length > LIMITES.nombre) return { error: `El nombre admite hasta ${LIMITES.nombre} caracteres.` }

  const telefono = opcional(form.telefono)
  if (telefono && telefono.length > LIMITES.telefono) return { error: `El teléfono admite hasta ${LIMITES.telefono} caracteres.` }

  const correo = opcional(form.correo)
  if (correo && correo.length > LIMITES.correo) return { error: `El correo admite hasta ${LIMITES.correo} caracteres.` }
  if (correo && !CORREO.test(correo)) return { error: 'El correo no tiene la forma nombre@dominio.com.' }

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

  // Una red vacía no viaja (la base no admite null ni ""): se omite la clave.
  const redes = {}
  for (const { clave, patron, error } of REDES) {
    const crudo = String(form.redes?.[clave] ?? '').trim()
    if (!crudo) continue
    const valor = clave === 'whatsapp' ? normalizarWhatsapp(crudo) : crudo
    if (valor.length > LIMITES.red || !patron.test(valor)) return { error }
    redes[clave] = valor
  }

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

  return { datos: { nombre, telefono, correo, direccion, url_logo, redes, horario, propina_sugerida_pct, moneda } }
}

/** Las redes en un orden fijo, para comparar sin depender del orden de las claves. */
function redesCanonicas(redes) {
  const r = redes && typeof redes === 'object' && !Array.isArray(redes) ? redes : {}
  return JSON.stringify(REDES.filter(({ clave }) => r[clave]).map(({ clave }) => [clave, r[clave]]))
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
    } else if (campo === 'redes') {
      // Una fila sin `redes` (backend aún sin el script 29) cuenta como '{}'.
      if (redesCanonicas(original.redes) !== redesCanonicas(datos.redes)) cambios.redes = datos.redes
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
