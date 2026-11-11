export const VIDEOS_SITIO = Object.freeze({
  portada: '/videos/portada.mp4',
  armaTuPlato: '/videos/arma-tu-plato.mp4',
});

export const POSTER_RESPALDO = '/icons/pwa-512x512.png';

/**
 * Determina si se debe cargar el elemento <video> según las preferencias
 * de movimiento reducido y ahorro de datos del navegador.
 */
export function debeCargarVideo({
  prefersReducedMotion = false,
  saveData = false,
} = {}) {
  if (prefersReducedMotion || saveData) {
    return false;
  }
  return true;
}

/**
 * Lee del entorno del navegador si el usuario prefiere movimiento reducido
 * o tiene activado el modo de ahorro de datos.
 */
export function leerPreferenciasVideoNavegador() {
  let prefersReducedMotion = false;
  let saveData = false;

  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      prefersReducedMotion = Boolean(
        window.matchMedia('(prefers-reduced-motion: reduce)')?.matches
      );
    }
  } catch {
    prefersReducedMotion = false;
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.connection) {
      saveData = Boolean(navigator.connection.saveData);
    }
  } catch {
    saveData = false;
  }

  return { prefersReducedMotion, saveData };
}

export function elegirPosterPortada(platos = [], armables = []) {
  if (Array.isArray(platos)) {
    const platoConFoto = platos.find(
      (p) => typeof p?.imagen === 'string' && p.imagen.trim().length > 0
    );
    if (platoConFoto) return platoConFoto.imagen.trim();
  }
  if (Array.isArray(armables)) {
    const armableConFoto = armables.find(
      (a) => typeof a?.url_imagen === 'string' && a.url_imagen.trim().length > 0
    );
    if (armableConFoto) return armableConFoto.url_imagen.trim();
  }
  return POSTER_RESPALDO;
}

export function elegirPosterArmaTuPlato(armables = [], platos = []) {
  if (Array.isArray(armables)) {
    const armableConFoto = armables.find(
      (a) => typeof a?.url_imagen === 'string' && a.url_imagen.trim().length > 0
    );
    if (armableConFoto) return armableConFoto.url_imagen.trim();
  }
  return elegirPosterPortada(platos, armables);
}

export function describirReglaPaso(paso) {
  if (!paso || typeof paso !== 'object') return '';
  const obligatorio = Boolean(paso.obligatorio);
  const min = Number(paso.min_sel) || 0;
  const max = Number(paso.max_sel) || 0;

  const partes = [obligatorio ? 'Obligatorio' : 'Opcional'];
  if (min > 0 && max > 0 && min === max) {
    partes.push(`Elige ${min}`);
  } else if (max > 0) {
    partes.push(`Hasta ${max}`);
  }
  return partes.join(' · ');
}
