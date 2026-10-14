import { useEffect, useState } from 'react'

/**
 * Reloj compartido del tablero.
 *
 * UN SOLO intervalo para toda la pantalla, no uno por tarjeta: en hora punta
 * puede haber veinte comandas, y veinte intervalos de un segundo son veinte
 * timers y veinte renders sueltos por segundo. Aquí hay un timer y un único
 * valor del que todas las tarjetas se cuelgan.
 *
 * El intervalo se crea con el primer suscriptor y se destruye con el último, de
 * modo que el login (que no muestra tarjetas) no deja nada corriendo.
 */

const INTERVALO_MS = 1000

let intervalo = null
const suscriptores = new Set()
let ahora = Date.now()

function latir() {
  ahora = Date.now()
  for (const avisar of suscriptores) avisar(ahora)
}

function suscribir(avisar) {
  suscriptores.add(avisar)
  if (!intervalo) {
    // unref no existe en el navegador; en Node (pruebas) tampoco hace falta
    // porque nadie monta el hook ahí.
    intervalo = setInterval(latir, INTERVALO_MS)
  }
  return () => {
    suscriptores.delete(avisar)
    if (suscriptores.size === 0 && intervalo) {
      clearInterval(intervalo)
      intervalo = null
    }
  }
}

/**
 * Devuelve el "ahora" compartido, que avanza cada segundo.
 *
 * Las tarjetas lo usan para recalcular sus minutos sin pedirle nada al
 * servidor: el servidor ya dijo cuándo se creó la comanda.
 */
export function useCronometro() {
  const [valor, setValor] = useState(() => ahora)

  useEffect(() => suscribir(setValor), [])

  return valor
}

/** Solo para pruebas: cuántos suscriptores hay y si el timer está vivo. */
export function estadoDelReloj() {
  return { suscriptores: suscriptores.size, activo: intervalo !== null }
}
