import { pedirJson } from './api';
import {
  marcasAgotadoTrasRecarga,
  actualizarMarcasPorDisponibilidad,
} from '../utils/sinStock';
import { urlImagen } from '../utils/imagenes';

let cacheMenuPromise = null;
let marcasAgotadoLocal = [];
const suscriptoresMenu = new Set();

function notificarSuscriptoresMenu(menu) {
  for (const fn of suscriptoresMenu) {
    try {
      fn(menu);
    } catch {
      // Ignorar errores en oyentes individuales
    }
  }
}

export function suscribirCambiosMenu(fn) {
  if (typeof fn !== 'function') return () => {};
  suscriptoresMenu.add(fn);
  return () => {
    suscriptoresMenu.delete(fn);
  };
}

export function obtenerMarcasAgotadoLocal() {
  return [...marcasAgotadoLocal];
}

export function tieneMarcasAgotadoLocal() {
  return marcasAgotadoLocal.length > 0;
}

export function limpiarMarcasAgotadoLocal() {
  marcasAgotadoLocal = [];
}

export function recargarMenu() {
  cacheMenuPromise = null;
}

async function fetchMenuRaw() {
  if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
    const modulo = await import('../mocks/menu-simulado.json');
    return modulo.default || modulo;
  }
  return pedirJson('/menu');
}

export function obtenerMenuRaw() {
  if (!cacheMenuPromise) {
    cacheMenuPromise = fetchMenuRaw()
      .then((menuNuevo) => {
        if (marcasAgotadoLocal.length > 0) {
          marcasAgotadoLocal = marcasAgotadoTrasRecarga(
            marcasAgotadoLocal,
            menuNuevo
          );
        }
        const menuEfectivo =
          marcasAgotadoLocal.length > 0
            ? aplicarFaltantesMenu(menuNuevo, marcasAgotadoLocal)
            : menuNuevo;
        notificarSuscriptoresMenu(menuEfectivo);
        return menuEfectivo;
      })
      .catch((err) => {
        cacheMenuPromise = null;
        throw err;
      });
  }
  return cacheMenuPromise;
}

export function aplicarDisponibilidad(menu, idIngrediente, disponible) {
  if (!menu) return menu;
  const idNum = Number(idIngrediente);
  const esArray = Array.isArray(menu);
  const categorias = esArray ? menu : menu.categorias;
  if (!Array.isArray(categorias)) return menu;

  const nuevasCategorias = categorias.map((cat) => {
    if (!Array.isArray(cat.platos)) return cat;
    const nuevosPlatos = cat.platos.map((plato) => {
      if (!Array.isArray(plato.pasos)) return plato;
      const nuevosPasos = plato.pasos.map((paso) => {
        if (!Array.isArray(paso.ingredientes)) return paso;
        const nuevosIngredientes = paso.ingredientes.map((ing) => {
          if (Number(ing.id_ingrediente) === idNum) {
            return { ...ing, disponible: Boolean(disponible) };
          }
          return ing;
        });
        return { ...paso, ingredientes: nuevosIngredientes };
      });
      return { ...plato, pasos: nuevosPasos };
    });
    return { ...cat, platos: nuevosPlatos };
  });

  return esArray ? nuevasCategorias : { ...menu, categorias: nuevasCategorias };
}

export function actualizarDisponibilidadEnCache(idIngrediente, disponible) {
  if (Boolean(disponible) && marcasAgotadoLocal.length > 0) {
    marcasAgotadoLocal = actualizarMarcasPorDisponibilidad(marcasAgotadoLocal, {
      tipo: 'ingrediente',
      id: Number(idIngrediente),
      disponible: true,
    });
  }
  if (!cacheMenuPromise) return;
  cacheMenuPromise = cacheMenuPromise.then((raw) => {
    const actualizado = aplicarDisponibilidad(raw, idIngrediente, disponible);
    notificarSuscriptoresMenu(actualizado);
    return actualizado;
  });
}

export function aplicarDisponibilidadPlato(menu, idPlato, disponible) {
  if (!menu) return menu;
  const idNum = Number(idPlato);
  if (!idNum || isNaN(idNum)) return menu;
  const esArray = Array.isArray(menu);
  const categorias = esArray ? menu : menu.categorias;
  if (!Array.isArray(categorias)) return menu;

  const nuevasCategorias = categorias.map((cat) => {
    if (!Array.isArray(cat.platos)) return cat;
    const nuevosPlatos = cat.platos.map((plato) => {
      if (Number(plato.id_plato) === idNum) {
        return { ...plato, disponible: Boolean(disponible) };
      }
      return plato;
    });
    return { ...cat, platos: nuevosPlatos };
  });

  return esArray ? nuevasCategorias : { ...menu, categorias: nuevasCategorias };
}

