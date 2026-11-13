import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSesion } from './SesionContext';
import { crearClienteMesa, aliasDelToken } from '../services/clienteMesa';
import { urlsServidor } from '../utils/urlsServidor';
import { crearRegistroOyentes } from '../utils/registroOyentes';

const MesaSocketContext = createContext(null);

const CARRITO_VACIO = { version: 0, items: [] };

// oxlint-disable-next-line react/only-export-components
export function validarPresencia(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (
    !Array.isArray(payload.comensales) ||
    !payload.comensales.every((x) => typeof x === 'string')
  ) {
    return null;
  }
  if (
    !Array.isArray(payload.pagaron) ||
    !payload.pagaron.every((x) => typeof x === 'string')
  ) {
    return null;
  }
  if (typeof payload.total !== 'number' || !Number.isFinite(payload.total)) {
    return null;
  }
  let sin_celular = [];
  if (payload.sin_celular !== undefined) {
    if (
      !Array.isArray(payload.sin_celular) ||
      !payload.sin_celular.every((x) => typeof x === 'string')
    ) {
      return null;
    }
    sin_celular = payload.sin_celular;
  }

  return {
    comensales: payload.comensales,
    pagaron: payload.pagaron,
    total: payload.total,
    sin_celular,
  };
}

// oxlint-disable-next-line react/only-export-components
export function esModoCompartido(token, socketUrl) {
  if (!token || !socketUrl) return false;
  if (
    import.meta.env.DEV &&
    typeof token === 'string' &&
    token.endsWith('.simulada')
  ) {
    return false;
  }
  return true;
}

// oxlint-disable-next-line react/only-export-components
export function registrarOyentesPrimerPlano(
  callback,
  tiempoDebounceMs = 300,
  entorno = {}
) {
  const doc =
    entorno.document !== undefined
      ? entorno.document
      : typeof document !== 'undefined'
        ? document
        : null;
  const win =
    entorno.window !== undefined
      ? entorno.window
      : typeof window !== 'undefined'
        ? window
        : null;

  let timer = null;

  const disparar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, tiempoDebounceMs);
  };

  const onVisibilityChange = () => {
    if (doc?.visibilityState === 'visible') {
      disparar();
    }
  };

  const onPageShow = (event) => {
    if (event?.persisted || event?.persisted === undefined) {
      disparar();
    }
  };

  const onOnline = () => {
    disparar();
  };

  doc?.addEventListener?.('visibilitychange', onVisibilityChange);
  win?.addEventListener?.('pageshow', onPageShow);
  win?.addEventListener?.('online', onOnline);

  return () => {
    if (timer) clearTimeout(timer);
    doc?.removeEventListener?.('visibilitychange', onVisibilityChange);
    win?.removeEventListener?.('pageshow', onPageShow);
    win?.removeEventListener?.('online', onOnline);
  };
}

export function MesaSocketProvider({ children }) {
  const { sesion, despedir } = useSesion();
  const token = sesion?.token;
  const socketUrl = urlsServidor().socket;

  const modo = useMemo(
    () => (esModoCompartido(token, socketUrl) ? 'compartido' : 'local'),
    [token, socketUrl]
  );

  const clienteRef = useRef(null);
  const registro = useMemo(() => crearRegistroOyentes(), []);
  const [estado, setEstado] = useState(
    modo === 'compartido' ? 'conectando' : 'local'
  );
  const [carrito, setCarrito] = useState(CARRITO_VACIO);
  const [presencia, setPresencia] = useState(null);
  const [errorMesaLlena, setErrorMesaLlena] = useState(null);
  const [resync, setResync] = useState(0);

  useEffect(() => {
    const darDeBaja = registrarOyentesPrimerPlano(() => {
      const cliente = clienteRef.current;
      if (cliente?.socket && !cliente.socket.connected) {
        try {
          cliente.socket.connect();
        } catch {
          // ignora errores síncronos de llamada
        }
      }
      setResync((c) => c + 1);
    }, 300);

    return darDeBaja;
  }, []);

  const despedirRef = useRef(despedir);
  useEffect(() => {
    despedirRef.current = despedir;
  }, [despedir]);

  useEffect(() => {
    if (modo !== 'compartido' || !token || !socketUrl) {
      return undefined;
    }

    const nuevoCliente = crearClienteMesa({ url: socketUrl, token });
    clienteRef.current = nuevoCliente;
    registro.conectar(nuevoCliente);

    const bajaPresencia = nuevoCliente.on('mesa:presencia', (ev) => {
      const datos = validarPresencia(ev);
      if (datos) {
        setPresencia(datos);
      }
    });

    const bajas = [
      bajaPresencia,
      nuevoCliente.on('estado', (nuevoEstado) => {
        setEstado(nuevoEstado);
      }),
      nuevoCliente.on('carrito', (nuevoCarrito) => {
        setCarrito(nuevoCarrito);
      }),
      nuevoCliente.on('sesion_cerrada', (motivo) => {
        if (motivo === 'MESA_LIBERADA') return;
        despedirRef.current?.(motivo);
      }),
      nuevoCliente.on('mesa:liberada', (ev) => {
        despedirRef.current?.(ev?.motivo || 'liberada');
      }),
    ];

    const socket = nuevoCliente.socket;
    const manejarConnectError = (err) => {
      if (err?.message === 'MESA_LLENA') {
        setErrorMesaLlena('La mesa está llena, intenta en un momento');
      }
    };
    socket.on('connect_error', manejarConnectError);

    return () => {
      socket.off('connect_error', manejarConnectError);
      bajas.forEach((baja) => baja());
      registro.desconectar();
      nuevoCliente.cerrar();
      clienteRef.current = null;
      setEstado('local');
      setCarrito(CARRITO_VACIO);
      setPresencia(null);
      setErrorMesaLlena(null);
    };
  }, [modo, token, socketUrl, registro]);

  const enviar = useCallback(
    (evento, payload) => {
      const clienteActual = clienteRef.current;
      if (modo !== 'compartido' || !clienteActual) {
        return Promise.reject(
          Object.assign(new Error('Sin conexión compartida a la mesa'), {
            codigo: 'MODO_LOCAL',
          })
        );
      }
      return clienteActual.enviar(evento, payload);
    },
    [modo]
  );

  const on = useCallback(
    (evento, fn) => registro.agregar(evento, fn),
    [registro]
  );

  const comensal = useMemo(() => {
    if (token) {
      const aliasJwt = aliasDelToken(token);
      if (aliasJwt) return aliasJwt;
    }
    return sesion?.comensal || null;
  }, [token, sesion?.comensal]);

  const value = useMemo(
    () => ({
      estado,
      carrito,
      presencia,
      comensal,
      enviar,
      on,
      modo,
      errorMesaLlena,
      resync,
    }),
    [
      estado,
      carrito,
      presencia,
      comensal,
      enviar,
      on,
      modo,
      errorMesaLlena,
      resync,
    ]
  );

  return (
    <MesaSocketContext.Provider value={value}>
      {children}
    </MesaSocketContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useMesaSocketContext() {
  const context = useContext(MesaSocketContext);
  if (!context) {
    throw new Error(
      'useMesaSocketContext debe usarse dentro de un MesaSocketProvider'
    );
  }
  return context;
}

// oxlint-disable-next-line react/only-export-components
export const useMesaSocket = useMesaSocketContext;

export default MesaSocketContext;
