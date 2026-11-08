/** Roles del personal: los del CHECK de `usuarios.rol` (D-16). */
export const ROLES = [
  { valor: 'admin', etiqueta: 'Administrador' },
  { valor: 'mesero', etiqueta: 'Mesero' },
  { valor: 'cajero', etiqueta: 'Cajero' },
  { valor: 'cocina', etiqueta: 'Cocina' },
]

const CLAVE_MIN = 8
const CLAVE_MAX_BYTES = 72

/**
 * Mismas reglas que POST /usuarios/:id/clave: mínimo 8 caracteres y máximo 72
 * BYTES (bcrypt corta en silencio a partir del byte 72, y una tilde ocupa dos).
 * Se aplican también al alta, que en el backend pide solo 6 y no tiene máximo.
 * Devuelve el mensaje de error, o null si la clave sirve.
 */
export function errorDeClave(clave) {
  if ([...clave].length < CLAVE_MIN) return `La clave debe tener al menos ${CLAVE_MIN} caracteres.`
  if (new TextEncoder().encode(clave).length > CLAVE_MAX_BYTES) {
    return 'La clave es demasiado larga (máximo 72 bytes; las tildes y la ñ cuentan doble).'
  }
  return null
}

/** Mensaje de carga para una lista que no se pudo leer. */
export function mensajeDeCarga(err, porDefecto) {
  return err?.sinConexion ? 'Sin conexión con el servidor' : err?.message || porDefecto
}
