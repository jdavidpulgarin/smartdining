import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useState,
} from 'react';
import { useMesaSession } from '../hooks/useMesaSession';
import { CLAVE_SESION } from '../utils/sesion';
import MesaSocketContext from './MesaSocketContext';
import {
  enriquecerItems,
  agruparPorComensal,
  construirSet,
  construirRemove,
  totalesMesa,
  traducirErrorSocket,
} from '../utils/carritoCompartido';
import { obtenerMenuRaw } from '../services/menuService';

const CarritoContext = createContext(null);

const ARRAY_VACIO = [];

// oxlint-disable-next-line react/only-export-components
export const ESTADO_INICIAL = {
  lineas: [],
};

// oxlint-disable-next-line react/only-export-components
export function obtenerMesaInicial() {
  try {
    if (typeof window !== 'undefined') {
      const sesionGuardada = sessionStorage.getItem(CLAVE_SESION);
      if (sesionGuardada) {
        const parsed = JSON.parse(sesionGuardada);
        if (parsed?.idMesa && !isNaN(Number(parsed.idMesa))) {
          return Number(parsed.idMesa);
        }
      }
    }
  } catch {
    // Si ocurre un error al acceder a sessionStorage o parsear, continuar con null
  }
  return null;
}

// oxlint-disable-next-line react/only-export-components
export function obtenerClaveCarrito(mesa) {
  if (mesa !== null && mesa !== undefined && mesa !== '') {
    return `smartdining_carrito_mesa_${mesa}`;
  }
  return null;
}

