/**
 * La columna LISTAS: el pase, donde la comanda espera a que el mesero la
 * recoja.
 *
 * Aquí el tiempo que importa NO es el total desde que se pidió, sino cuánto
 * lleva **hecha y sin recoger**: eso es lo que el mesero puede arreglar. Son
 * dos relojes distintos y conviene no confundirlos.
 *
 * Funciones puras; el "ahora" se pasa como argumento.
 */

import { TOPE_MINUTOS, textoDeEspera } from './espera.js'

/**
 * A partir de cuántos minutos en el pase se avisa de que nadie la ha recogido.
 *
 * Un único sitio para cambiarlo. 30 minutos es la frontera entre "el mesero
 * está en otra mesa" y "esto se olvidó": un plato caliente ya se arruinó, y
 * seguir mostrándolo como si acabara de salir engaña a la cocina.
 */
export const UMBRAL_SIN_RECOGER_MIN = 30

/**
 * Momento en que la comanda pasó a 'listo', en milisegundos, o null.
 *
 * Tres orígenes, por orden de fiabilidad:
 *  1. `listo_en` de la API, que sale de historial_estados (la última
 *     transición a 'listo'). Sobrevive a recargas y es la verdad de la base.
 *  2. `listoEnMs` que el propio KDS anotó al recibir el order:status (del
 *     `emitidoEn` del evento, o de su hora de llegada).
 *  3. Nada: una comanda que ya estaba en 'listo' antes de que existiera este
 *     dato. Se devuelve null y la tarjeta no inventa un tiempo en el pase.
 */
export function listoEnMs(comanda) {
  if (comanda?.listo_en) {
    const marca = Date.parse(comanda.listo_en)
    if (Number.isFinite(marca)) return marca
  }
  if (Number.isFinite(comanda?.listoEnMs)) return comanda.listoEnMs
  return null
}

/**
 * Minutos que lleva la comanda en el pase, o null si no se sabe cuándo pasó a
 * 'listo'. Null es información: significa "no puedo decirlo", y es mejor que
 * un 0 que parecería recién hecha.
 */
export function minutosEnPase(comanda, ahoraEnMs = Date.now()) {
  const marca = listoEnMs(comanda)
  if (marca === null) return null
  return Math.max(0, Math.floor((ahoraEnMs - marca) / 60000))
}

/** ¿Lleva demasiado en el pase sin que nadie la recoja? */
export function sinRecoger(comanda, ahoraEnMs = Date.now()) {
  const minutos = minutosEnPase(comanda, ahoraEnMs)
  return minutos !== null && minutos > UMBRAL_SIN_RECOGER_MIN
}

/**
 * Aviso para el mesero. Reutiliza el tope de formato del cronómetro, así que a
 * partir de 100 minutos dice "+99 min" en vez de una cifra enorme.
 */
export function textoSinRecoger(minutos) {
  return `Sin recoger hace ${textoDeEspera(minutos)}`
}

/**
 * Qué cifra muestra el reloj grande de la tarjeta.
 *
 * En el pase manda el tiempo **en el pase**: es el único que el mesero puede
 * cambiar, y es el que explica el aviso de debajo. Si no se sabe cuándo quedó
 * lista se cae al total, que es lo que había antes; mejor un dato real aunque
 * sea otro, que un 0 inventado.
 *
 * En Nuevas y En preparación no cambia nada: ahí el reloj es el total desde que
 * se pidió, que es lo que mide la espera del comensal.
 *
 * @returns {{minutos: number, enPase: boolean}}
 */
export function minutosDelReloj(comanda, minutosTotales, ahoraEnMs = Date.now()) {
  if (comanda?.estado !== 'listo') return { minutos: minutosTotales, enPase: false }

  const pase = minutosEnPase(comanda, ahoraEnMs)
  if (pase === null) return { minutos: minutosTotales, enPase: false }

  return { minutos: pase, enPase: true }
}

/**
 * Tooltip del reloj en el pase: conserva los dos tiempos, porque el total
 * sigue siendo útil para saber cuánto lleva esperando el comensal.
 */
export function tituloDelPase(minutosPase, minutosTotales) {
  if (minutosPase === null) return `Pedida hace ${textoDeEspera(minutosTotales)}`
  return `En el pase desde hace ${textoDeEspera(minutosPase)} · pedida hace ${textoDeEspera(minutosTotales)}`
}

/**
 * Aviso de "sin recoger" sin repetir la cifra que ya está arriba.
 *
 * Cuando el reloj grande ya muestra el tiempo en el pase, los dos números son
 * el mismo y escribirlo dos veces en la misma tarjeta solo hace dudar de si son
 * cosas distintas. Si por lo que sea difieren (reloj con el total porque no se
 * sabe la hora de listo), el aviso sí lleva su cifra.
 */
export function avisoSinRecoger(minutosPase, minutosDelRelojGrande) {
  if (minutosPase === null) return 'Sin recoger'
  if (textoDeEspera(minutosPase) === textoDeEspera(minutosDelRelojGrande)) return 'Sin recoger'
  return textoSinRecoger(minutosPase)
}

/**
 * Ordena el pase con la más reciente arriba.
 *
 * Al revés que las otras columnas: en Nuevas y En preparación lo urgente es lo
 * más viejo, pero el pase se lee para saber qué acaba de salir, y lo que lleva
 * ahí media hora ya va marcado como olvidado. Las comandas sin hora de 'listo'
 * caen al final, que es donde menos estorban.
 */
export function ordenarPase(comandas) {
  return [...comandas].sort((a, b) => {
    const ma = listoEnMs(a)
    const mb = listoEnMs(b)
    if (ma === null && mb === null) return 0
    if (ma === null) return 1
    if (mb === null) return -1
    return mb - ma
  })
}

export { TOPE_MINUTOS }
