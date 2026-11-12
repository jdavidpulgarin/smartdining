/**
 * Funciones puras y reducer del carrito local para la app móvil.
 */

export const CLAVE_CARRITO_STORAGE = 'smartdining_movil_carrito_v1';
export const CANTIDAD_MIN_LINEA = 1;
export const CANTIDAD_MAX_LINEA = 20;
export const NOTAS_MAX_LINEA = 200;

export const ESTADO_INICIAL_CARRITO = {
  lineas: [],
};

export function calcularSubtotalLinea(linea) {
  if (!linea || typeof linea !== 'object') return 0;
  const precio = Math.max(0, Number(linea.precioUnitario) || 0);
  const cantidad = Math.max(0, Number(linea.cantidad) || 0);
  return precio * cantidad;
}

export function calcularTotalCarrito(lineas = []) {
  if (!Array.isArray(lineas)) return 0;
  return lineas.reduce((acc, linea) => acc + calcularSubtotalLinea(linea), 0);
}

export function calcularTotalUnidades(lineas = []) {
  if (!Array.isArray(lineas)) return 0;
  return lineas.reduce(
    (acc, linea) => acc + Math.max(0, Number(linea?.cantidad) || 0),
    0
  );
}

export function carritoReducer(state = ESTADO_INICIAL_CARRITO, action) {
  if (!action || !action.type) return state;

  switch (action.type) {
    case 'CARGAR_CARRITO': {
      const lineas = Array.isArray(action.payload) ? action.payload : [];
      return { ...state, lineas };
    }

    case 'AGREGAR_LINEA': {
      if (!action.payload) return state;
      const cantidadRaw = Number(action.payload.cantidad) || 1;
      const cantidad = Math.min(
        CANTIDAD_MAX_LINEA,
        Math.max(CANTIDAD_MIN_LINEA, Math.floor(cantidadRaw))
      );
      const notas =
        typeof action.payload.notas === 'string'
          ? action.payload.notas.slice(0, NOTAS_MAX_LINEA)
          : '';
      return {
        ...state,
        lineas: [...state.lineas, { ...action.payload, cantidad, notas }],
      };
    }

    case 'ACTUALIZAR_CANTIDAD': {
      const { id_linea, cantidad } = action.payload || {};
      if (!Number.isFinite(cantidad)) return state;
      const cantEntera = Math.floor(cantidad);
      if (cantEntera <= 0) {
        return {
          ...state,
          lineas: state.lineas.filter((l) => l.id_linea !== id_linea),
        };
      }
      const cantidadAjustada = Math.min(
        CANTIDAD_MAX_LINEA,
        Math.max(CANTIDAD_MIN_LINEA, cantEntera)
      );
      return {
        ...state,
        lineas: state.lineas.map((l) =>
          l.id_linea === id_linea ? { ...l, cantidad: cantidadAjustada } : l
        ),
      };
    }

    case 'ACTUALIZAR_NOTAS': {
      const { id_linea, notas } = action.payload || {};
      const texto = typeof notas === 'string' ? notas.slice(0, NOTAS_MAX_LINEA) : '';
      return {
        ...state,
        lineas: state.lineas.map((l) =>
          l.id_linea === id_linea ? { ...l, notas: texto } : l
        ),
      };
    }

    case 'ELIMINAR_LINEA': {
      const { id_linea } = action.payload || {};
      return {
        ...state,
        lineas: state.lineas.filter((l) => l.id_linea !== id_linea),
      };
    }

    case 'VACIAR_CARRITO': {
      return {
        ...state,
        lineas: [],
      };
    }

    default:
      return state;
  }
}
