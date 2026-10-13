import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { setManejadorSesionInvalida } from '../services/api';
import { crearSesion } from '../services/sesionService';
import { CLAVE_SESION, leerExpiracionJwt, validarNombre } from '../utils/sesion';

const SesionContext = createContext(null);

const CLAVES_OBSOLETAS = [
  'smartdining_mesa_session',
  'smartdining_apodo',
  CLAVE_SESION,
];

function leerSesionAlmacenada() {
  try {
    const crudo = sessionStorage.getItem(CLAVE_SESION);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (!datos || !datos.token || !datos.idMesa) {
      sessionStorage.removeItem(CLAVE_SESION);
      return null;
    }

    const expMs = leerExpiracionJwt(datos.token);
    if (expMs !== null && expMs <= Date.now()) {
      sessionStorage.removeItem(CLAVE_SESION);
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
  const navigate = useNavigate();
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
        sessionStorage.removeItem(CLAVE_SESION);
      } catch {
        // Ignorar errores de sessionStorage
      }
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

  /**
   * Cierra la sesión actual, limpia el carrito de la mesa y redirige a /despedida.
   * La actividad J-06 también invocará despedir(motivo) al recibir el evento
   * `mesa:liberada` del socket cuando la cuenta quede pagada o el restaurante libere la mesa.
   */
  const despedir = useCallback(
    (motivo = null) => {
      cerrarSesion(motivo);
      navigate('/despedida', { replace: true, state: { motivo } });
    },
    [cerrarSesion, navigate]
  );

  useEffect(() => {
    setManejadorSesionInvalida((motivo) => {
      despedir(motivo);
    });
    return () => {
      setManejadorSesionInvalida(null);
    };
  }, [despedir]);

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
          sessionStorage.setItem(CLAVE_SESION, JSON.stringify(nuevaSesion));
        } catch {
          // Ignorar si sessionStorage no está disponible
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
      despedir,
      limpiarError,
    }),
    [state, unirse, cerrarSesion, despedir, limpiarError]
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
