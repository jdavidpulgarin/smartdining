import { ErrorApi } from '../services/api';

export const MENSAJE_CRUCE_PEDIDO =
  'Hubo un cruce con otro pedido, vuelve a enviarlo.';
export const MENSAJE_ERROR_PEDIDO_GENERICO =
  'Ocurrió un error al enviar el pedido';
export const MENSAJE_SIN_STOCK_GENERICO =
  'Algo de tu pedido se acabó. Revisa el carrito e inténtalo de nuevo.';

/**
 * Normaliza y filtra la lista de faltantes al formato real de D-17:
 * `[{ tipo: 'plato' | 'ingrediente', id: number, nombre: string | null }]`.
 * Ignora objetos con la forma vieja (`{ id_plato }` o `{ id_ingrediente }`).
 *
 * @param {Array<object>} faltantes
 * @returns {Array<{ tipo: 'plato'|'ingrediente', id: number, nombre: string|null }>}
 */
export function normalizarFaltantes(faltantes) {
  if (!Array.isArray(faltantes)) return [];

  const vistos = new Set();
  const resultado = [];

  for (const f of faltantes) {
    if (!f || typeof f !== 'object') continue;
    if (f.tipo !== 'plato' && f.tipo !== 'ingrediente') continue;

    const idNum = Number(f.id);
    if (!Number.isInteger(idNum) || idNum <= 0) continue;

    const clave = `${f.tipo}:${idNum}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    const nombre =
      typeof f.nombre === 'string' && f.nombre.trim() ? f.nombre.trim() : null;

    resultado.push({
      tipo: f.tipo,
      id: idNum,
      nombre,
    });
  }

  return resultado;
}

/**
 * Extrae los IDs de ingredientes presentes en una línea del carrito.
 *
 * @param {object} item
 * @returns {number[]}
 */
function obtenerIdsIngredientesItem(item) {
  if (!item || typeof item !== 'object') return [];

  const fuentes = [];
  if (Array.isArray(item.ingredientes)) {
    fuentes.push(...item.ingredientes);
  }
  if (Array.isArray(item.selecciones)) {
    fuentes.push(...item.selecciones);
  } else if (item.selecciones && typeof item.selecciones === 'object') {
    for (const pasoSel of Object.values(item.selecciones)) {
      if (pasoSel && typeof pasoSel === 'object') {
        for (const idKey of Object.keys(pasoSel)) {
          fuentes.push(Number(idKey));
        }
      }
    }
  }

  const ids = new Set();
  for (const ing of fuentes) {
    const rawId =
      typeof ing === 'object' && ing !== null
        ? (ing.id_ingrediente ?? ing.idIngrediente ?? ing.id)
        : ing;
    const idNum = Number(rawId);
    if (Number.isInteger(idNum) && idNum > 0) {
      ids.add(idNum);
    }
  }

  return Array.from(ids);
}

/**
 * Devuelve los faltantes que afectan a un ítem concreto del carrito:
 * - plato si `f.tipo === 'plato' && f.id === item.id_plato`
 * - ingrediente si `f.tipo === 'ingrediente'` y `f.id` está entre los ingredientes del ítem.
 *
 * NO marca nada si `faltantes` viene con la forma vieja (`{ id_plato }` sin `tipo` ni `id`).
 *
 * @param {object} item
 * @param {Array<object>} faltantes
 * @returns {Array<{ tipo: 'plato'|'ingrediente', id: number, nombre: string|null }>}
 */
export function faltantesDelItem(item, faltantes) {
  if (!item || typeof item !== 'object') return [];

  const listaFaltantes = normalizarFaltantes(faltantes);
  if (listaFaltantes.length === 0) return [];

  const idPlatoItem = Number(item.id_plato ?? item.idPlato ?? item.id);
  const idsIngredientes = obtenerIdsIngredientesItem(item);

  return listaFaltantes.filter((f) => {
    if (f.tipo === 'plato') {
      return Number.isInteger(idPlatoItem) && idPlatoItem > 0 && f.id === idPlatoItem;
    }
    if (f.tipo === 'ingrediente') {
      return idsIngredientes.includes(f.id);
    }
    return false;
  });
}

/**
 * Resume qué ítems del carrito quedan afectados por `faltantes` y genera el texto
 * explicativo con `f.nombre` indicando qué quitar para enviar el resto.
 *
 * @param {Array<object>} carrito
 * @param {Array<object>} faltantes
 * @returns {{
 *   hayFaltantes: boolean,
 *   faltantes: Array<{ tipo: 'plato'|'ingrediente', id: number, nombre: string|null }>,
 *   itemsAfectados: Array<{
 *     id_linea: string|null,
 *     id_plato: number,
 *     nombre: string,
 *     platoAgotado: boolean,
 *     ingredientesAgotados: Array<{ tipo: 'ingrediente', id: number, nombre: string|null }>,
 *     faltantes: Array<{ tipo: 'plato'|'ingrediente', id: number, nombre: string|null }>,
 *     etiqueta: string
 *   }>,
 *   idsLineasAfectadas: string[],
 *   idsPlatosAgotados: number[],
 *   idsIngredientesAgotados: number[],
 *   texto: string,
 *   mensaje: string
 * }}
 */
export function resumenFaltantes(carrito = [], faltantes = []) {
  const faltantesLimpios = normalizarFaltantes(faltantes);
  const lineas = Array.isArray(carrito) ? carrito : [];

  const itemsAfectados = [];
  const idsLineasAfectadas = [];

  for (const linea of lineas) {
    const coincidencias = faltantesDelItem(linea, faltantesLimpios);
    if (coincidencias.length === 0) continue;

    const idLinea = linea.id_linea != null ? String(linea.id_linea) : null;
    if (idLinea) idsLineasAfectadas.push(idLinea);

    const platoAgotado = coincidencias.some((f) => f.tipo === 'plato');
    const ingredientesAgotados = coincidencias.filter(
      (f) => f.tipo === 'ingrediente'
    );
    const nombreLinea =
      linea.nombre ||
      linea.plato_nombre ||
      coincidencias.find((f) => f.tipo === 'plato')?.nombre ||
      'Plato';

    const nombresIng = ingredientesAgotados
      .map((f) => f.nombre || `ingrediente #${f.id}`)
      .filter(Boolean);

    const etiqueta =
      !platoAgotado && nombresIng.length > 0
        ? `Se acabó: ${nombresIng.join(', ')}`
        : 'Se acabó';

    itemsAfectados.push({
      id_linea: idLinea,
      id_plato: Number(linea.id_plato ?? linea.idPlato ?? linea.id) || 0,
      nombre: nombreLinea,
      platoAgotado,
      ingredientesAgotados,
      faltantes: coincidencias,
      etiqueta,
    });
  }

  const idsPlatosAgotados = faltantesLimpios
    .filter((f) => f.tipo === 'plato')
    .map((f) => f.id);

  const idsIngredientesAgotados = faltantesLimpios
    .filter((f) => f.tipo === 'ingrediente')
    .map((f) => f.id);

  // Construir texto legible con f.nombre
  const frases = [];

  const faltantesPlato = faltantesLimpios.filter((f) => f.tipo === 'plato');
  if (faltantesPlato.length > 0) {
    const nombresPlatos = faltantesPlato.map((f) => {
      if (f.nombre) return f.nombre;
      const itemCarrito = lineas.find(
        (l) => Number(l?.id_plato ?? l?.idPlato ?? l?.id) === f.id
      );
      return itemCarrito?.nombre || `plato #${f.id}`;
    });
    const verboQuitar =
      nombresPlatos.length === 1 ? 'Quítalo para enviar el resto.' : 'Quítalos para enviar el resto.';
    frases.push(`Se acabó: ${nombresPlatos.join(', ')}. ${verboQuitar}`);
  }

  const faltantesIng = faltantesLimpios.filter((f) => f.tipo === 'ingrediente');
  for (const ing of faltantesIng) {
    const nombreIng = ing.nombre || `ingrediente #${ing.id}`;
    const itemConIng = itemsAfectados.find((it) =>
      it.ingredientesAgotados.some((x) => x.id === ing.id)
    );
    if (itemConIng?.nombre) {
      frases.push(
        `Se acabó el ingrediente ${nombreIng} en tu ${itemConIng.nombre}. Quítalo para enviar el resto.`
      );
    } else {
      frases.push(
        `Se acabó el ingrediente ${nombreIng}. Quítalo para enviar el resto.`
      );
    }
  }

  const texto = frases.join(' ');
  const mensaje = texto || MENSAJE_SIN_STOCK_GENERICO;

  return {
    hayFaltantes: itemsAfectados.length > 0 || faltantesLimpios.length > 0,
    faltantes: faltantesLimpios,
    itemsAfectados,
    idsLineasAfectadas,
    idsPlatosAgotados,
    idsIngredientesAgotados,
    texto,
    mensaje,
  };
}

