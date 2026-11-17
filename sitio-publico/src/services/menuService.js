import { pedirJson } from './api.js';

export async function obtenerMenuPublico(opcionesOFetchFn = fetch) {
  const fetchFn = typeof opcionesOFetchFn === 'function'
    ? opcionesOFetchFn
    : (opcionesOFetchFn?.fetchFn || fetch);

  const data = await pedirJson('/menu', { fetchFn });
  return {
    categorias: Array.isArray(data?.categorias) ? data.categorias : [],
    platos: Array.isArray(data?.platos) ? data.platos : [],
    armables: Array.isArray(data?.armables) ? data.armables : [],
  };
}

export default {
  obtenerMenuPublico,
};
