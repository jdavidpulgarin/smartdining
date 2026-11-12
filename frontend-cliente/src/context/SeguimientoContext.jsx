import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import useMesaSession from '../hooks/useMesaSession';
import { useMesaSocketContext } from './MesaSocketContext';
import { listarPedidosMesa, cancelarItem } from '../services/pedidoService';
import {
  CLAVE_ULTIMO_PEDIDO,
  normalizarPedido,
  aplicarCambioEstado,
  aplicarItemCancelado,
  incorporarPedido,
  reemplazarPedido,
  separarPedidos,
  pedidoPrincipal,
} from '../utils/seguimiento';

const MAX_EVENT_IDS = 200;

const SeguimientoContext = createContext(null);

function cargarUltimoPedidoGuardado(comensal) {
  try {
    const guardado = sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO);
    if (!guardado) return [];
    const norm = normalizarPedido(JSON.parse(guardado), comensal);
    return norm ? [norm] : [];
  } catch {
    return [];
  }
}

/**
 * Proveedor compartido de seguimiento de pedidos de la mesa (J-07, J-14).
 *
 * Mantiene una única lista reactiva de pedidos para `Header`, `Seguimiento`
 * y cualquier pantalla dentro de `Layout`, de modo que `quitarPlato` (200),
 * `item:cancelado` y `order:status` actualicen al instante el contador del
 * encabezado sin recargar la página.
 */
