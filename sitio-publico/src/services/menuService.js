import { pedirJson, ErrorApi } from './api.js';
import { urlImagen } from '../utils/imagenes.js';
import cartaFija from '../datos/carta-fija.json';

export function armableTieneStock(platoArmable) {
  if (!platoArmable) return false;
  if (!Array.isArray(platoArmable.pasos)) return true;

  for (const paso of platoArmable.pasos) {
    const esObligatorio = Boolean(
      paso.obligatorio || Number(paso.min_sel) > 0 || Number(paso.minimo) > 0
    );
    if (esObligatorio) {
      const ings = Array.isArray(paso.ingredientes) ? paso.ingredientes : [];
      const hayDisponibles = ings.some((ing) => ing.disponible !== false);
      if (!hayDisponibles && ings.length > 0) {
        return false;
      }
    }
  }
  return true;
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
    imagen: urlImagen(plato.url_imagen),
    alergenos: Array.isArray(plato.alergenos) ? plato.alergenos : [],
    etiquetas: Array.isArray(plato.etiquetas) ? plato.etiquetas : [],
    disponible: plato.disponible !== false,
    personalizaciones: Array.isArray(plato.personalizaciones) ? plato.personalizaciones : [],
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
    .filter((plato) => plato.personalizable === true)
    .map((plato) => {
      const pasosAdaptados = Array.isArray(plato.pasos)
        ? plato.pasos.map((paso) => ({
            ...paso,
            ingredientes: Array.isArray(paso.ingredientes)
              ? paso.ingredientes.map((ing) => ({
                  ...ing,
                  disponible: ing.disponible !== false,
                  url_imagen: urlImagen(ing.url_imagen),
                }))
              : [],
          }))
        : [];
      const dispPlato =
        plato.disponible_plato !== undefined
          ? plato.disponible_plato
          : plato.disponible !== false;
      const objArmable = {
        ...plato,
        url_imagen: urlImagen(plato.url_imagen),
        pasos: pasosAdaptados,
        disponible_plato: dispPlato,
      };
      const tieneStock = armableTieneStock(objArmable);
      return {
        ...objArmable,
        disponible: dispPlato !== false && tieneStock,
      };
    });
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

export function obtenerMenuFijo() {
  const armablesCrudos = adaptarPlatosArmables(cartaFija);
  const categorias = adaptarCategorias(cartaFija);
  const platos = adaptarPlatos(cartaFija).map((p) => ({
    ...p,
    disponible: true,
  }));
  const armables = armablesCrudos.map((p) => {
    const adaptado = adaptarPlatoArmable(cartaFija, p.id_plato) || p;
    return {
      ...adaptado,
      disponible: true,
      disponible_plato: true,
      pasos: Array.isArray(adaptado.pasos)
        ? adaptado.pasos.map((paso) => ({
            ...paso,
            ingredientes: Array.isArray(paso.ingredientes)
              ? paso.ingredientes.map((ing) => ({ ...ing, disponible: true }))
              : [],
          }))
        : [],
    };
  });

  return {
    categorias,
    platos,
    armables,
    origen: 'fija',
  };
}

async function fetchMenuRaw(fetchFn = fetch, signal) {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const modulo = await import('../mocks/menu-simulado.json');
    return modulo.default || modulo;
  }
  return pedirJson('/menu', { fetchFn, signal });
}

export async function obtenerMenuPublico(opcionesOFetchFn = {}) {
  const opciones =
    typeof opcionesOFetchFn === 'function'
      ? { fetchFn: opcionesOFetchFn }
      : opcionesOFetchFn || {};

  const fetchFn = opciones.fetchFn || fetch;
  const timeoutMs = Number(opciones.timeoutMs) || 6000;

  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer = null;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller?.abort();
      } catch {
        // Ignorar
      }
      reject(
        new ErrorApi({
          status: 0,
          motivo: 'timeout',
          mensaje: 'Tiempo de espera agotado',
        })
      );
    }, timeoutMs);
  });

  try {
    const fetchPromise = fetchMenuRaw(fetchFn, controller?.signal);
    const raw = await Promise.race([fetchPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    const armablesCrudos = adaptarPlatosArmables(raw);
    return {
      categorias: adaptarCategorias(raw),
      platos: adaptarPlatos(raw),
      armables: armablesCrudos.map(
        (p) => adaptarPlatoArmable(raw, p.id_plato) || p
      ),
      origen: 'vivo',
    };
  } catch {
    if (timer) clearTimeout(timer);
    return obtenerMenuFijo();
  }
}

export default {
  armableTieneStock,
  normalizarCategorias,
  adaptarPlato,
  adaptarCategorias,
  adaptarPlatos,
  adaptarPlatosArmables,
  adaptarPlatoArmable,
  obtenerMenuFijo,
  obtenerMenuPublico,
};
