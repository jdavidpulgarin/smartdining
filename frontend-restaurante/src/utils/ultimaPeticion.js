/**
 * Solo cuenta la ÚLTIMA petición (T4).
 *
 * Varias recargas seguidas (item:cancelado, order:status, payment:confirmed,
 * reconectar...) salen en paralelo y pueden responder en otro orden: una
 * respuesta vieja que llega tarde pisaría el saldo nuevo. Cada recarga pide un
 * turno con `nueva()` y, al volver, solo aplica lo que trae si su turno sigue
 * vigente. `invalidar()` descarta las que estén en vuelo (al desmontar).
 *
 * @returns {{ nueva: () => { vigente: () => boolean }, invalidar: () => void }}
 */
export function crearUltimaPeticion() {
  let actual = 0
  return {
    nueva() {
      actual += 1
      const turno = actual
      return { vigente: () => turno === actual }
    },
    invalidar() {
      actual += 1
    },
  }
}