export function SeguimientoProvider({ children }) {
  const { mesa, idMesa, comensal, valida, cargando: cargandoSesion } = useMesaSession();
  const { on: socketOn, estado: estadoSocket, enviar } = useMesaSocketContext();

  const [estadoPedidos, setEstadoPedidos] = useState(() => ({
    idMesa: null,
    lista: cargarUltimoPedidoGuardado(comensal),
  }));
  const [idSeleccionado, setIdSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [avisoMesero, setAvisoMesero] = useState(null);
  const [cooldownMesero, setCooldownMesero] = useState(0);

  const eventIdsVistosRef = useRef(new Set());
  const colaIdsRef = useRef([]);

  const actualizarListaPedidos = useCallback(
    (updater) => {
      setEstadoPedidos((prev) => {
        const base =
          prev.idMesa != null &&
          idMesa != null &&
          String(prev.idMesa) !== String(idMesa)
            ? []
            : prev.lista;
        return {
          idMesa: idMesa ?? prev.idMesa,
          lista: updater(base),
        };
      });
    },
    [idMesa]
  );

  const pedidos = useMemo(() => {
    if (!valida || !idMesa) return [];
    if (
      estadoPedidos.idMesa != null &&
      String(estadoPedidos.idMesa) !== String(idMesa)
    ) {
      return [];
    }
    return estadoPedidos.lista;
  }, [valida, idMesa, estadoPedidos]);

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

  const recargar = useCallback(async () => {
    if (!valida || !idMesa) return;
    try {
      setCargando(true);
      setError(null);
      const lista = await listarPedidosMesa(idMesa);
      const norm = (Array.isArray(lista) ? lista : [])
        .map((p) => normalizarPedido(p, comensal))
        .filter(Boolean);

      actualizarListaPedidos((prev) => {
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
      setError(err);
    } finally {
      setCargando(false);
    }
  }, [valida, idMesa, comensal, actualizarListaPedidos]);

  useEffect(() => {
    if (cargandoSesion || !valida || !idMesa) return undefined;

    let activo = true;
    (async () => {
      try {
        const lista = await listarPedidosMesa(idMesa);
        if (!activo) return;
        const norm = (Array.isArray(lista) ? lista : [])
          .map((p) => normalizarPedido(p, comensal))
          .filter(Boolean);

        actualizarListaPedidos((prev) => {
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
  }, [cargandoSesion, valida, idMesa, comensal, actualizarListaPedidos]);

  const estadoAnteriorRef = useRef(estadoSocket);
  useEffect(() => {
    if (
      valida &&
      idMesa &&
      estadoAnteriorRef.current !== 'conectado' &&
      estadoSocket === 'conectado'
    ) {
      recargar();
    }
    estadoAnteriorRef.current = estadoSocket;
  }, [valida, idMesa, estadoSocket, recargar]);

  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaStatus = socketOn('order:status', (data) => {
      if (!data || esDuplicado(data.eventId)) return;
      actualizarListaPedidos((prev) => aplicarCambioEstado(prev, data));
    });

    const bajaCreated = socketOn('order:created', (data) => {
      if (!data || esDuplicado(data.eventId)) return;
      actualizarListaPedidos((prev) => incorporarPedido(prev, data, comensal));
    });

    const bajaItemCancelado = socketOn('item:cancelado', (data) => {
      if (!data || esDuplicado(data.eventId)) return;
      actualizarListaPedidos((prev) => aplicarItemCancelado(prev, data));
    });

    return () => {
      bajaStatus?.();
      bajaCreated?.();
      bajaItemCancelado?.();
    };
  }, [socketOn, esDuplicado, comensal, actualizarListaPedidos]);

  useEffect(() => {
    if (cooldownMesero <= 0) return undefined;
    const timer = setInterval(() => {
      setCooldownMesero((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownMesero]);

  const llamarMesero = useCallback(async () => {
    if (cooldownMesero > 0) return;
    setCooldownMesero(60);
    try {
      if (enviar) {
        const ack = await enviar('mesa:llamar_mesero', {});
        if (ack?.ok) {
          setAvisoMesero({
            mensaje: 'Ya avisamos al mesero. Pronto se acercará a la mesa.',
            tipo: 'exito',
          });
        } else if (ack?.codigo === 'RATE_LIMIT') {
          setAvisoMesero({
            mensaje:
              ack.mensaje || 'La mesa ya llamó al mesero; espera 60 s',
            tipo: 'limite',
          });
        } else {
          setAvisoMesero({
            mensaje: 'No pudimos conectar con el mesero. Intenta en un momento.',
            tipo: 'error',
          });
        }
      } else {
        setAvisoMesero({
          mensaje: 'Ya avisamos al mesero. Pronto se acercará a la mesa.',
          tipo: 'exito',
        });
      }
    } catch (err) {
      if (err?.codigo === 'RATE_LIMIT') {
        setAvisoMesero({
          mensaje:
            err.message || 'La mesa ya llamó al mesero; espera 60 s',
          tipo: 'limite',
        });
      } else {
        setAvisoMesero({
          mensaje: 'No pudimos conectar con el mesero. Intenta en un momento.',
          tipo: 'error',
        });
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

  const registrarPedido = useCallback(
    (pedidoCrudo, { seleccionar = false } = {}) => {
      if (!pedidoCrudo) return;
      actualizarListaPedidos((prev) =>
        incorporarPedido(prev, pedidoCrudo, comensal)
      );
      const idNuevo = pedidoCrudo.id_pedido ?? pedidoCrudo.id;
      if (seleccionar && idNuevo != null) {
        setIdSeleccionado(idNuevo);
      }
    },
    [comensal, actualizarListaPedidos]
  );

  const quitarPlato = useCallback(
    async (idPedido, idDetalle) => {
      const respuesta = await cancelarItem(idPedido, idDetalle);
      const pedidoActualizado = respuesta?.pedido || respuesta;
      if (pedidoActualizado) {
        actualizarListaPedidos((prev) =>
          reemplazarPedido(prev, pedidoActualizado, comensal)
        );
        if (pedidoActualizado.id_pedido != null) {
          setIdSeleccionado(pedidoActualizado.id_pedido);
        }
      }
      return pedidoActualizado;
    },
    [comensal, actualizarListaPedidos]
  );

  const valor = useMemo(
    () => ({
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
      quitarPlato,
      registrarPedido,
      mesa,
      comensal,
    }),
    [
      pedidos,
      misPedidos,
      otrosPedidos,
      pedidoActivo,
      cargando,
      error,
      avisoMesero,
      cooldownMesero,
      llamarMesero,
      recargar,
      quitarPlato,
      registrarPedido,
      mesa,
      comensal,
    ]
  );

  return (
    <SeguimientoContext.Provider value={valor}>
      {children}
    </SeguimientoContext.Provider>
  );
}

// oxlint-disable-next-line react/only-export-components
export function useSeguimientoContext() {
  return useContext(SeguimientoContext);
}

export default SeguimientoContext;
