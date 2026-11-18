export const CLAVE_PAGO_PRUEBA = 'smartdining_pago_prueba';

/**
 * Determina si una llave pública de Wompi corresponde a un entorno de pruebas.
 * Retorna true ÚNICAMENTE si es un string y comienza con 'pub_test_'.
 *
 * @param {*} llave
 * @returns {boolean}
 */
export function esLlaveDePrueba(llave) {
  return typeof llave === 'string' && llave.startsWith('pub_test_');
}

/**
 * Lee del almacenamiento de sesión si el modo de prueba ya ha sido marcado / visto.
 * Nunca lanza excepciones; si falla o no existe, retorna false.
 *
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function leerModoPrueba(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
) {
  try {
    if (!storage) return false;
    return storage.getItem(CLAVE_PAGO_PRUEBA) === '1';
  } catch {
    return false;
  }
}

/**
 * Marca en el almacenamiento de sesión que la sesión se encuentra en modo de prueba.
 * Nunca lanza excepciones ante fallos de almacenamiento.
 *
 * @param {Storage} [storage]
 */
export function marcarModoPrueba(
  storage = typeof sessionStorage !== 'undefined' ? sessionStorage : null
) {
  try {
    if (!storage) return;
    storage.setItem(CLAVE_PAGO_PRUEBA, '1');
  } catch {
    // Ignorar errores de almacenamiento
  }
}

/**
 * Envuelve una función para que solo se ejecute la primera vez que se invoca.
 * Las llamadas subsecuentes no hacen nada y retornan undefined.
 *
 * @template T
 * @param {(...args: any[]) => T} fn
 * @returns {(...args: any[]) => T | undefined}
 */
export function crearUnaVez(fn) {
  let ejecutado = false;
  return function unaVez(...args) {
    if (ejecutado) return undefined;
    ejecutado = true;
    return typeof fn === 'function' ? fn(...args) : undefined;
  };
}

/**
 * Decide si se debe mostrar el aviso de modo demostración o abrir directamente el widget.
 *
 * @param {object} opciones
 * @param {string} [opciones.llave] - Llave pública de Wompi recibida en la intención
 * @param {boolean} [opciones.avisoVisto] - Si el usuario ya vio el aviso en esta sesión
 * @returns {'aviso'|'abrir'}
 */
export function decidirApertura({ llave, avisoVisto } = {}) {
  if (esLlaveDePrueba(llave) && !avisoVisto) {
    return 'aviso';
  }
  return 'abrir';
}
