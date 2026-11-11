/**
 * Reglas de la Caja (cobro de MESA): POST /api/transacciones/mesa.
 *
 * Contrato: backend/docs/api-spec.md, "POST /transacciones/mesa — cobro de mesa
 * en caja". La caja cobra un monto a la mesa y el backend lo reparte entre sus
 * pedidos, del más viejo al más nuevo. `id_cobro` (UUID) hace seguro el
 * reintento: con el mismo id_cobro el backend no cobra dos veces y responde
 * 200 { duplicado: true }.
 */

/** Roles que ven y usan la Caja. El backend exige lo mismo (403 al resto). */
export const ROLES_CAJA = ['admin', 'cajero']

export function puedeUsarCaja(rol) {
  return ROLES_CAJA.includes(rol)
}

/**
 * UUID v4. `crypto.randomUUID` solo existe en contextos seguros (https o
 * localhost): en la demo por la red local (http://192.168.x.x) no está, así que
 * se arma con `crypto.getRandomValues`, que sí está en cualquier contexto.
 */
export function nuevoIdCobro(cripto = globalThis.crypto) {
  if (cripto && typeof cripto.randomUUID === 'function') return cripto.randomUUID()
  const b = new Uint8Array(16)
  cripto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40 // versión 4
  b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Selección de la cuenta → `comensal` del cuerpo: null para toda la mesa y para "General". */
export function comensalDelCobro(seleccion) {
  if (!seleccion || seleccion === 'TOTAL' || seleccion === 'General') return null
  return seleccion
}

/**
 * Lo que identifica UN cobro. Mientras no cambie, un reintento (doble clic,
 * error de red) reutiliza el mismo id_cobro; si cambia la mesa, la persona, el
 * monto o el método, es otro cobro y lleva un id nuevo.
 */
export function claveDeCobro({ id_mesa, comensal, monto, metodo_pago }) {
  return JSON.stringify([id_mesa, comensal ?? null, Number(monto), metodo_pago])
}

/**
 * El id_cobro para este envío: el del intento anterior si es el mismo cobro
 * (`pendiente` aún sin confirmar), o uno nuevo. Devuelve { clave, id_cobro },
 * que es lo que se guarda como pendiente hasta que el backend responda 201/200.
 */
export function idCobroParaEnviar(pendiente, datos, generar = nuevoIdCobro) {
  const clave = claveDeCobro(datos)
  if (pendiente && pendiente.clave === clave) return pendiente
  return { clave, id_cobro: generar() }
}

/** El error del cobro en palabras del cajero, según el `motivo` del contrato. */
export function mensajeDeErrorCobro(err, formatear = (n) => String(n)) {
  if (err?.sinConexion) {
    return 'Sin conexión con el servidor: no se sabe si el cobro entró. Vuelve a pulsar COBRAR; con el mismo cobro no se cobra dos veces.'
  }
  switch (err?.motivo) {
    case 'excede':
      return `El monto supera lo que debe la mesa${err.data?.saldo !== undefined ? ` (saldo actual ${formatear(err.data.saldo)})` : ''}. Actualiza las cuentas: alguien pudo pagar mientras tanto.`
    case 'sin_cuenta':
      return 'Esta mesa ya no tiene nada por cobrar. Actualiza las cuentas.'
    case 'mesa_inexistente':
      return 'La mesa ya no existe.'
    case 'autor_inexistente':
      return 'Tu usuario ya no existe; vuelve a iniciar sesión.'
    case 'cuerpo_invalido':
      return `No se pudo cobrar: ${err.message}`
    default:
      return `No se pudo registrar el cobro: ${err?.message || 'error desconocido'}`
  }
}
