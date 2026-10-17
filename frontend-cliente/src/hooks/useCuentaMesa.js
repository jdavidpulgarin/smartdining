import { useState, useEffect, useCallback, useRef } from 'react';
import { useSesion } from '../context/SesionContext';
import { useMesaSocket } from '../context/MesaSocketContext';
import { obtenerCuenta } from '../services/cuentaService';
import { normalizarCuenta, aplicarPagoConfirmado } from '../utils/cuenta';

/**
 * Hook para cargar y sincronizar la cuenta de la mesa en tiempo real (J-08).
 *
 * Escucha payment:confirmed y order:created para actualizar saldos y comensales.
 * Deduplica eventos usando un buffer circular de 200 eventId.
 *
 * @returns {{
 *   cuenta: object|null,
 *   cargando: boolean,
 *   error: Error|null,
 *   recargar: () => Promise<void>,
 *   idMesa: number|null,
 *   comensal: string|null,
 * }}
 */
export function useCuentaMesa() {
  const { sesion } = useSesion();
  const { on: socketOn, estado: estadoSocket } = useMesaSocket();

  const idMesa = sesion?.idMesa ?? 5;
  const comensal = sesion?.comensal || '';

  const [cuenta, setCuenta] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // Buffer circular para deduplicación de eventos
  const eventosVistos = useRef(new Set());
  const ordenEventos = useRef([]);

  const esDuplicado = useCallback((eventId) => {
    if (!eventId) return false;
    if (eventosVistos.current.has(eventId)) return true;

    if (ordenEventos.current.length >= 200) {
      const masViejo = ordenEventos.current.shift();
      eventosVistos.current.delete(masViejo);
    }
    ordenEventos.current.push(eventId);
    eventosVistos.current.add(eventId);
    return false;
  }, []);

  const cargarCuenta = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await obtenerCuenta(idMesa);
      const normalizada = normalizarCuenta(data, comensal);
      setCuenta(normalizada);
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [idMesa, comensal]);

  // Carga inicial al montar el hook
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const data = await obtenerCuenta(idMesa);
        if (!activo) return;
        setCuenta(normalizarCuenta(data, comensal));
      } catch (err) {
        if (activo) setError(err);
      } finally {
        if (activo) setCargando(false);
      }
    })();

    return () => {
      activo = false;
    };
  }, [idMesa, comensal]);

  // Re-cargar al reconectar el socket
  const estadoAnteriorRef = useRef(estadoSocket);
  useEffect(() => {
    if (
      estadoAnteriorRef.current !== 'conectado' &&
      estadoSocket === 'conectado'
    ) {
      cargarCuenta();
    }
    estadoAnteriorRef.current = estadoSocket;
  }, [estadoSocket, cargarCuenta]);

  // Escuchar eventos en vivo del socket
  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaPayment = socketOn('payment:confirmed', (evento) => {
      if (!evento || esDuplicado(evento.eventId)) return;

      if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
        import('../services/cuentaSimulada').then(({ registrarPagoSimulado }) => {
          registrarPagoSimulado(evento);
        });
        setCuenta((prev) => (prev ? aplicarPagoConfirmado(prev, evento) : prev));
      } else {
        cargarCuenta();
      }
    });

    const bajaCreated = socketOn('order:created', (data) => {
      if (!data || esDuplicado(data.eventId)) return;

      if (import.meta.env.DEV && import.meta.env.VITE_MODO_SIMULADO === 'true') {
        import('../services/cuentaSimulada').then(({ agregarPedidoACuentaSimulada }) => {
          agregarPedidoACuentaSimulada(data.pedido || data);
          cargarCuenta();
        });
      } else {
        cargarCuenta();
      }
    });

    return () => {
      bajaPayment?.();
      bajaCreated?.();
    };
  }, [socketOn, esDuplicado, cargarCuenta]);

  return {
    cuenta,
    cargando,
    error,
    recargar: cargarCuenta,
    idMesa,
    comensal,
  };
}

export default useCuentaMesa;