/**
 * Clasifica el error al enviar un pedido:
 * - 409 `sin_stock` -> `{ tipo: 'sin_stock', faltantes, mensaje, ... }`
 * - 503 `reintentar` -> `{ tipo: 'reintentar', mensaje: 'Hubo un cruce con otro pedido, vuelve a enviarlo.' }`
 * - otros -> estructura compatible con `traducirErrorPedido` y mensaje genérico de siempre.
 *
 * @param {any} error
 * @param {Array<object>} [carrito=[]]
 * @returns {object}
 */
export function accionErrorPedido(error, carrito = []) {
  const status = Number(
    error?.status ?? error?.response?.status ?? error?.data?.status ?? 0
  );
  const motivoRaw = error?.motivo ?? error?.data?.motivo ?? '';
  const motivo = String(motivoRaw).toLowerCase();

  if (status === 401) {
    return {
      tipo: 401,
      ignorar: true,
      mensaje: error?.mensaje || error?.message || 'Sesión inválida o expirada',
    };
  }

  // 409 sin_stock (D-17)
  if ((status === 409 || status === 0) && motivo === 'sin_stock') {
    const rawFaltantes = error?.faltantes ?? error?.data?.faltantes;
    const resumen = resumenFaltantes(carrito, rawFaltantes);
    const mensaje = resumen.texto || MENSAJE_SIN_STOCK_GENERICO;

    return {
      tipo: 'sin_stock',
      status: 409,
      motivo: 'sin_stock',
      hayFaltantes: resumen.hayFaltantes,
      puedeEnviar: resumen.idsLineasAfectadas.length === 0,
      faltantes: resumen.faltantes,
      itemsAfectados: resumen.itemsAfectados,
      idsLineasAfectadas: resumen.idsLineasAfectadas,
      idsPlatosAgotados: resumen.idsPlatosAgotados,
      idsIngredientesAgotados: resumen.idsIngredientesAgotados,
      mensaje,
      ayuda: resumen.hayFaltantes
        ? 'Quita lo que se acabó para poder enviar el resto de tu pedido.'
        : null,
      recargarMenu: true,
    };
  }

  // 503 reintentar (deadlock / colisión pasajera en reserva de stock, D-17)
  if ((status === 503 || status === 0) && motivo === 'reintentar') {
    return {
      tipo: 'reintentar',
      status: 503,
      motivo: 'reintentar',
      faltantes: [],
      mensaje: MENSAJE_CRUCE_PEDIDO,
      esReintentable: true,
    };
  }

  const esErrorApi =
    error instanceof ErrorApi ||
    error?.name === 'ErrorApi' ||
    typeof error?.status === 'number';

  if (esErrorApi) {
    if (status === 409) {
      return {
        tipo: 409,
        mensaje:
          error?.mensaje ||
          error?.message ||
          'El plato o ingrediente seleccionado se agotó.',
        ayuda: 'Revisa tu pedido: algo se agotó en cocina',
        recargarMenu: true,
      };
    }

    if (status === 429) {
      const seg = Number(error?.retryAfter) > 0 ? Number(error.retryAfter) : 60;
      return {
        tipo: 429,
        mensaje: `Demasiados intentos. Espera ${seg} segundos`,
        bloquearSegundos: seg,
      };
    }

    if (status === 0 || motivo === 'sin_conexion') {
      return {
        tipo: 0,
        mensaje:
          'No pudimos enviar tu pedido. Revisa tu conexión a internet e intenta de nuevo',
        esConexion: true,
      };
    }

    if (status === 400 || status === 422) {
      return {
        tipo: status,
        mensaje:
          error?.mensaje || error?.message || 'Revisa los datos del pedido',
      };
    }

    const msgApi =
      error?.mensaje && error.mensaje !== 'Ocurrió un error, intenta de nuevo'
        ? error.mensaje
        : MENSAJE_ERROR_PEDIDO_GENERICO;

    return {
      tipo: status,
      mensaje: msgApi,
    };
  }

  return {
    tipo: 'local',
    mensaje: error?.message || MENSAJE_ERROR_PEDIDO_GENERICO,
  };
}

