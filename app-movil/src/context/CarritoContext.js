import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useMemo,
  useCallback,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CLAVE_CARRITO_STORAGE,
  ESTADO_INICIAL_CARRITO,
  carritoReducer,
  calcularTotalCarrito,
  calcularTotalUnidades,
} from '../utils/carrito';

const CarritoContext = createContext(null);

export function CarritoProvider({ children }) {
  const [state, dispatch] = useReducer(carritoReducer, ESTADO_INICIAL_CARRITO);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    let activo = true;
    AsyncStorage.getItem(CLAVE_CARRITO_STORAGE)
      .then((raw) => {
        if (!activo) return;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            dispatch({ type: 'CARGAR_CARRITO', payload: parsed });
          }
        }
      })
      .catch(() => {
        // Ignorar errores de lectura de almacenamiento
      })
      .finally(() => {
        if (activo) setCargado(true);
      });

    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    if (!cargado) return;
    AsyncStorage.setItem(CLAVE_CARRITO_STORAGE, JSON.stringify(state.lineas)).catch(
      () => {
        // Ignorar errores de escritura de almacenamiento
      }
    );
  }, [state.lineas, cargado]);

  const agregarLinea = useCallback((linea) => {
    dispatch({ type: 'AGREGAR_LINEA', payload: linea });
  }, []);

  const actualizarCantidad = useCallback((id_linea, cantidad) => {
    dispatch({ type: 'ACTUALIZAR_CANTIDAD', payload: { id_linea, cantidad } });
  }, []);

  const actualizarNotas = useCallback((id_linea, notas) => {
    dispatch({ type: 'ACTUALIZAR_NOTAS', payload: { id_linea, notas } });
  }, []);

  const eliminarLinea = useCallback((id_linea) => {
    dispatch({ type: 'ELIMINAR_LINEA', payload: { id_linea } });
  }, []);

  const vaciarCarrito = useCallback(() => {
    dispatch({ type: 'VACIAR_CARRITO' });
  }, []);

  const total = useMemo(() => calcularTotalCarrito(state.lineas), [state.lineas]);
  const totalUnidades = useMemo(
    () => calcularTotalUnidades(state.lineas),
    [state.lineas]
  );

  const value = useMemo(
    () => ({
      lineas: state.lineas,
      total,
      totalUnidades,
      cargado,
      agregarLinea,
      actualizarCantidad,
      actualizarNotas,
      eliminarLinea,
      vaciarCarrito,
    }),
    [
      state.lineas,
      total,
      totalUnidades,
      cargado,
      agregarLinea,
      actualizarCantidad,
      actualizarNotas,
      eliminarLinea,
      vaciarCarrito,
    ]
  );

  return (
    <CarritoContext.Provider value={value}>{children}</CarritoContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useCarrito() {
  const ctx = useContext(CarritoContext);
  if (!ctx) {
    throw new Error('useCarrito debe usarse dentro de CarritoProvider');
  }
  return ctx;
}
