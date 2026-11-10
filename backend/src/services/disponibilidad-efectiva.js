/**
 * La disponibilidad EFECTIVA de un plato o de una opción (ISSUE #136).
 *
 * En la base hay dos columnas y la que importa es su AND:
 *
 *   - `disponible`: el **interruptor manual** de la cocina (D-05). Lo mueve
 *     `PATCH /platos/:id/disponible` y su gemelo de ingredientes.
 *   - `stock_suficiente`: lo **calcula la base** desde el stock de la receta
 *     (P-19, `database/scripts/27_inventario.sql`). El backend nunca lo escribe.
 *
 * Lo que ve el comensal, y lo que la vista `v_carta_disponible` publica como
 * `disponible_efectivo`, es `disponible AND stock_suficiente`.
 *
 * EL FALLO QUE ARREGLA: el aviso del PATCH manual mandaba `plato.disponible`, o
 * sea solo el interruptor. Si la cocina encendía a mano un plato sin stock,
 * todos los sockets recibían `plato:disponibilidad { disponible: true }`, la PWA
 * y el KDS lo mostraban disponible, y pedirlo daba 409 `sin_stock`. El oyente
 * del canal `inventario` ya mandaba el efectivo, así que los dos caminos se
 * contradecían: el último aviso en llegar decidía lo que veía la mesa.
 *
 * Esta función es el único sitio donde se hace esa cuenta, para que los tres
 * caminos (PATCH manual, oyente del canal y emisión del arranque) no puedan
 * discrepar otra vez.
 */

/**
 * @param {{disponible?: boolean, stock_suficiente?: boolean}} fila La fila de
 *   `platos` o de `ingredientes`, tal como la devuelve el RETURNING.
 * @returns {boolean}
 */
function disponibilidadEfectiva(fila) {
  if (!fila) return false;

  // `stock_suficiente` ausente o null se trata como TRUE a propósito: es el
  // DEFAULT de la columna (`NOT NULL DEFAULT TRUE`) y el valor correcto para un
  // plato sin receta, que no controla inventario. Si algún día una consulta deja
  // de traer la columna, el comportamiento vuelve a ser el de antes de P-19 (el
  // interruptor manual manda) en vez de apagar la carta entera.
  const conStock = fila.stock_suficiente === undefined || fila.stock_suficiente === null
    ? true
    : fila.stock_suficiente === true;

  return fila.disponible === true && conStock;
}

module.exports = { disponibilidadEfectiva };
