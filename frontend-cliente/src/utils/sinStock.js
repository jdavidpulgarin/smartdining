import { ErrorApi } from '../services/api';

export const MENSAJE_CRUCE_PEDIDO =
  'Hubo un cruce con otro pedido, vuelve a enviarlo.';
export const MENSAJE_ERROR_PEDIDO_GENERICO =
  'Ocurrió un error al enviar el pedido';

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

  return {
    hayFaltantes: itemsAfectados.length > 0 || faltantesLimpios.length > 0,
    faltantes: faltantesLimpios,
    itemsAfectados,
    idsLineasAfectadas,
    idsPlatosAgotados,
    idsIngredientesAgotados,
    texto,
    mensaje: texto,
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
    const rawFaltantes =
      error?.faltantes ?? error?.data?.faltantes ?? [];
    const resumen = resumenFaltantes(carrito, rawFaltantes);
    const mensaje =
      resumen.texto ||
      'Algunos platos o ingredientes de tu pedido se agotaron. Quítalos para enviar el resto.';

    return {
      tipo: 'sin_stock',
      status: 409,
      motivo: 'sin_stock',
      faltantes: resumen.faltantes,
      itemsAfectados: resumen.itemsAfectados,
      idsLineasAfectadas: resumen.idsLineasAfectadas,
      idsPlatosAgotados: resumen.idsPlatosAgotados,
      idsIngredientesAgotados: resumen.idsIngredientesAgotados,
      mensaje,
      ayuda: 'Quita lo que se acabó para poder enviar el resto de tu pedido.',
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
  normalizarFaltantes,
  faltantesDelItem,
  resumenFaltantes,
  accionErrorPedido,
  estadoStockPlato,
};