/**
 * Extrae los IDs de platos y de ingredientes que están disponibles en un menú
 * recién cargado desde `GET /menu`.
 *
 * `GET /menu` es la fuente de verdad y solo devuelve platos con stock, por lo
 * que todo plato que aparezca en `menuNuevo` (salvo `disponible: false`) deja
 * de estar agotado.
 *
 * @param {object|Array} menuNuevo
 * @returns {{
 *   platosDisponibles: Set<number>,
 *   ingredientesDisponibles: Set<number>,
 *   nombresIngredientesDisponibles: Set<string>,
 *   menuValido: boolean
 * }}
 */
function extraerDisponiblesDeMenu(menuNuevo) {
  const platosDisponibles = new Set();
  const ingredientesDisponibles = new Set();
  const nombresIngredientesDisponibles = new Set();

  if (!menuNuevo || typeof menuNuevo !== 'object') {
    return {
      platosDisponibles,
      ingredientesDisponibles,
      nombresIngredientesDisponibles,
      menuValido: false,
    };
  }

  const lista = Array.isArray(menuNuevo)
    ? menuNuevo
    : Array.isArray(menuNuevo.categorias)
      ? menuNuevo.categorias
      : null;

  if (!lista) {
    return {
      platosDisponibles,
      ingredientesDisponibles,
      nombresIngredientesDisponibles,
      menuValido: false,
    };
  }

  const registrarPlato = (plato) => {
    if (!plato || typeof plato !== 'object') return;
    const idPlato = Number(plato.id_plato ?? plato.id);
    if (
      Number.isInteger(idPlato) &&
      idPlato > 0 &&
      plato.disponible !== false &&
      plato.stock_suficiente !== false &&
      plato.disponible_efectivo !== false
    ) {
      platosDisponibles.add(idPlato);
    }

    if (Array.isArray(plato.pasos)) {
      for (const paso of plato.pasos) {
        if (!Array.isArray(paso?.ingredientes)) continue;
        for (const ing of paso.ingredientes) {
          if (!ing || typeof ing !== 'object') continue;
          if (ing.disponible === false) continue;
          const idIng = Number(ing.id_ingrediente ?? ing.id);
          if (Number.isInteger(idIng) && idIng > 0) {
            ingredientesDisponibles.add(idIng);
          }
          if (typeof ing.nombre === 'string' && ing.nombre.trim()) {
            nombresIngredientesDisponibles.add(ing.nombre.trim().toLowerCase());
          }
        }
      }
    }
  };

  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item.platos)) {
      for (const plato of item.platos) {
        registrarPlato(plato);
      }
    } else if (item.id_plato != null || item.id != null) {
      registrarPlato(item);
    }
  }

  return {
    platosDisponibles,
    ingredientesDisponibles,
    nombresIngredientesDisponibles,
    menuValido: true,
  };
}

