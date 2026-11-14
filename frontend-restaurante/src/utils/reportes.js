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

/**
 * Barras de «Ventas por día» (T6) desde `ventasPorDia` de GET /reportes:
 * `[{ fecha: 'AAAA-MM-DD', total, pedidos }]`, un día por cada día del rango en
 * hora de Bogotá y los días sin ventas en 0 (contrato confirmado por Daniel).
 *
 * La fecha se lee por sus partes y NO con `new Date('AAAA-MM-DD')`, que la toma
 * como medianoche UTC y en Colombia la pinta como el día anterior.
 *
 * @returns {null | Array<{ fecha, total, pedidos, altura, etiqueta, titulo }>}
 *          null si el backend todavía no manda el campo (no se inventan barras).
 */
export function barrasVentasPorDia(ventasPorDia) {
  if (!Array.isArray(ventasPorDia)) return null
  const filas = ventasPorDia
    .filter((d) => typeof d?.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.fecha))
    .map((d) => ({ fecha: d.fecha, total: Number(d.total) || 0, pedidos: Number(d.pedidos) || 0 }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
  const max = Math.max(0, ...filas.map((f) => f.total))
  return filas.map((f) => {
    const [y, m, d] = f.fecha.split('-').map(Number)
    const dia = new Date(y, m - 1, d)
    const etiqueta = dia.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })
    return {
      ...f,
      // Porcentaje de la barra más alta; un día con ventas nunca baja de 2 % (que se vea).
      altura: max > 0 ? (f.total > 0 ? Math.max(2, Math.round((f.total / max) * 100)) : 0) : 0,
      etiqueta,
      titulo: dia.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }),
    }
  })
}
