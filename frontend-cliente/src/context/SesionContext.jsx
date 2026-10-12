import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { crearSesion } from '../services/sesionService';
import { CLAVE_SESION, leerExpiracionJwt, validarNombre } from '../utils/sesion';

const SesionContext = createContext(null);

const CLAVES_OBSOLETAS = ['smartdining_mesa_session', 'smartdining_apodo'];

function leerSesionAlmacenada() {
  try {
    const crudo = localStorage.getItem(CLAVE_SESION);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (!datos || !datos.token || !datos.idMesa) {
      localStorage.removeItem(CLAVE_SESION);
      return null;
    }

    const expMs = leerExpiracionJwt(datos.token);
    if (expMs !== null && expMs <= Date.now()) {
      localStorage.removeItem(CLAVE_SESION);
      return null;
    }

    return {
      token: datos.token,
      comensal: datos.comensal || '',
      idMesa: Number(datos.idMesa),
      numeroMesa: Number(datos.numeroMesa ?? datos.idMesa),
      expiraEn: datos.expiraEn || null,
    };
  } catch {
    return null;
  }
}

function obtenerEstadoInicial() {
  let tokenUrl = null;
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      if (t && t.trim()) {
        tokenUrl = t.trim();
      }
    }
  } catch {
    // Ignorar error de lectura de URL
  }

  if (tokenUrl) {
    return {
      sesion: leerSesionAlmacenada(),
      tokenQrPendiente: tokenUrl,
      estado: 'pide_nombre',
      error: null,
      enviando: false,
      recienUnido: false,
      motivoCierre: null,
    };
  }

  const sesionGuardada = leerSesionAlmacenada();
  if (sesionGuardada) {
    return {
      sesion: sesionGuardada,
      tokenQrPendiente: null,
      estado: 'activa',
      error: null,
      enviando: false,
      recienUnido: false,
      motivoCierre: null,
    };
  }

  return {
    sesion: null,
    tokenQrPendiente: null,
    estado: 'sin_sesion',
    error: null,
    enviando: false,
    recienUnido: false,
    motivoCierre: null,
  };
}

export function SesionProvider({ children }) {
  const [state, setState] = useState(obtenerEstadoInicial);

  useEffect(() => {
    try {
      for (const clave of CLAVES_OBSOLETAS) {
        localStorage.removeItem(clave);
      }
    } catch {
      // Ignorar si localStorage no está disponible
    }

    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.has('token') || url.searchParams.has('mesa')) {
          url.searchParams.delete('token');
          url.searchParams.delete('mesa');
          const nuevaBusqueda = url.searchParams.toString();
          const nuevaUrl =
            url.pathname + (nuevaBusqueda ? `?${nuevaBusqueda}` : '') + url.hash;
          window.history.replaceState({}, '', nuevaUrl);
        }
      }
    } catch {
      // Ignorar errores de history API
    }
  }, []);

  const cerrarSesion = useCallback((motivo = null) => {
    setState((prev) => {
      const idMesaActual = prev.sesion?.idMesa;
      try {
        localStorage.removeItem(CLAVE_SESION);
        if (idMesaActual !== undefined && idMesaActual !== null) {
          localStorage.removeItem(`smartdining_carrito_mesa_${idMesaActual}`);
        }
      } catch {
        // Ignorar errores de localStorage
      }

      return {
        sesion: null,
        tokenQrPendiente: null,
        estado: 'sin_sesion',
        error: null,
        enviando: false,
        recienUnido: false,
        motivoCierre: motivo,
      };
    });
  }, []);

  const unirse = useCallback(
    async (nombreCrudo) => {
      const validacion = validarNombre(nombreCrudo);
      if (!validacion.valido) {
        const errValidacion = {
          status: 400,
          motivo: 'formato_nombre',
          mensaje: validacion.error,
          campo: 'comensal',
        };
        setState((prev) => ({
          ...prev,
          estado: 'pide_nombre',
          error: errValidacion,
          enviando: false,
        }));
        return { ok: false, error: errValidacion };
      }

      const tokenQr = state.tokenQrPendiente;
      if (!tokenQr) {
        const errSinQr = {
          status: 401,
          motivo: 'formato',
          mensaje: 'No hay un código QR activo para validar.',
          campo: null,
        };
        setState((prev) => ({
          ...prev,
          estado: 'pide_nombre',
          error: errSinQr,
          enviando: false,
        }));
        return { ok: false, error: errSinQr };
      }

      setState((prev) => ({
        ...prev,
        enviando: true,
        error: null,
      }));

      try {
        const respuesta = await crearSesion(tokenQr, validacion.nombre);
        const nuevaSesion = {
          token: respuesta.token,
          comensal: respuesta.comensal || validacion.nombre,
          idMesa: Number(respuesta.mesa?.id_mesa),
          numeroMesa: Number(respuesta.mesa?.numero ?? respuesta.mesa?.id_mesa),
          expiraEn: respuesta.expira_en || null,
        };

        try {
          localStorage.setItem(CLAVE_SESION, JSON.stringify(nuevaSesion));
        } catch {
          // Ignorar si localStorage no está disponible
        }

        setState({
          sesion: nuevaSesion,
          tokenQrPendiente: null,
          estado: 'activa',
          error: null,
          enviando: false,
          recienUnido: true,
          motivoCierre: null,
        });

        return { ok: true, sesion: nuevaSesion };
      } catch (err) {
        const errorFormateado = {
          status: err?.status ?? 0,
          motivo: err?.motivo ?? null,
          mensaje: err?.mensaje || 'Ocurrió un error, intenta de nuevo',
          campo: err?.campo ?? null,
        };

        setState((prev) => ({
          ...prev,
          estado: 'pide_nombre',
          error: errorFormateado,
          enviando: false,
        }));

        return { ok: false, error: errorFormateado };
      }
    },
    [state.tokenQrPendiente]
  );

  const limpiarError = useCallback(() => {
    setState((prev) => (prev.error ? { ...prev, error: null } : prev));
  }, []);

  const value = useMemo(
    () => ({
      sesion: state.sesion,
      tokenQrPendiente: state.tokenQrPendiente,
      estado: state.estado,
      error: state.error,
      enviando: state.enviando,
      recienUnido: state.recienUnido,
      motivoCierre: state.motivoCierre,
      unirse,
      cerrarSesion,
      limpiarError,
    }),
    [state, unirse, cerrarSesion, limpiarError]
  );

  return (
    <SesionContext.Provider value={value}>{children}</SesionContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useSesion() {
  const context = useContext(SesionContext);
  if (!context) {
    throw new Error('useSesion debe usarse dentro de un SesionProvider');
  }
  return context;
}