function debeConservarMarca(marca, infoMenu) {
  if (typeof marca === 'number' || typeof marca === 'string') {
    const str = String(marca).trim();
    if (str.startsWith('plato:')) {
      const id = Number(str.slice(6));
      return Number.isInteger(id) && id > 0 && !infoMenu.platosDisponibles.has(id);
    }
    if (str.startsWith('ingrediente:')) {
      const id = Number(str.slice(12));
      return (
        Number.isInteger(id) &&
        id > 0 &&
        !infoMenu.ingredientesDisponibles.has(id)
      );
    }
    const id = Number(str);
    return Number.isInteger(id) && id > 0 && !infoMenu.platosDisponibles.has(id);
  }

  if (marca && typeof marca === 'object') {
    if (marca.tipo === 'ingrediente') {
      const id = Number(marca.id ?? marca.id_ingrediente);
      if (Number.isInteger(id) && id > 0) {
        return !infoMenu.ingredientesDisponibles.has(id);
      }
      if (typeof marca.nombre === 'string' && marca.nombre.trim()) {
        return !infoMenu.nombresIngredientesDisponibles.has(
          marca.nombre.trim().toLowerCase()
        );
      }
      return false;
    }

    const idPlato = Number(marca.id_plato ?? marca.id);
    if (Number.isInteger(idPlato) && idPlato > 0) {
      return !infoMenu.platosDisponibles.has(idPlato);
    }
  }

  return false;
}

/**
 * Calcula las marcas locales de agotado que deben conservarse tras recargar
 * `GET /menu`. Como `GET /menu` solo incluye platos con stock, si un plato
 * vuelve a aparecer en `menuNuevo` (con `disponible !== false`), se limpia su
 * marca local de agotado.
 *
 * Soporta `marcas` como Array (de IDs o de objetos `{ tipo, id, nombre }`), Set
 * o mapa `{ [idPlato]: true }`.
 *
 * @param {Array|Set|object} marcas
 * @param {object|Array} menuNuevo
 * @returns {Array|Set|object}
 */
