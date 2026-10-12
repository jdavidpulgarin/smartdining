/**
 * Sintetiza un sonido de campana armónico elegante (Re5 -> La5) mediante Web Audio API
 */
export function emitirSonidoAlerta() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()

    const ahora = ctx.currentTime

    // Oscilador 1 (Tono principal)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(587.33, ahora) // Re5
    osc1.frequency.exponentialRampToValueAtTime(880.0, ahora + 0.15) // La5

    gain1.gain.setValueAtTime(0.2, ahora)
    gain1.gain.exponentialRampToValueAtTime(0.001, ahora + 0.4)

    osc1.connect(gain1)
    gain1.connect(ctx.destination)

    osc1.start(ahora)
    osc1.stop(ahora + 0.4)

    // Oscilador 2 (Armónico complementario)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'triangle'
    osc2.frequency.setValueAtTime(1174.66, ahora + 0.08) // Re6
    gain2.gain.setValueAtTime(0.12, ahora + 0.08)
    gain2.gain.exponentialRampToValueAtTime(0.001, ahora + 0.45)

    osc2.connect(gain2)
    gain2.connect(ctx.destination)

    osc2.start(ahora + 0.08)
    osc2.stop(ahora + 0.45)
  } catch {
    // Si el navegador bloquea audio antes de interacción del usuario, se ignora silenciosamente
  }
}
