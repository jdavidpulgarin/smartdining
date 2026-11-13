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

// oxlint-disable-next-line react/only-export-components
export function extraerIatToken(token) {
  if (typeof token !== 'string' || !token.trim()) return null;
  const partes = token.split('.');
  if (partes.length !== 3 || !partes[1]) return null;
  try {
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const conPadding = base64 + '='.repeat(padLen);
    const json = atob(conPadding);
    const payload = JSON.parse(json);
    return payload?.iat ?? null;
  } catch {
    return null;
  }
}

// oxlint-disable-next-line react/only-export-components
export function calcularClaveSesion(idMesa, token) {
  if (!idMesa) return null;
  const iat = extraerIatToken(token);
  return iat != null ? `${idMesa}:${iat}` : String(idMesa);
}

// oxlint-disable-next-line react/only-export-components
export function procesarOrderCreated(prevLista, data, comensal) {
  const crudo = data?.pedido ?? data;
  if (!crudo) return prevLista;
  const idBuscado = String(crudo.id_pedido ?? crudo.id ?? '');
  const yaExiste = prevLista.some((p) => String(p.id_pedido) === idBuscado);
  const detalles = Array.isArray(crudo.detalles)
    ? crudo.detalles
    : Array.isArray(crudo.items)
      ? crudo.items
      : [];
  const tieneDetalles = detalles.length > 0;

  if (yaExiste) {
    if (tieneDetalles) {
      return reemplazarPedido(prevLista, crudo, comensal);
    }
    return prevLista;
  }
  return incorporarPedido(prevLista, crudo, comensal);
}

// oxlint-disable-next-line react/only-export-components
export function cargarUltimoPedidoGuardado(comensal, claveSesionActual) {
  try {
    const guardado = sessionStorage.getItem(CLAVE_ULTIMO_PEDIDO);
    if (!guardado) return [];
    const datos = JSON.parse(guardado);
    if (!datos) return [];
    // Si viene con metadata de sesión guardada, debe coincidir
    if (datos.__sesion != null && claveSesionActual != null) {
      if (String(datos.__sesion) !== String(claveSesionActual)) {
        return [];
      }
    } else if (claveSesionActual != null && datos.__sesion == null) {
      // Si no tiene metadata de sesión pero tenemos sesión activa, no es verificable
      return [];
    }
    const pedidoLimpio = { ...datos };
    delete pedidoLimpio.__sesion;
    const norm = normalizarPedido(pedidoLimpio, comensal);
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
  const { mesa, idMesa, comensal, valida, token, cargando: cargandoSesion } = useMesaSession();
  const { on: socketOn, estado: estadoSocket, enviar } = useMesaSocketContext();

  const claveSesion = useMemo(
    () => (valida ? calcularClaveSesion(idMesa, token) : null),
    [valida, idMesa, token]
  );

  const [estadoPedidos, setEstadoPedidos] = useState(() => ({
    idMesa: idMesa ?? null,
    claveSesion: valida ? calcularClaveSesion(idMesa, token) : null,
    lista: cargarUltimoPedidoGuardado(comensal, valida ? calcularClaveSesion(idMesa, token) : null),
  }));
  const [idSeleccionado, setIdSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [avisoMesero, setAvisoMesero] = useState(null);
  const [cooldownMesero, setCooldownMesero] = useState(0);

  const eventIdsVistosRef = useRef(new Set());
  const colaIdsRef = useRef([]);

  // Si la clave de sesión cambia o valida pasa a false, vaciar y reiniciar refs
  useEffect(() => {
    if (!valida || !claveSesion) {
      // oxlint-disable-next-line react/set-state-in-effect
      setEstadoPedidos({
        idMesa: null,
        claveSesion: null,
        lista: [],
      });
      setIdSeleccionado(null);
      setAvisoMesero(null);
      eventIdsVistosRef.current.clear();
      colaIdsRef.current = [];
      return;
    }

    // oxlint-disable-next-line react/set-state-in-effect
    setEstadoPedidos((prev) => {
      if (prev.claveSesion !== claveSesion) {
        eventIdsVistosRef.current.clear();
        colaIdsRef.current = [];
        return {
          idMesa,
          claveSesion,
          lista: cargarUltimoPedidoGuardado(comensal, claveSesion),
        };
      }
      return prev;
    });
  }, [valida, claveSesion, idMesa, comensal]);

  const actualizarListaPedidos = useCallback(
    (updater) => {
      setEstadoPedidos((prev) => {
        const sesionCambio =
          claveSesion != null &&
          prev.claveSesion != null &&
          prev.claveSesion !== claveSesion;
        const mesaCambio =
          prev.idMesa != null &&
          idMesa != null &&
          String(prev.idMesa) !== String(idMesa);

        const base = sesionCambio || mesaCambio ? [] : prev.lista;
        return {
          idMesa: idMesa ?? prev.idMesa,
          claveSesion: claveSesion ?? prev.claveSesion,
          lista: updater(base),
        };
      });
    },
    [idMesa, claveSesion]
  );

  const pedidos = useMemo(() => {
    if (!valida || !idMesa || !claveSesion) return [];
    if (
      estadoPedidos.claveSesion != null &&
      estadoPedidos.claveSesion !== claveSesion
    ) {
      return [];
    }
    if (
      estadoPedidos.idMesa != null &&
      String(estadoPedidos.idMesa) !== String(idMesa)
    ) {
      return [];
    }
    return estadoPedidos.lista;
  }, [valida, idMesa, claveSesion, estadoPedidos]);

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
      actualizarListaPedidos((prev) => procesarOrderCreated(prev, data, comensal));
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
        const payloadConSesion = {
          ...pedidoActivo,
          ...(claveSesion ? { __sesion: claveSesion } : {}),
        };
        sessionStorage.setItem(
          CLAVE_ULTIMO_PEDIDO,
          JSON.stringify(payloadConSesion)
        );
      } catch {
        // Ignorar
      }
    }
  }, [pedidoActivo, claveSesion]);

  const registrarPedido = useCallback(
    (pedidoCrudo, { seleccionar = false } = {}) => {
      if (!pedidoCrudo) return;
      actualizarListaPedidos((prev) =>
        incorporarPedido(prev, pedidoCrudo, comensal)
      );
      recargar().catch(() => {});
      const idNuevo = pedidoCrudo.id_pedido ?? pedidoCrudo.id;
      if (seleccionar && idNuevo != null) {
        setIdSeleccionado(idNuevo);
      }
    },
    [comensal, actualizarListaPedidos, recargar]
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
