import { CLAVE_SESION } from './sesion';
import { aliasDelToken } from '../services/clienteMesa';

/**
 * Resuelve el apodo o nombre del comensal priorizando el alias firmado
 * dentro del JWT del token si está presente, sobre cualquier valor local
 * o texto escrito por el usuario.
 *
 * @param {object|null} sesion - Objeto con { token, comensal }
 * @returns {string} - El nombre resuelto del comensal
 */
export function resolverApodo(sesion) {
  if (!sesion) return '';
  if (sesion.token) {
    const alias = aliasDelToken(sesion.token);
    if (alias) return alias;
  }
  return typeof sesion.comensal === 'string' ? sesion.comensal.trim() : '';
}

export function obtenerApodo() {
  try {
    const guardado = sessionStorage.getItem(CLAVE_SESION);
    if (!guardado) return '';
    const parsed = JSON.parse(guardado);
    return resolverApodo(parsed);
  } catch {
    return '';
  }
}

export default obtenerApodo;
