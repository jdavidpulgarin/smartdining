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

/** Métodos con datáfono: los únicos que llevan voucher (script 35). */
export const METODOS_CON_VOUCHER = ['tarjeta_debito', 'tarjeta_credito']

/** Largo máximo del voucher: transacciones.voucher VARCHAR(40). */
export const VOUCHER_MAX = 40

/** El mismo formato del CHECK ck_transacciones_voucher y del backend. */
const FORMATO_VOUCHER = /^[A-Z0-9-]{1,40}$/

export function usaVoucher(metodo) {
  return METODOS_CON_VOUCHER.includes(metodo)
}

/** Lo que escribe el cajero → como lo guarda el backend: sin espacios en los extremos y en mayúsculas. */
export function normalizarVoucher(texto) {
  return typeof texto === 'string' ? texto.trim().toUpperCase() : ''
}

/**
 * El voucher que va en el cobro: `{ voucher }` (null si no va) o `{ error }`.
 * Solo con tarjeta: con efectivo o transferencia nunca se manda, aunque el
 * campo tenga algo escrito de antes (el backend respondería 400
 * voucher_no_aplica). Vacío = sin voucher. El formato es el del contrato, para
 * avisar antes de enviar; el backend lo vuelve a comprobar.
 */
export function voucherDelCobro(metodo, texto) {
  if (!usaVoucher(metodo)) return { voucher: null }
  const voucher = normalizarVoucher(texto)
  if (voucher === '') return { voucher: null }
  if (!FORMATO_VOUCHER.test(voucher)) {
    return { error: `El voucher solo admite letras, números y guiones, hasta ${VOUCHER_MAX} caracteres.` }
  }
  return { voucher }
}

/**
 * Lo que identifica UN cobro. Mientras no cambie, un reintento (doble clic,
 * error de red) reutiliza el mismo id_cobro; si cambia la mesa, la persona, el
 * monto o el método, es otro cobro y lleva un id nuevo.
 *
 * El voucher NO entra: corregirlo tras un error de red sigue siendo el MISMO
 * cobro y no puede cobrar dos veces. Si el primer envío sí había entrado, el
 * backend responde duplicado y conserva el voucher de ese primer envío.
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

/**
 * Filas de GET /transacciones?desde=hoy → una fila por COBRO para el Historial.
 *
 * Un cobro de mesa repartido entre varios pedidos son varias filas con el mismo
 * `referencia_pago` (`caja:<id_cobro>`, o la referencia de Wompi): se juntan en
 * una, con la suma de sus montos y todos sus id. Una fila sin referencia es un
 * cobro por sí sola. Lo más reciente primero, como lo devuelve el backend.
 * Los montos se suman en centavos para no arrastrar coma flotante. El voucher
 * (script 35) es el mismo en todas las filas de un cobro: sale una vez.
 */
export function agruparCobros(transacciones = []) {
  const grupos = new Map()
  for (const t of transacciones) {
    const clave = t.referencia_pago ? `ref:${t.referencia_pago}` : `tx:${t.id_transaccion}`
    const g = grupos.get(clave)
    const centavos = Math.round(Number(t.monto) * 100) || 0
    if (!g) {
      grupos.set(clave, {
        clave,
        ids: [t.id_transaccion],
        numero_mesa: t.numero_mesa,
        // P-24: un cobro de domicilio no tiene mesa (numero_mesa null): se nombra
        // por su canal y su pedido (ver ubicacionPedido en utils/domicilios).
        canal: t.canal || 'mesa',
        id_pedido: t.id_pedido ?? null,
        comensal: t.comensal ?? null,
        metodo_pago: t.metodo_pago,
        voucher: t.voucher ?? null,
        centavos,
        fecha: t.fecha,
      })
    } else {
      g.ids.push(t.id_transaccion)
      g.centavos += centavos
      if (!g.voucher && t.voucher) g.voucher = t.voucher
      if (t.fecha > g.fecha) g.fecha = t.fecha
    }
  }
  return [...grupos.values()]
    .map(({ centavos, ids, ...g }) => ({ ...g, ids: [...ids].sort((a, b) => a - b), monto: centavos / 100 }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
}

/** "15:11" en hora de Bogotá (la del restaurante), venga de donde venga el navegador. */
export function horaBogota(iso) {
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return ''
  return f.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' })
}

/**
 * ¿Hay que descartar el id_cobro pendiente tras este error? Solo con
 * `id_cobro_en_uso` (409): ese id ya pertenece a un cobro de OTRA mesa y
 * repetirlo daría el mismo 409 para siempre. En cualquier otro error se
 * conserva, para que un reintento del MISMO cobro no cobre dos veces.
 */
export function descartarIdCobro(err) {
  return err?.motivo === 'id_cobro_en_uso'
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
    case 'id_cobro_en_uso':
      return 'No se cobró: ese número de cobro ya se usó en otra mesa. Se generó uno nuevo; pulsa COBRAR otra vez.'
    case 'mesa_inexistente':
      return 'La mesa ya no existe.'
    case 'autor_inexistente':
      return 'Tu usuario ya no existe; vuelve a iniciar sesión.'
    case 'voucher_invalido':
      return `No se cobró: el voucher solo admite letras, números y guiones, hasta ${VOUCHER_MAX} caracteres.`
    case 'voucher_no_aplica':
      return 'No se cobró: el voucher solo va con tarjeta débito o crédito.'
    case 'cuerpo_invalido':
      return `No se pudo cobrar: ${err.message}`
    default:
      return `No se pudo registrar el cobro: ${err?.message || 'error desconocido'}`
  }
}
