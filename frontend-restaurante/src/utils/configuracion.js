/**
 * Reglas de la pantalla de Configuración (P-21), fuera de los componentes para
 * poder probarlas solas. Siguen el contrato de backend/docs/api-spec.md
 * (D-16 partes A y B): el backend valida igual; esto solo evita mandar algo que
 * se sabe que va a rechazar y da un mensaje claro antes.
 */

/** Roles del personal: los del CHECK de `usuarios.rol`. */
export const ROLES = [
  { valor: 'admin', etiqueta: 'Administrador' },
  { valor: 'mesero', etiqueta: 'Mesero' },
  { valor: 'cajero', etiqueta: 'Cajero' },
  { valor: 'cocina', etiqueta: 'Cocina' },
]

export function etiquetaDeRol(rol) {
  return ROLES.find((r) => r.valor === rol)?.etiqueta || rol
}

const UBICACION_MAX = 50
const CLAVE_MIN = 8
const CLAVE_MAX_BYTES = 72

function enteroPositivo(valor) {
  const n = Number(valor)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** GET /mesas → lista ordenada por número. */
export function ordenarMesas(data) {
  const lista = Array.isArray(data) ? data : data?.mesas || []
  return [...lista].sort((a, b) => Number(a.numero) - Number(b.numero))
}

/**
 * Formulario de mesa (texto de los inputs) → { datos } o { error }.
 * `numero` y `capacidad` enteros positivos; `ubicacion` no vacía y ≤ 50.
 */
export function validarMesa(form) {
  const numero = enteroPositivo(form.numero)
  if (!numero) return { error: 'El número de mesa debe ser un entero mayor que 0.' }
  const capacidad = enteroPositivo(form.capacidad)
  if (!capacidad) return { error: 'La capacidad debe ser un entero mayor que 0.' }
  const ubicacion = String(form.ubicacion ?? '').trim()
  if (!ubicacion) return { error: 'Escribe la ubicación (por ejemplo, Terraza).' }
  if (ubicacion.length > UBICACION_MAX) return { error: `La ubicación admite hasta ${UBICACION_MAX} caracteres.` }
  return { datos: { numero, capacidad, ubicacion } }
}

/**
 * Solo lo que cambió respecto a la mesa guardada. PATCH /mesas/:id es
 * .strict() y lo que no viene no se toca, así que mandar de más no aporta y
 * un cuerpo vacío sería un 400: si no cambió nada, devuelve {}.
 */
export function cambiosDeMesa(mesa, datos) {
  const cambios = {}
  if (datos.numero !== Number(mesa.numero)) cambios.numero = datos.numero
  if (datos.capacidad !== Number(mesa.capacidad)) cambios.capacidad = datos.capacidad
  if (datos.ubicacion !== (mesa.ubicacion || '')) cambios.ubicacion = datos.ubicacion
  return cambios
}

/**
 * Mismas reglas que POST /usuarios/:id/clave: mínimo 8 caracteres y máximo 72
 * BYTES (bcrypt corta en silencio a partir del byte 72, y una tilde ocupa dos).
 * Se aplican también al alta, que en el backend pide solo 6 y no tiene máximo.
 * Devuelve el mensaje de error, o null si la clave sirve.
 */
export function errorDeClave(clave) {
  if ([...String(clave)].length < CLAVE_MIN) return `La clave debe tener al menos ${CLAVE_MIN} caracteres.`
  if (new TextEncoder().encode(String(clave)).length > CLAVE_MAX_BYTES) {
    return 'La clave es demasiado larga (máximo 72 bytes; las tildes y la ñ cuentan doble).'
  }
  return null
}

/** Alta de personal → { datos } o { error }. Mismas reglas que POST /auth/register, más la de la clave. */
export function validarNuevoUsuario(form) {
  const nombre = String(form.nombre ?? '').trim()
  const email = String(form.email ?? '').trim()
  if (nombre.length < 2) return { error: 'El nombre debe tener al menos 2 caracteres.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Escribe un email válido.' }
  const errClave = errorDeClave(form.password ?? '')
  if (errClave) return { error: errClave }
  if (!ROLES.some((r) => r.valor === form.rol)) return { error: 'Elige un rol.' }
  return { datos: { nombre, email, password: form.password, rol: form.rol } }
}

/** Mensaje para una lista que no se pudo cargar (sin red o error del servidor). */
export function mensajeDeCarga(err, porDefecto) {
  return err?.sinConexion ? 'Sin conexión con el servidor' : err?.message || porDefecto
}
