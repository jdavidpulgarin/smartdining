/**
 * Tiempo de espera de una comanda: cuánto lleva y cuándo hay que preocuparse.
 *
 * Funciones puras, sin React ni Date.now() implícito: el "ahora" se pasa como
 * argumento para poder probar los umbrales sin esperar minutos reales.
 */

/**
 * Umbrales del semáforo, en minutos.
 *
 * Son el criterio de la cocina: por debajo de 10 la comanda va en tiempo, de 10
 * a 15 hay que apurarse y por encima de 15 ya se le debe una explicación al
 * comensal.
 */
export const UMBRAL_AMBAR = 10
export const UMBRAL_ROJO = 15

/**
 * Minuto a partir del cual no se muestra la cifra real.
 *
 * Los datos sembrados en la base traen comandas de hace semanas (19.000
 * minutos), y un número de cinco dígitos en la tarjeta no informa de nada y
 * rompe la columna. A partir de 100 se muestra "+99 min": lo que importa es que
 * lleva muchísimo, no cuánto exactamente.
 */
export const TOPE_MINUTOS = 100

/**
 * Nivel de urgencia por minutos de espera.
 *
 * @returns {'normal'|'ambar'|'rojo'}
 */
export function nivelDeEspera(minutos) {
  const m = Number(minutos)
  if (!Number.isFinite(m) || m < UMBRAL_AMBAR) return 'normal'
  if (m <= UMBRAL_ROJO) return 'ambar'
  return 'rojo'
}

/**
 * Texto del cronómetro.
 *
 * Simple a propósito: minutos hasta el tope y "+99 min" por encima. No se pasa
 * a horas porque en cocina una comanda de más de una hora ya es una anomalía, y
 * "+99 min" lo dice más claro que "1 h 41 min".
 */
export function textoDeEspera(minutos) {
  const m = Math.max(0, Math.floor(Number(minutos) || 0))
  if (m >= TOPE_MINUTOS) return '+99 min'
  return `${m} min`
}

/**
 * Etiqueta y señal del nivel, para no depender SOLO del color.
 *
 * Un monitor de cocina puede estar mal calibrado, y hay cocineros que no
 * distinguen rojo de ámbar: cada nivel lleva además un símbolo y un texto que
 * leen los lectores de pantalla.
 */
const SENALES = {
  normal: { signo: '•', etiqueta: 'En tiempo' },
  ambar: { signo: '!', etiqueta: 'Apurar' },
  rojo: { signo: '!!', etiqueta: 'Atrasada' },
  // Sin semáforo: ni color ni etiqueta, solo el tiempo.
  neutro: { signo: '', etiqueta: '' },
}

export function senalDeEspera(minutos) {
  const nivel = nivelDeEspera(minutos)
  return { nivel, ...SENALES[nivel] }
}

/**
 * El nombre de un nivel, sin pasar por unos minutos concretos.
 *
 * Existe para la leyenda de la barra de resumen, que nombra los tres niveles a
 * la vez y no tiene ninguna comanda delante. Antes los escribía a mano y por
 * eso la tarjeta pudo decir "Retrasada" mientras la leyenda decía "ATRASADA":
 * dos nombres para una sola cosa, en la misma pantalla.
 */
export function etiquetaDeNivel(nivel) {
  return SENALES[nivel]?.etiqueta ?? ''
}

/**
 * Estados en los que el semáforo dice algo útil.
 *
 * Solo mientras la comanda depende de la cocina. Una comanda 'listo' ya está
 * hecha: el reloj sigue corriendo porque está esperando al mesero, pero pintarla
 * de rojo y llamarla "Atrasada" culparía a la cocina de una demora que no es
 * suya, y además llenaría la columna de alarmas que nadie puede atender desde
 * ahí. En Listas se muestra el tiempo y nada más.
 */
export const ESTADOS_CON_SEMAFORO = ['recibido', 'en_preparacion']

export function aplicaSemaforo(estado) {
  return ESTADOS_CON_SEMAFORO.includes(estado)
}

/**
 * Señal de espera según el estado de la comanda: con semáforo en Nuevas y En
 * preparación, neutra en Listas.
 */
export function senalDeEsperaDeComanda(estado, minutos) {
  if (!aplicaSemaforo(estado)) return { nivel: 'neutro', ...SENALES.neutro }
  return senalDeEspera(minutos)
}

/**
 * Minutos que lleva una comanda, a partir de su hora de creación.
 *
 * `creado_en` es lo que manda la API (timestamp de la base) y es la fuente
 * preferida: sobrevive a recargas y no depende de cuándo abrió el KDS. Si no
 * está —el payload de order:created no lo trae— se usa la hora de llegada local
 * que se guardó al recibir el evento, y si tampoco, los minutos que vinieron en
 * la carga inicial.
 */
export function minutosDesdeCreacion(comanda, ahoraEnMs = Date.now()) {
  if (comanda?.creado_en) {
    const creado = Date.parse(comanda.creado_en)
    if (Number.isFinite(creado)) return Math.max(0, Math.floor((ahoraEnMs - creado) / 60000))
  }

  if (Number.isFinite(comanda?.recibidoEnMs)) {
    const base = Number(comanda.minutos_transcurridos) || 0
    return Math.max(0, Math.floor(base + (ahoraEnMs - comanda.recibidoEnMs) / 60000))
  }

  return Math.max(0, Math.floor(Number(comanda?.minutos_transcurridos) || 0))
}
