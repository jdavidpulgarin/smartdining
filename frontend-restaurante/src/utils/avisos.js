/**
 * La mesa de un aviso del socket (id_mesa o mesa), o null si no viene o no es
 * un entero > 0. Antes un aviso sin mesa caía en la Mesa 1 (`|| 1`) y se
 * mandaba al mesero a la mesa equivocada.
 */
export function mesaDelAviso(data) {
  const n = Number(data?.id_mesa ?? data?.mesa)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Aviso de mesa:atendida con PAYLOAD_INVALIDO o NO_AUTORIZADO. Nombra la mesa
 * por su NÚMERO (el numeroMesa de la alerta), no por su id_mesa.
 */
export function avisoAtendidaSoloAqui(numeroMesa) {
  return numeroMesa !== undefined && numeroMesa !== null && numeroMesa !== ''
    ? `No se pudo avisar a la Mesa ${numeroMesa}; la alerta se quitó solo en esta pantalla`
    : 'No se pudo avisar a la mesa; la alerta se quitó solo en esta pantalla'
}
