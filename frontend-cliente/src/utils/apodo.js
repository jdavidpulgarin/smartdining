import { CLAVE_SESION } from './sesion';
import { aliasDelToken } from '../services/clienteMesa';

/**
 * Calcula la clave comparable de un alias (D-18b): sin tildes, en minúsculas y
 * sin separadores ni espacios (`Ána María` === `ana  maria`).
 *
 * @param {string|null|undefined} valor
 * @returns {string}
 */
export function claveAlias(valor) {
  if (typeof valor !== 'string') return '';
  return valor
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[\s._'-]/g, '');
}

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
    const guardado =
      (typeof localStorage !== 'undefined' ? localStorage.getItem(CLAVE_SESION) : null) ||
      (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CLAVE_SESION) : null);
    if (!guardado) return '';
    const parsed = JSON.parse(guardado);
    return resolverApodo(parsed);
  } catch {
    return '';
  }
}

export default obtenerApodo;