export function actualizarDisponibilidadPlatoEnCache(idPlato, disponible) {
  if (Boolean(disponible) && marcasAgotadoLocal.length > 0) {
    marcasAgotadoLocal = actualizarMarcasPorDisponibilidad(marcasAgotadoLocal, {
      tipo: 'plato',
      id: Number(idPlato),
      disponible: true,
    });
  }
  if (!cacheMenuPromise) return;
  cacheMenuPromise = cacheMenuPromise.then((raw) => {
    const actualizado = aplicarDisponibilidadPlato(raw, idPlato, disponible);
    notificarSuscriptoresMenu(actualizado);
    return actualizado;
  });
}

/**
 * Limpia la marca local de agotado para un plato o ingrediente repuesto.
 *
 * @param {'plato'|'ingrediente'} tipo
 * @param {number|string} id
 */
export function limpiarMarcaAgotado(tipo, id) {
  const idNum = Number(id);
  if (!idNum) return;
  marcasAgotadoLocal = actualizarMarcasPorDisponibilidad(marcasAgotadoLocal, {
    tipo,
    id: idNum,
    disponible: true,
  });
}

/**
 * Verifica si un plato armable tiene stock en todos sus pasos obligatorios.
 * Si algún paso obligatorio se queda sin ingredientes disponibles, el armable no se puede pedir.
 *
 * @param {object} platoArmable
 * @returns {boolean}
 */
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

/**
 * Función pura que actualiza la disponibilidad de un plato en una lista plana de platos.
 *
 * @param {Array<object>} platos
 * @param {number|string} idPlato
 * @param {boolean} disponible
 * @returns {Array<object>}
 */
export function aplicarDisponibilidadEnListaPlatos(platos = [], idPlato, disponible) {
  if (!Array.isArray(platos)) return [];
  const idNum = Number(idPlato);
  if (!idNum) return platos;

  return platos.map((p) => {
    const pId = Number(p.id ?? p.id_plato);
    if (pId === idNum) {
      return { ...p, disponible: Boolean(disponible) };
    }
    return p;
  });
}

/**
 * Función pura que actualiza la disponibilidad de un ingrediente en una lista de platos armables.
 * Si el ingrediente agotado hace que un paso obligatorio no tenga opciones, el plato armable se agota.
 *
 * @param {Array<object>} armables
 * @param {number|string} idIngrediente
 * @param {boolean} disponible
 * @returns {Array<object>}
 */
export function aplicarDisponibilidadIngredienteEnArmables(armables = [], idIngrediente, disponible) {
  if (!Array.isArray(armables)) return [];
  const idNum = Number(idIngrediente);
  if (!idNum) return armables;

  return armables.map((plato) => {
    if (!Array.isArray(plato.pasos)) return plato;
    let huboCambio = false;

    const nuevosPasos = plato.pasos.map((paso) => {
      if (!Array.isArray(paso.ingredientes)) return paso;
      const nuevosIngs = paso.ingredientes.map((ing) => {
        if (Number(ing.id_ingrediente) === idNum) {
          huboCambio = true;
          return { ...ing, disponible: Boolean(disponible) };
        }
        return ing;
      });
      return { ...paso, ingredientes: nuevosIngs };
    });

    if (!huboCambio) return plato;

    const platoActualizado = { ...plato, pasos: nuevosPasos };
    const tieneStock = armableTieneStock(platoActualizado);
    return {
      ...platoActualizado,
      disponible: tieneStock,
    };
  });
}

