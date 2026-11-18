import { debeCargarVideo } from './sitioPublico.js';

/**
 * Función pura para seleccionar la fuente del video de portada según el
 * ancho de pantalla y las preferencias del usuario (movimiento reducido o ahorro de datos).
 *
 * @param {Object} params
 * @param {number} [params.anchoPantalla=1024]
 * @param {Object} [params.prefs={}]
 * @returns {string|null} Ruta del video o null si no se debe cargar
 */
export function elegirFuentePortada({ anchoPantalla = 1024, prefs = {} } = {}) {
  const reducedMotion = Boolean(prefs?.prefersReducedMotion || prefs?.reducedMotion);
  const saveData = Boolean(prefs?.saveData);

  if (!debeCargarVideo({ prefersReducedMotion: reducedMotion, saveData })) {
    return null;
  }

  const ancho = Number(anchoPantalla);
  if (Number.isFinite(ancho) && ancho < 768) {
    return '/videos/portada-480.mp4';
  }
  return '/videos/portada.mp4';
}

export default {
  elegirFuentePortada,
};