export function marcasAgotadoTrasRecarga(marcas, menuNuevo) {
  const infoMenu = extraerDisponiblesDeMenu(menuNuevo);

  if (marcas instanceof Set) {
    if (!infoMenu.menuValido) return new Set(marcas);
    return new Set(
      Array.from(marcas).filter((m) => debeConservarMarca(m, infoMenu))
    );
  }

  if (Array.isArray(marcas)) {
    if (!infoMenu.menuValido) return [...marcas];
    return marcas.filter((m) => debeConservarMarca(m, infoMenu));
  }

  if (marcas && typeof marcas === 'object') {
    if (!infoMenu.menuValido) return { ...marcas };
    const resultado = {};
    for (const [clave, valor] of Object.entries(marcas)) {
      if (!valor) continue;
      if (debeConservarMarca(clave, infoMenu)) {
        resultado[clave] = valor;
      }
    }
    return resultado;
  }

  return [];
}

/**
 * Limpia o actualiza las marcas locales de agotado cuando llega un evento
 * `plato:disponibilidad` o `ingrediente:disponibilidad`.
 *
 * @param {Array|Set|object} marcas
 * @param {{ tipo?: 'plato'|'ingrediente', id?: number, id_plato?: number, id_ingrediente?: number, disponible: boolean, nombre?: string|null }} evento
 * @returns {Array|Set|object}
 */
export function actualizarMarcasPorDisponibilidad(marcas, evento = {}) {
  const tipo =
    evento?.tipo === 'ingrediente' || evento?.id_ingrediente != null
      ? 'ingrediente'
      : 'plato';
  const rawId =
    tipo === 'ingrediente'
      ? (evento?.id ?? evento?.id_ingrediente ?? evento?.idIngrediente)
      : (evento?.id ?? evento?.id_plato ?? evento?.idPlato);
  const idNum = Number(rawId);
  const disponible = Boolean(evento?.disponible);

  if (!Number.isInteger(idNum) || idNum <= 0) {
    if (marcas instanceof Set) return new Set(marcas);
    if (Array.isArray(marcas)) return [...marcas];
    if (marcas && typeof marcas === 'object') return { ...marcas };
    return [];
  }

  const coincideMarca = (m) => {
    if (typeof m === 'number' || typeof m === 'string') {
      const str = String(m).trim();
      if (str.startsWith(`${tipo}:`)) {
        return Number(str.slice(tipo.length + 1)) === idNum;
      }
      return tipo === 'plato' && Number(str) === idNum;
    }
    if (m && typeof m === 'object') {
      const tipoM = m.tipo || 'plato';
      const idM = Number(m.id ?? m.id_plato ?? m.id_ingrediente);
      return tipoM === tipo && idM === idNum;
    }
    return false;
  };

  if (marcas instanceof Set) {
    const siguiente = new Set(
      Array.from(marcas).filter((m) => !coincideMarca(m))
    );
    if (!disponible && tipo === 'plato') {
      siguiente.add(idNum);
    }
    return siguiente;
  }

  if (Array.isArray(marcas)) {
    const filtradas = marcas.filter((m) => !coincideMarca(m));
    if (!disponible) {
      const usaNumeros =
        marcas.length > 0 && marcas.every((m) => typeof m === 'number');
      if (usaNumeros && tipo === 'plato') {
        filtradas.push(idNum);
      } else {
        filtradas.push({
          tipo,
          id: idNum,
          nombre: typeof evento?.nombre === 'string' ? evento.nombre : null,
        });
      }
    }
    return filtradas;
  }

  if (marcas && typeof marcas === 'object') {
    const siguiente = { ...marcas };
    if (tipo === 'plato') {
      if (disponible) {
        delete siguiente[idNum];
      } else {
        siguiente[idNum] = true;
      }
    }
    return siguiente;
  }

  return [];
}

/**
 * Devuelve el estado de stock de un plato si el menú informa disponibilidad o pocas unidades.
 *
 * @param {object} plato
 * @returns {'agotado'|'pocas'|'normal'}
 */
export function estadoStockPlato(plato) {
  if (
    !plato ||
    plato.disponible === false ||
    plato.stock_suficiente === false ||
    plato.disponible_efectivo === false
  ) {
    return 'agotado';
  }
  if (plato.pocas_unidades === true) {
    return 'pocas';
  }
  return 'normal';
}

export default {
  MENSAJE_CRUCE_PEDIDO,
  MENSAJE_ERROR_PEDIDO_GENERICO,
  MENSAJE_SIN_STOCK_GENERICO,
  normalizarFaltantes,
  faltantesDelItem,
  resumenFaltantes,
  accionErrorPedido,
  marcasAgotadoTrasRecarga,
  actualizarMarcasPorDisponibilidad,
  estadoStockPlato,
};
