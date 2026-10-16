import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useMesaSession from './useMesaSession';
import { useMesaSocketContext } from '../context/MesaSocketContext';
import { listarPedidosMesa } from '../services/pedidoService';
import {
  normalizarPedido,
  aplicarCambioEstado,
  separarPedidos,
  pedidoPrincipal,
} from '../utils/seguimiento';

const CLAVE_ULTIMO_PEDIDO = 'smartdining_ultimo_pedido';
const MAX_EVENT_IDS = 200;

/**
 * Hook para la gestión y seguimiento en tiempo real de los pedidos de la mesa (J-07).
 *
 * Características:
 * - Carga inicial de pedidos desde la API / pedidos simulados.
 * - Deduplicación de eventos del socket por eventId (últimos 200).
 * - Escucha order:status y order:created en tiempo real.
 * - Re-consulta completa de pedidos al reconectarse el socket.
 * - Gestión de selección entre múltiples pedidos propios.
 * - Soporte para llamar al mesero con cooldown.
 *
 * @param {object|null} [pedidoInicial] - Pedido que viene de navegación (location.state)
 */
export function useSeguimientoMesa(pedidoInicial = null) {
  const { mesa, idMesa, comensal } = useMesaSession();
  const { on: socketOn, estado: estadoSocket, enviar } = useMesaSocketContext();

  const [pedidos, setPedidos] = useState(() => {
    const raw =
      pedidoInicial ||
      (() => {
        try {
          const guardado = sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO);
          return guardado ? JSON.parse(guardado) : null;
        } catch {
          return null;
        }
      })();
    return raw ? [normalizarPedido(raw, comensal)].filter(Boolean) : [];
  });

  const [idSeleccionado, setIdSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [avisoMesero, setAvisoMesero] = useState(null);
  const [cooldownMesero, setCooldownMesero] = useState(0);

  // Buffer circular para deduplicar hasta 200 eventIds
  const eventIdsVistosRef = useRef(new Set());
  const colaIdsRef = useRef([]);

  const esDuplicado = useCallback((eventId) => {
    if (!eventId) return false;
    if (eventIdsVistosRef.current.has(eventId)) return true;
    eventIdsVistosRef.current.add(eventId);
    colaIdsRef.current.push(eventId);
    if (colaIdsRef.current.length > MAX_EVENT_IDS) {
      const viejo = colaIdsRef.current.shift();
      eventIdsVistosRef.current.delete(viejo);
    }
    return false;
  }, []);

  // Carga inicial y recarga
  const recargar = useCallback(async () => {
    try {
      setCargando(true);
      setError(null);
      const lista = await listarPedidosMesa(idMesa);
      const norm = (Array.isArray(lista) ? lista : [])
        .map((p) => normalizarPedido(p, comensal))
        .filter(Boolean);

      setPedidos((prev) => {
        const combinados = [...norm];
        // Conservar pedidos locales recientes que aún no estén en el servidor
        for (const p of prev) {
          if (
            p.id_pedido &&
            !combinados.some(
              (c) => String(c.id_pedido) === String(p.id_pedido)
            )
          ) {
            combinados.unshift(p);
          }
        }
        return combinados;
      });
    } catch (err) {
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [idMesa, comensal]);

  // Montaje y carga inicial
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const lista = await listarPedidosMesa(idMesa);
        if (!activo) return;
        const norm = (Array.isArray(lista) ? lista : [])
          .map((p) => normalizarPedido(p, comensal))
          .filter(Boolean);

        setPedidos((prev) => {
          const combinados = [...norm];
          for (const p of prev) {
            if (
              p.id_pedido &&
              !combinados.some(
                (c) => String(c.id_pedido) === String(p.id_pedido)
              )
            ) {
              combinados.unshift(p);
            }
          }
          return combinados;
        });
      } catch (err) {
        if (activo) setError(err);
      }
    })();

    return () => {
      activo = false;
    };
  }, [idMesa, comensal]);

  // Re-consultar al reconectar el socket
  const estadoAnteriorRef = useRef(estadoSocket);
  useEffect(() => {
    if (
      estadoAnteriorRef.current !== 'conectado' &&
      estadoSocket === 'conectado'
    ) {
      recargar();
    }
    estadoAnteriorRef.current = estadoSocket;
  }, [estadoSocket, recargar]);

  // Escuchar eventos del socket: order:status y order:created
  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaStatus = socketOn('order:status', (data) => {
      if (!data || esDuplicado(data.eventId)) return;
      setPedidos((prev) => aplicarCambioEstado(prev, data));
    });

    const bajaCreated = socketOn('order:created', (data) => {
      if (!data || esDuplicado(data.eventId)) return;
      const nuevo = normalizarPedido(data, comensal);
      if (!nuevo) return;

      setPedidos((prev) => {
        if (
          prev.some(
            (p) => String(p.id_pedido) === String(nuevo.id_pedido)
          )
        ) {
          return prev;
        }
        return [nuevo, ...prev];
      });
    });

    return () => {
      bajaStatus?.();
      bajaCreated?.();
    };
  }, [socketOn, esDuplicado, comensal]);

  // Temporizador para el cooldown de llamar al mesero
  useEffect(() => {
    if (cooldownMesero <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldownMesero((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownMesero]);

  // Función para llamar al mesero (J-07)
  const llamarMesero = useCallback(async () => {
    if (cooldownMesero > 0) return;
    setCooldownMesero(60);
    try {
      if (enviar) {
        const ack = await enviar('mesa:llamar_mesero', {});
        if (ack?.ok) {
          setAvisoMesero('Ya avisamos al mesero. Pronto se acercará a la mesa.');
        } else if (ack?.codigo === 'RATE_LIMIT') {
          setAvisoMesero(
            ack.mensaje || 'Ya avisamos hace poco. El mesero ya viene en camino.'
          );
        } else {
          setAvisoMesero('Ya avisamos al mesero.');
        }
      } else {
        setAvisoMesero('Ya avisamos al mesero. Pronto se acercará a la mesa.');
      }
    } catch (err) {
      if (err?.codigo === 'RATE_LIMIT') {
        setAvisoMesero(
          err.message || 'Ya avisamos hace poco. El mesero ya viene en camino.'
        );
      } else {
        setAvisoMesero('Ya avisamos al mesero.');
      }
    }
    setTimeout(() => {
      setAvisoMesero(null);
    }, 4500);
  }, [cooldownMesero, enviar]);

  const { misPedidos, otrosPedidos } = useMemo(
    () => separarPedidos(pedidos, comensal),
    [pedidos, comensal]
  );

  const pedidoActivo = useMemo(() => {
    if (misPedidos.length > 0) {
      return pedidoPrincipal(misPedidos, idSeleccionado);
    }
    return otrosPedidos[0] || null;
  }, [misPedidos, otrosPedidos, idSeleccionado]);

  // Persistir en sessionStorage el pedido activo para recargas
  useEffect(() => {
    if (pedidoActivo) {
      try {
        sessionStorage.setItem(
          CLAVE_ULTIMO_PEDIDO,
          JSON.stringify(pedidoActivo)
        );
      } catch {
        // Ignorar
      }
    }
  }, [pedidoActivo]);

  return {
    pedidos,
    misPedidos,
    otrosPedidos,
    pedidoActivo,
    setPedidoActivo: setIdSeleccionado,
    cargando,
    error,
    avisoMesero,
    cooldownMesero,
    llamarMesero,
    recargar,
    mesa,
    comensal,
  };
}

export default useSeguimientoMesa;
