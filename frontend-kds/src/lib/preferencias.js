/**
 * Preferencias de la pantalla: tema y sonido.
 *
 * Todo acceso a localStorage va en try/catch: en modo privado, con el
 * almacenamiento bloqueado o con la cuota llena, lanza. El KDS tiene que
 * funcionar igual; lo único que se pierde es recordar la elección.
 *
 * Son funciones puras salvo el acceso al storage, para poder probar la decisión
 * del tema sin navegador.
 */

export const CLAVE_TEMA = 'kds_tema'
export const CLAVE_SONIDO = 'kds_sonido'

export const TEMAS = ['oscuro', 'claro']

/** Lee una preferencia guardada, o null si no hay (o el storage falla). */
export function leerPreferencia(clave) {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

export function guardarPreferencia(clave, valor) {
  try {
    localStorage.setItem(clave, String(valor))
    return true
  } catch {
    return false
  }
}

/**
 * Tema inicial.
 *
 * Manda lo que el usuario eligió en esta pantalla. Si no eligió nada, se mira
 * `prefers-color-scheme`; y si el sistema no dice nada, **oscuro**, que es el
 * modo para el que está pensada la cocina.
 *
 * @param {string|null} guardado  valor de localStorage
 * @param {boolean|null} prefiereClaro  resultado de la media query
 */
export function temaInicial(guardado, prefiereClaro) {
  if (TEMAS.includes(guardado)) return guardado
  if (prefiereClaro === true) return 'claro'
  return 'oscuro'
}

/** ¿Arranca el sonido activado? Por omisión no, hasta que alguien lo active. */
export function sonidoInicial(guardado) {
  return guardado === 'true'
}
