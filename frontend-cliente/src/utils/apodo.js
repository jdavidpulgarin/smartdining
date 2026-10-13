import { CLAVE_SESION } from './sesion';

export function obtenerApodo() {
  try {
    const guardado = sessionStorage.getItem(CLAVE_SESION);
    if (!guardado) return '';
    const parsed = JSON.parse(guardado);
    return typeof parsed?.comensal === 'string' ? parsed.comensal.trim() : '';
  } catch {
    return '';
  }
}