export function aplicarFaltantesMenu(menu, faltantes = []) {
  if (!menu || !Array.isArray(faltantes) || faltantes.length === 0) return menu;
  let actual = menu;
  for (const f of faltantes) {
    if (!f || typeof f !== 'object') continue;
    if (f.tipo === 'plato' && f.id != null) {
      actual = aplicarDisponibilidadPlato(actual, f.id, false);
    } else if (f.tipo === 'ingrediente') {
      if (f.id != null) {
        actual = aplicarDisponibilidad(actual, f.id, false);
      } else if (typeof f.nombre === 'string' && f.nombre.trim()) {
        const buscado = f.nombre.trim().toLowerCase();
        const esArray = Array.isArray(actual);
        const categorias = esArray ? actual : actual.categorias;
        if (Array.isArray(categorias)) {
          const nuevasCategorias = categorias.map((cat) => {
            if (!Array.isArray(cat.platos)) return cat;
            const nuevosPlatos = cat.platos.map((plato) => {
              if (!Array.isArray(plato.pasos)) return plato;
              const nuevosPasos = plato.pasos.map((paso) => {
                if (!Array.isArray(paso.ingredientes)) return paso;
                const nuevosIngredientes = paso.ingredientes.map((ing) => {
                  if (
                    typeof ing?.nombre === 'string' &&
                    ing.nombre.trim().toLowerCase() === buscado
                  ) {
                    return { ...ing, disponible: false };
                  }
                  return ing;
                });
                return { ...paso, ingredientes: nuevosIngredientes };
              });
              return { ...plato, pasos: nuevosPasos };
            });
            return { ...cat, platos: nuevosPlatos };
          });
          actual = esArray
            ? nuevasCategorias
            : { ...actual, categorias: nuevasCategorias };
        }
      }
    }
  }
  return actual;
}

export function marcarFaltantesEnCache(faltantes = []) {
  if (!Array.isArray(faltantes) || faltantes.length === 0) {
    return;
  }
  for (const f of faltantes) {
    if (!f || typeof f !== 'object') continue;
    if (f.tipo !== 'plato' && f.tipo !== 'ingrediente') continue;
    const idRaw = f.id;
    const idNum =
      idRaw !== null && idRaw !== undefined && idRaw !== ''
        ? Number(idRaw)
        : NaN;
    const tieneIdValido = Number.isInteger(idNum) && idNum > 0;
    const nombre =
      typeof f.nombre === 'string' && f.nombre.trim() ? f.nombre.trim() : null;
    if (f.tipo === 'plato' && !tieneIdValido) continue;
    if (f.tipo === 'ingrediente' && !tieneIdValido && !nombre) continue;

    const idFinal = tieneIdValido ? idNum : null;
    const yaExiste = marcasAgotadoLocal.some((m) =>
      idFinal != null
        ? m.tipo === f.tipo && Number(m.id) === idFinal
        : m.tipo === f.tipo &&
          m.id == null &&
          typeof m.nombre === 'string' &&
          m.nombre.toLowerCase() === nombre.toLowerCase()
    );
    if (!yaExiste) {
      marcasAgotadoLocal.push({
        tipo: f.tipo,
        id: idFinal,
        nombre,
      });
    }
  }
  if (!cacheMenuPromise) return;
  cacheMenuPromise = cacheMenuPromise.then((raw) => {
    const actualizado = aplicarFaltantesMenu(raw, faltantes);
    notificarSuscriptoresMenu(actualizado);
    return actualizado;
  });
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
      const objArmable = {
        ...plato,
        url_imagen: urlImagen(plato.url_imagen),
        pasos: pasosAdaptados,
      };
      const tieneStock = armableTieneStock(objArmable);
      return {
        ...objArmable,
        disponible: plato.disponible !== false && tieneStock,
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

export {
  marcasAgotadoTrasRecarga,
  actualizarMarcasPorDisponibilidad,
};

export default {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  obtenerPlatoArmable,
  recargarMenu,
  obtenerMenuRaw,
  suscribirCambiosMenu,
  obtenerMarcasAgotadoLocal,
  tieneMarcasAgotadoLocal,
  limpiarMarcasAgotadoLocal,
  marcasAgotadoTrasRecarga,
  actualizarMarcasPorDisponibilidad,
  normalizarCategorias,
  adaptarPlato,
  adaptarCategorias,
  adaptarPlatos,
  adaptarPlatosArmables,
  adaptarPlatoArmable,
  aplicarDisponibilidad,
  actualizarDisponibilidadEnCache,
  aplicarDisponibilidadPlato,
  actualizarDisponibilidadPlatoEnCache,
  limpiarMarcaAgotado,
  armableTieneStock,
  aplicarDisponibilidadEnListaPlatos,
  aplicarDisponibilidadIngredienteEnArmables,
  aplicarFaltantesMenu,
  marcarFaltantesEnCache,
};
