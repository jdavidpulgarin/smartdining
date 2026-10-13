import { pedirJson } from './api';

let cacheMenuPromise = null;

export function recargarMenu() {
  cacheMenuPromise = null;
}

async function fetchMenuRaw() {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const modulo = await import('../mocks/ejemplo-menu.json');
    return modulo.default || modulo;
  }
  return pedirJson('/menu');
}

export function obtenerMenuRaw() {
  if (!cacheMenuPromise) {
    cacheMenuPromise = fetchMenuRaw().catch((err) => {
      cacheMenuPromise = null;
      throw err;
    });
  }
  return cacheMenuPromise;
}

export function normalizarCategorias(rawMenu) {
  if (Array.isArray(rawMenu)) return rawMenu;
  if (Array.isArray(rawMenu?.categorias)) return rawMenu.categorias;
  return [];
}

export function adaptarPlato(plato, id_categoria) {
  return {
    id: plato.id_plato,
    nombre: plato.nombre,
    descripcion: plato.descripcion || '',
    precio: Number(plato.precio),
    categoriaId: id_categoria,
    imagen: plato.url_imagen || null,
    alergenos: Array.isArray(plato.alergenos) ? plato.alergenos : [],
    etiquetas: Array.isArray(plato.etiquetas) ? plato.etiquetas : [],
    disponible: plato.disponible !== false,
    personalizaciones: [],
    tiempo_estimado: plato.tiempo_estimado ?? null,
    calorias: plato.calorias ?? null,
  };
}

export function adaptarCategorias(rawMenu) {
  const cats = normalizarCategorias(rawMenu);
  return cats
    .filter((cat) => (cat.platos || []).some((p) => p.personalizable !== true))
    .map((cat) => ({
      id: cat.id_categoria,
      nombre: cat.categoria,
      orden: cat.orden ?? 0,
    }))
    .sort((a, b) => a.orden - b.orden);
}

export function adaptarPlatos(rawMenu) {
  const cats = normalizarCategorias(rawMenu);
  const resultado = [];
  for (const cat of cats) {
    for (const plato of cat.platos || []) {
      if (plato.personalizable !== true) {
        resultado.push(adaptarPlato(plato, cat.id_categoria));
      }
    }
  }
  return resultado;
}

export function adaptarPlatosArmables(rawMenu) {
  const cats = normalizarCategorias(rawMenu);
  return cats
    .flatMap((cat) => cat.platos || [])
    .filter((plato) => plato.personalizable === true);
}

export function adaptarPlatoArmable(rawMenu, idPlato) {
  const armables = adaptarPlatosArmables(rawMenu);
  const idNum = Number(idPlato);
  const encontrado = armables.find((p) => Number(p.id_plato) === idNum);
  if (!encontrado) return null;

  const pasosOrdenados = [...(encontrado.pasos || [])].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0)
  );

  return {
    ...encontrado,
    pasos: pasosOrdenados,
  };
}

export const obtenerCategorias = async () => {
  const raw = await obtenerMenuRaw();
  return adaptarCategorias(raw);
};

export const obtenerPlatos = async () => {
  const raw = await obtenerMenuRaw();
  return adaptarPlatos(raw);
};

export const obtenerPlatosArmables = async () => {
  const raw = await obtenerMenuRaw();
  return adaptarPlatosArmables(raw);
};

export const obtenerPlatoArmable = async (idPlato) => {
  const raw = await obtenerMenuRaw();
  return adaptarPlatoArmable(raw, idPlato);
};

export default {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  obtenerPlatoArmable,
  recargarMenu,
  obtenerMenuRaw,
  normalizarCategorias,
  adaptarPlato,
  adaptarCategorias,
  adaptarPlatos,
  adaptarPlatosArmables,
  adaptarPlatoArmable,
};
