/**
 * Disponibilidad de un plato en el Menú del panel (T8).
 *
 * Dos cosas distintas deciden si el comensal puede pedirlo:
 *   - `available`: el interruptor MANUAL (platos.disponible), que solo cambia el
 *     admin desde el panel (o la cocina).
 *   - `stockOk`: lo que calcula la base desde el inventario (stock_suficiente).
 *
 * Por eso la etiqueta dice la causa: apagado a mano es «NO DISPONIBLE» (vuelve
 * cuando alguien lo activa) y sin stock es «AGOTADO · SIN STOCK» (vuelve solo
 * con una entrada de inventario). Antes las dos decían «AGOTADO».
 */
export const DISPONIBLE = 'disponible'
export const SIN_STOCK = 'sin_stock'
export const NO_DISPONIBLE = 'no_disponible'

export const ETIQUETA_DISPONIBILIDAD = Object.freeze({
  [DISPONIBLE]: 'DISPONIBLE',
  [SIN_STOCK]: 'AGOTADO · SIN STOCK',
  [NO_DISPONIBLE]: 'NO DISPONIBLE',
})

/** Estado de un plato del Menú: manda el interruptor manual, después el stock. */
export function estadoDisponibilidad(plato = {}) {
  if (plato.available === false) return NO_DISPONIBLE
  if (plato.stockOk === false) return SIN_STOCK
  return DISPONIBLE
}

/**
 * Texto de la confirmación al cambiar el interruptor, o null si no hace falta.
 * Solo se pide al DESACTIVAR (los comensales dejan de poder pedirlo); activar
 * no se confirma.
 */
export function confirmacionAlCambiar(plato = {}, nuevoDisponible) {
  if (nuevoDisponible !== false) return null
  const nombre = plato.name ? `«${plato.name}»` : 'este plato'
  return `¿Marcar ${nombre} como NO DISPONIBLE? Los comensales no podrán pedirlo hasta que lo vuelvas a activar.`
}
