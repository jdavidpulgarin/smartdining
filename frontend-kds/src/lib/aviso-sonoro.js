/**
 * Aviso sonoro de comanda nueva, con Web Audio.
 *
 * Sin archivos de audio: son dos tonos cortos generados en el momento. Así no
 * hay que servir un mp3, no depende de la red y suena igual en cualquier
 * navegador moderno.
 *
 * Los navegadores no dejan sonar nada hasta que el usuario interactúa con la
 * página (política de autoplay). Por eso el AudioContext se crea en el primer
 * gesto —el botón "Activar sonido"— y no al cargar; si se creara antes, nacería
 * suspendido y el primer aviso se perdería en silencio.
 */

let contexto = null

/** Crea o reanuda el AudioContext. Hay que llamarlo DESDE un gesto del usuario. */
export async function prepararSonido() {
  try {
    const Constructor = window.AudioContext || window.webkitAudioContext
    if (!Constructor) return false

    if (!contexto) contexto = new Constructor()
    if (contexto.state === 'suspended') await contexto.resume()
    return contexto.state === 'running'
  } catch {
    // Audio no disponible: el KDS sigue funcionando, solo sin aviso sonoro.
    return false
  }
}

/** Suelta el contexto (al salir de la sesión). */
export function cerrarSonido() {
  try {
    contexto?.close()
  } catch {
    // Da igual si ya estaba cerrado.
  }
  contexto = null
}

/**
 * Dos pitidos cortos y agudos: se oyen por encima del ruido de una cocina sin
 * ser una alarma. Si el contexto no está listo, no hace nada (y no lanza).
 */
export function sonarAvisoDeComanda() {
  if (!contexto || contexto.state !== 'running') return false

  try {
    const ahora = contexto.currentTime
    for (const [indice, frecuencia] of [880, 1175].entries()) {
      const oscilador = contexto.createOscillator()
      const volumen = contexto.createGain()

      oscilador.type = 'sine'
      oscilador.frequency.value = frecuencia

      const inicio = ahora + indice * 0.18
      const fin = inicio + 0.14

      // Rampa de volumen en vez de encender y apagar en seco: un corte brusco
      // suena a chasquido.
      volumen.gain.setValueAtTime(0.0001, inicio)
      volumen.gain.exponentialRampToValueAtTime(0.3, inicio + 0.02)
      volumen.gain.exponentialRampToValueAtTime(0.0001, fin)

      oscilador.connect(volumen).connect(contexto.destination)
      oscilador.start(inicio)
      oscilador.stop(fin + 0.02)
    }
    return true
  } catch {
    return false
  }
}

/** Solo para pruebas y para el indicador de la interfaz. */
export function sonidoListo() {
  return contexto?.state === 'running'
}
