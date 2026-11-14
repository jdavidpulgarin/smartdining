/**
 * La mesa de un aviso del socket (id_mesa o mesa), o null si no viene o no es
 * un entero > 0. Antes un aviso sin mesa caía en la Mesa 1 (`|| 1`) y se
 * mandaba al mesero a la mesa equivocada.
 */
export function mesaDelAviso(data) {
  const n = Number(data?.id_mesa ?? data?.mesa)
  return Number.isInteger(n) && n > 0 ? n : null
}