// oxlint-disable-next-line react/only-export-components
export function cargarCarritoDeStorage(clave) {
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

// oxlint-disable-next-line react/only-export-components
export function guardarCarritoEnStorage(clave, lineas) {
  if (!clave) return;
  try {
    localStorage.setItem(clave, JSON.stringify(lineas));
  } catch {
    // Si localStorage no está disponible o está lleno, continuar
  }
}

// oxlint-disable-next-line react/only-export-components
export function carritoReducer(state, action) {
  switch (action.type) {
    case 'AGREGAR_LINEA': {
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

// oxlint-disable-next-line react/only-export-components
export function inicializarEstado() {
  const mesaInicial = obtenerMesaInicial();
  const clave = obtenerClaveCarrito(mesaInicial);
  const lineas = cargarCarritoDeStorage(clave);
  return { lineas };
}

export function CarritoProvider({ children }) {
  const { idMesa: mesa } = useMesaSession();
  const mesaSocket = useContext(MesaSocketContext);
  const modo = mesaSocket?.modo || 'local';

  const [state, dispatch] = useReducer(
    carritoReducer,
    ESTADO_INICIAL,
    inicializarEstado
  );
  const mesaInicial = useMemo(() => obtenerMesaInicial(), []);
  const mesaAnteriorRef = useRef(mesaInicial);

  const [menuRaw, setMenuRaw] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    obtenerMenuRaw()
      .then((menu) => {
        if (activo) setMenuRaw(menu);
      })
      .catch((err) => {
        console.error('Error al cargar menú en CarritoContext:', err);
      });
    return () => {
      activo = false;
    };
  }, []);

  // Sincronizar estado cuando la mesa cambia (modo local)
  useEffect(() => {
    if (modo === 'compartido') return;
    if (mesa !== null && mesa !== undefined && mesa !== mesaAnteriorRef.current) {
      mesaAnteriorRef.current = mesa;
      const clave = obtenerClaveCarrito(mesa);
      const lineasGuardadas = cargarCarritoDeStorage(clave);
      dispatch({ type: 'CARGAR_CARRITO', payload: lineasGuardadas });
    }
  }, [mesa, modo]);

  // Persistir en localStorage cuando cambian las líneas (modo local)
  useEffect(() => {
    if (modo === 'compartido') return;
    const clave = obtenerClaveCarrito(mesaAnteriorRef.current);
    if (clave) {
      guardarCarritoEnStorage(clave, state.lineas);
    }
  }, [state.lineas, modo]);

  // Enriquecer ítems del socket con el menú
  const lineasCompartidasEnriquecidas = useMemo(() => {
    if (modo !== 'compartido') return ARRAY_VACIO;
    return enriquecerItems(
      mesaSocket?.carrito?.items || [],
      menuRaw,
      mesaSocket?.comensal
    );
  }, [modo, mesaSocket?.carrito?.items, menuRaw, mesaSocket?.comensal]);

  const { mias: misLineasCompartidas, otros: otrosCompartidos } = useMemo(() => {
    if (modo !== 'compartido') return { mias: ARRAY_VACIO, otros: ARRAY_VACIO };
    return agruparPorComensal(
      lineasCompartidasEnriquecidas,
      mesaSocket?.comensal
    );
  }, [modo, lineasCompartidasEnriquecidas, mesaSocket?.comensal]);

  const totalesCompartidos = useMemo(() => {
    if (modo !== 'compartido') return { mio: 0, mesa: 0, unidades: 0 };
    return totalesMesa(lineasCompartidasEnriquecidas);
  }, [modo, lineasCompartidasEnriquecidas]);

  const totalUnidadesMiasCompartidas = useMemo(() => {
    if (modo !== 'compartido') return 0;
    return misLineasCompartidas.reduce(
      (acc, l) => acc + (Number(l.cantidad) || 0),
      0
    );
  }, [modo, misLineasCompartidas]);

  const totalUnidadesLocales = useMemo(
    () => state.lineas.reduce((acc, l) => acc + (Number(l.cantidad) || 0), 0),
    [state.lineas]
  );

  const totalLocal = useMemo(
    () =>
      state.lineas.reduce(
        (acc, l) =>
          acc + (Number(l.precioUnitario) || 0) * (Number(l.cantidad) || 0),
        0
      ),
    [state.lineas]
  );

  const agregarLinea = useCallback(
    async (linea) => {
      if (modo !== 'compartido') {
        dispatch({ type: 'AGREGAR_LINEA', payload: linea });
        return true;
      }
      if (!mesaSocket?.enviar) return false;
      setEnviando(true);
      setError(null);
      try {
        const payload = construirSet(linea);
        await mesaSocket.enviar('cart:update', payload);
        return true;
      } catch (err) {
        const msg = traducirErrorSocket(null, err);
        setError(msg);
        return false;
      } finally {
        setEnviando(false);
      }
    },
    [modo, mesaSocket]
  );

  const actualizarCantidad = useCallback(
    async (id_linea, cantidad) => {
      if (modo !== 'compartido') {
        dispatch({
          type: 'ACTUALIZAR_CANTIDAD',
          payload: { id_linea, cantidad },
        });
        return true;
      }
      if (!mesaSocket?.enviar) return false;
      setEnviando(true);
      setError(null);
      try {
        const cantNum = Math.floor(Number(cantidad));
        if (cantNum <= 0) {
          const payload = construirRemove(id_linea);
          await mesaSocket.enviar('cart:update', payload);
          return true;
        }
        const itemActual = (mesaSocket?.carrito?.items || []).find(
          (x) => String(x.id_linea) === String(id_linea)
        );
        if (!itemActual) {
          return false;
        }
        const payload = construirSet({
          ...itemActual,
          cantidad: cantNum,
        });
        await mesaSocket.enviar('cart:update', payload);
        return true;
      } catch (err) {
        const msg = traducirErrorSocket(null, err);
        setError(msg);
        return false;
      } finally {
        setEnviando(false);
      }
    },
    [modo, mesaSocket]
  );

  const eliminarLinea = useCallback(
    async (id_linea) => {
      if (modo !== 'compartido') {
        dispatch({ type: 'ELIMINAR_LINEA', payload: { id_linea } });
        return true;
      }
      if (!mesaSocket?.enviar) return false;
      setEnviando(true);
      setError(null);
      try {
        const payload = construirRemove(id_linea);
        await mesaSocket.enviar('cart:update', payload);
        return true;
      } catch (err) {
        const msg = traducirErrorSocket(null, err);
        setError(msg);
        return false;
      } finally {
        setEnviando(false);
      }
    },
    [modo, mesaSocket]
  );

  const vaciarCarrito = useCallback(async () => {
    if (modo !== 'compartido') {
      dispatch({ type: 'VACIAR_CARRITO' });
      return true;
    }
    if (!mesaSocket?.enviar) return false;
    setEnviando(true);
    setError(null);
    try {
      await Promise.all(
        misLineasCompartidas.map((l) =>
          mesaSocket.enviar('cart:update', construirRemove(l.id_linea))
        )
      );
      return true;
    } catch (err) {
      const msg = traducirErrorSocket(null, err);
      setError(msg);
      return false;
    } finally {
      setEnviando(false);
    }
  }, [modo, misLineasCompartidas, mesaSocket]);

  const limpiarError = useCallback(() => setError(null), []);

  const lineas = modo === 'compartido' ? misLineasCompartidas : state.lineas;
  const misLineas = modo === 'compartido' ? misLineasCompartidas : state.lineas;
  const otros = modo === 'compartido' ? otrosCompartidos : ARRAY_VACIO;
  const lineasMesa =
    modo === 'compartido' ? lineasCompartidasEnriquecidas : state.lineas;
  const total = modo === 'compartido' ? totalesCompartidos.mio : totalLocal;
  const totalMio = modo === 'compartido' ? totalesCompartidos.mio : totalLocal;
  const totalMesa = modo === 'compartido' ? totalesCompartidos.mesa : totalLocal;
  const totalUnidades =
    modo === 'compartido' ? totalUnidadesMiasCompartidas : totalUnidadesLocales;
  const totalUnidadesMesa =
    modo === 'compartido' ? totalesCompartidos.unidades : totalUnidadesLocales;

  const value = useMemo(
    () => ({
      modo,
      estadoConexion: mesaSocket?.estado || 'local',
      lineas,
      misLineas,
      otros,
      lineasMesa,
      total,
      totalMio,
      totalMesa,
      totalUnidades,
      totalUnidadesMesa,
      agregarLinea,
      actualizarCantidad,
      eliminarLinea,
      vaciarCarrito,
      enviando,
      error,
      limpiarError,
    }),
    [
      modo,
      mesaSocket?.estado,
      lineas,
      misLineas,
      otros,
      lineasMesa,
      total,
      totalMio,
      totalMesa,
      totalUnidades,
      totalUnidadesMesa,
      agregarLinea,
      actualizarCantidad,
      eliminarLinea,
      vaciarCarrito,
      enviando,
      error,
      limpiarError,
    ]
  );

  return (
    <CarritoContext.Provider value={value}>{children}</CarritoContext.Provider>
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
