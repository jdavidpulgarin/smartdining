/**
 * Reportes del panel (T6): la gráfica de métodos de pago.
 *
 * Cada método tiene SU color, fijo (no por posición): antes el 3.º, el 4.º y
 * los siguientes salían todos del mismo gris y no se distinguían, y un método
 * cambiaba de color según el día. Las etiquetas las pone el backend
 * (reportes.service.js: Efectivo, Tarjeta, Transferencia, Online).
 */
export const COLOR_METODO = Object.freeze({
  Efectivo: '#FFFFFF',
  Tarjeta: 'var(--sd-gold)',
  Online: 'var(--sd-red-text)',
  Transferencia: 'var(--sd-text-muted)',
})
export const COLOR_OTRO_METODO = 'var(--sd-border-strong)'

const aCentavos = (n) => Math.round((Number(n) || 0) * 100)

/**
 * Filas de la gráfica (con su color) y el total cobrado por métodos.
 * Suma en centavos enteros para no arrastrar decimales de coma flotante.
 *
 * @param {Array<{metodo: string, monto: number, porcentaje: number}>} metodos
 * @returns {{ filas: Array<{metodo, monto, porcentaje, color}>, total: number }}
 */
export function resumirMetodos(metodos = []) {
  const filas = (Array.isArray(metodos) ? metodos : []).map((m) => ({
    metodo: m.metodo,
    monto: Number(m.monto) || 0,
    porcentaje: Number(m.porcentaje) || 0,
    color: COLOR_METODO[m.metodo] || COLOR_OTRO_METODO,
  }))
  const total = filas.reduce((acc, f) => acc + aCentavos(f.monto), 0) / 100
  return { filas, total }
}

/**
 * ¿La suma por métodos cuadra con «Recaudado hoy» de la Caja
 * (GET /transacciones?desde=hoy → total)? Solo tiene sentido en el rango «hoy».
 *
 * @returns {{ estado: 'cuadra'|'no_cuadra'|'sin_dato', diferencia: number }}
 */
export function cuadreConCaja(totalMetodos, recaudadoHoy) {
  if (recaudadoHoy === null || recaudadoHoy === undefined || !Number.isFinite(Number(recaudadoHoy))) {
    return { estado: 'sin_dato', diferencia: 0 }
  }
  const diferencia = (aCentavos(totalMetodos) - aCentavos(recaudadoHoy)) / 100
  return { estado: diferencia === 0 ? 'cuadra' : 'no_cuadra', diferencia }
}
