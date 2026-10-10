import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useMesaSession } from '../hooks/useMesaSession';

const CarritoContext = createContext(null);

const ESTADO_INICIAL = {
  lineas: [],
};

function obtenerMesaInicial() {
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const mesaParam = params.get('mesa');
      if (mesaParam && !isNaN(Number(mesaParam))) {
        return Number(mesaParam);
      }
      const sesionGuardada = localStorage.getItem('smartdining_mesa_session');
      if (sesionGuardada) {
        const parsed = JSON.parse(sesionGuardada);
        if (parsed?.mesa && !isNaN(Number(parsed.mesa))) {
          return Number(parsed.mesa);
        }
      }
    }
  } catch {
    // Si ocurre un error al acceder a localStorage o parsear, continuar con null
  }
  return null;
}

function obtenerClaveCarrito(mesa) {
  if (mesa !== null && mesa !== undefined && mesa !== '') {
    return `smartdining_carrito_mesa_${mesa}`;
  }
  return null;
}

function cargarCarritoDeStorage(clave) {
  if (!clave) return [];
  try {
    const raw = localStorage.getItem(clave);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.lineas)) {
      return parsed.lineas;
    }
    return [];
  } catch {
    return [];
  }
}

function guardarCarritoEnStorage(clave, lineas) {
  if (!clave) return;
  try {
    localStorage.setItem(clave, JSON.stringify(lineas));
  } catch {
    // Si localStorage no está disponible o está lleno, continuar
  }
}

function carritoReducer(state, action) {
  switch (action.type) {
    case 'AGREGAR_LINEA': {
      // Cada adición desde el modal genera una línea independiente con su propio id_linea
      return {
        ...state,
        lineas: [...state.lineas, action.payload],
      };
    }

    case 'ACTUALIZAR_CANTIDAD': {
      const { id_linea, cantidad } = action.payload;
      if (!Number.isFinite(cantidad)) return state;
      const cantidadAjustada = Math.min(20, Math.max(1, Math.floor(cantidad)));
      return {
        ...state,
        lineas: state.lineas.map((l) =>
          l.id_linea === id_linea ? { ...l, cantidad: cantidadAjustada } : l
        ),
      };
    }

    case 'ELIMINAR_LINEA': {
      const { id_linea } = action.payload;
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

    case 'CARGAR_CARRITO': {
      return {
        ...state,
        lineas: Array.isArray(action.payload) ? action.payload : [],
      };
    }

    default:
      return state;
  }
}

function inicializarEstado() {
  const mesaInicial = obtenerMesaInicial();
  const clave = obtenerClaveCarrito(mesaInicial);
  const lineas = cargarCarritoDeStorage(clave);
  return { lineas };
}

export function CarritoProvider({ children }) {
  const { mesa } = useMesaSession();
  const [state, dispatch] = useReducer(carritoReducer, ESTADO_INICIAL, inicializarEstado);
  const mesaInicial = useMemo(() => obtenerMesaInicial(), []);
  const mesaAnteriorRef = useRef(mesaInicial);

  // Sincronizar estado cuando la mesa cambia de valor numérico
  useEffect(() => {
    if (mesa !== null && mesa !== undefined && mesa !== mesaAnteriorRef.current) {
      mesaAnteriorRef.current = mesa;
      const clave = obtenerClaveCarrito(mesa);
      const lineasGuardadas = cargarCarritoDeStorage(clave);
      dispatch({ type: 'CARGAR_CARRITO', payload: lineasGuardadas });
    }
  }, [mesa]);

  // Persistir en localStorage cuando cambian las líneas
  useEffect(() => {
    const clave = obtenerClaveCarrito(mesaAnteriorRef.current);
    if (clave) {
      guardarCarritoEnStorage(clave, state.lineas);
    }
  }, [state.lineas]);

  const agregarLinea = useCallback((linea) => {
    dispatch({ type: 'AGREGAR_LINEA', payload: linea });
  }, []);

  const actualizarCantidad = useCallback((id_linea, cantidad) => {
    dispatch({ type: 'ACTUALIZAR_CANTIDAD', payload: { id_linea, cantidad } });
  }, []);

  const eliminarLinea = useCallback((id_linea) => {
    dispatch({ type: 'ELIMINAR_LINEA', payload: { id_linea } });
  }, []);

  const vaciarCarrito = useCallback(() => {
    dispatch({ type: 'VACIAR_CARRITO' });
  }, []);

  const lineas = state.lineas;

  const totalUnidades = useMemo(
    () => lineas.reduce((acc, l) => acc + (Number(l.cantidad) || 0), 0),
    [lineas]
  );

  const total = useMemo(
    () =>
      lineas.reduce(
        (acc, l) =>
          acc + (Number(l.precioUnitario) || 0) * (Number(l.cantidad) || 0),
        0
      ),
    [lineas]
  );

  const value = useMemo(
    () => ({
      lineas,
      totalUnidades,
      total,
      agregarLinea,
      actualizarCantidad,
      eliminarLinea,
      vaciarCarrito,
    }),
    [lineas, totalUnidades, total, agregarLinea, actualizarCantidad, eliminarLinea, vaciarCarrito]
  );

  return (
    <CarritoContext.Provider value={value}>
      {children}
    </CarritoContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useCarrito() {
  const context = useContext(CarritoContext);
  if (!context) {
    throw new Error('useCarrito debe ser usado dentro de un CarritoProvider');
  }
  return context;
}
