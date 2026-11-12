import { pedirJson, tieneApiUrlConfigurada, ErrorApi } from './api';
import menuSimulado from '../mocks/menu-simulado.json';

let cacheMenuPromise = null;
let cacheConfigPromise = null;

function esModoDev() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function esModoDemo() {
  return !tieneApiUrlConfigurada() && esModoDev();
}

export function recargarMenu() {
  cacheMenuPromise = null;
  cacheConfigPromise = null;
}

async function fetchMenuRaw() {
  if (!tieneApiUrlConfigurada()) {
    if (esModoDev()) {
      return menuSimulado;
    }
    throw new ErrorApi({
      status: 0,
      motivo: 'sin_api_url',
      mensaje: 'Falta configurar EXPO_PUBLIC_API_URL para cargar el menú.',
    });
  }
  return pedirJson('/api/menu');
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

export function obtenerConfiguracion() {
  if (!tieneApiUrlConfigurada()) {
    if (esModoDev()) {
      return Promise.resolve({
        nombre: 'SmartDining',
        moneda: 'COP',
        modoDemo: true,
      });
    }
    return Promise.resolve({ nombre: 'SmartDining', moneda: 'COP' });
  }

  if (!cacheConfigPromise) {
    cacheConfigPromise = pedirJson('/api/configuracion').catch(() => ({
      nombre: 'SmartDining',
      moneda: 'COP',
    }));
  }
  return cacheConfigPromise;
}

// Copiado de frontend-cliente; pasar a packages/core (R-22)
export function normalizarCategorias(rawMenu) {
  if (Array.isArray(rawMenu)) return rawMenu;
  if (Array.isArray(rawMenu?.categorias)) return rawMenu.categorias;
  return [];
}

// Copiado de frontend-cliente; pasar a packages/core (R-22)
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
    personalizable: plato.personalizable === true,
    personalizaciones: [],
    tiempo_estimado: plato.tiempo_estimado ?? null,
    calorias: plato.calorias ?? null,
  };
}

// Copiado de frontend-cliente; pasar a packages/core (R-22)
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

// Copiado de frontend-cliente; pasar a packages/core (R-22)
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

// Copiado de frontend-cliente; pasar a packages/core (R-22)
export function adaptarPlatosArmables(rawMenu) {
  const cats = normalizarCategorias(rawMenu);
  return cats
    .flatMap((cat) => cat.platos || [])
    .filter((plato) => plato.personalizable === true);
}

// Copiado de frontend-cliente; pasar a packages/core (R-22)
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

export function adaptarPlatoPorId(rawMenu, idPlato) {
  const cats = normalizarCategorias(rawMenu);
  const idNum = Number(idPlato);
  for (const cat of cats) {
    const encontrado = (cat.platos || []).find(
      (p) => Number(p.id_plato) === idNum
    );
    if (encontrado) {
      return {
        ...adaptarPlato(encontrado, cat.id_categoria),
        pasos: Array.isArray(encontrado.pasos) ? encontrado.pasos : [],
      };
    }
  }
  return null;
}

export async function obtenerCategorias() {
  const raw = await obtenerMenuRaw();
  return adaptarCategorias(raw);
}

export async function obtenerPlatos() {
  const raw = await obtenerMenuRaw();
  return adaptarPlatos(raw);
}

export async function obtenerPlatosArmables() {
  const raw = await obtenerMenuRaw();
  return adaptarPlatosArmables(raw);
}

export async function obtenerPlatoArmable(idPlato) {
  const raw = await obtenerMenuRaw();
  return adaptarPlatoArmable(raw, idPlato);
}

export async function obtenerPlatoPorId(idPlato) {
  const raw = await obtenerMenuRaw();
  return adaptarPlatoPorId(raw, idPlato);
}
