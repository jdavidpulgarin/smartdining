import { useState, useEffect, useRef, useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Header from './Header';
import { useMesaSession } from '../../hooks/useMesaSession';
import useSeguimientoMesa from '../../hooks/useSeguimientoMesa';
import { useCarrito } from '../../context/CarritoContext';
import { useMesaSocketContext } from '../../context/MesaSocketContext';
import {
  formatearMensajePedidoCreado,
  formatearMensajeItemCancelado,
} from '../../utils/notificacionesMesa';
import { esPedidoMio, resumenPedidosActivos } from '../../utils/seguimiento';
import { textoPagoConfirmado } from '../../utils/cuenta';
import { crearDeduplicador } from '../../utils/deduplicador';

function Layout({ children }) {
  const location = useLocation();
  const rutaActual = location?.pathname || '';
  const esComanda =
    rutaActual === '/menu' ||
    rutaActual === '/carrito' ||
    rutaActual === '/seguimiento' ||
    rutaActual.startsWith('/armar/');
  const { mesa, comensal, valida, cargando, motivoCierre } = useMesaSession();
  const { misPedidos } = useSeguimientoMesa();
  const resumen = resumenPedidosActivos(misPedidos);
  const estadoPrincipal = resumen?.estadoPrincipal;
  const esRojoSeguimiento =
    rutaActual === '/seguimiento' &&
    (estadoPrincipal === 'en_preparacion' || estadoPrincipal === 'entregado');
  const { totalUnidades, avisosMenu = [], descartarAvisosMenu } = useCarrito();
  const { on: socketOn } = useMesaSocketContext();

  const [toastPedido, setToastPedido] = useState(null);
  const timerRef = useRef(null);
  const deduplicador = useMemo(
    () => crearDeduplicador({ capacidad: 200 }),
    []
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaCreated = socketOn('order:created', (data) => {
      if (!data || deduplicador.visto(data.eventId)) return;
      const mensaje = formatearMensajePedidoCreado(data, comensal);
      if (mensaje) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToastPedido({ tipo: 'created', mensaje });
        timerRef.current = setTimeout(() => {
          setToastPedido(null);
        }, 5000);
      }
    });

    const bajaStatus = socketOn('order:status', (data) => {
      if (!data || deduplicador.visto(data.eventId)) return;
      const estadoNorm = String(data.estado || '').toLowerCase();
      if (estadoNorm === 'listo' && esPedidoMio(data.id_pedido, comensal)) {
        const codigoRaw =
          data.codigo_pedido ||
          (data.id_pedido ? `PED-${data.id_pedido}` : '');
        const codigo = codigoRaw
          ? codigoRaw.startsWith('#')
            ? codigoRaw
            : `#${codigoRaw}`
          : 'tu orden';
        const mensaje = `¡Tu pedido ${codigo} sale caliente!`;

        if (timerRef.current) clearTimeout(timerRef.current);
        setToastPedido({ tipo: 'sale_caliente', mensaje });
        timerRef.current = setTimeout(() => {
          setToastPedido(null);
        }, 5000);
      }
    });

    const bajaPayment = socketOn('payment:confirmed', (data) => {
      if (!data || deduplicador.visto(data.eventId)) return;
      const mensaje = textoPagoConfirmado(data, comensal);
      if (mensaje) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToastPedido({ tipo: 'pago', mensaje });
        timerRef.current = setTimeout(() => {
          setToastPedido(null);
        }, 5000);
      }
    });

    const bajaItemCancelado = socketOn('item:cancelado', (data) => {
      if (!data || deduplicador.visto(data.eventId)) return;
      const mensaje = formatearMensajeItemCancelado(data, comensal);
      if (mensaje) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setToastPedido({ tipo: 'item_cancelado', mensaje });
        timerRef.current = setTimeout(() => {
          setToastPedido(null);
        }, 5000);
      }
    });

    return () => {
      bajaCreated?.();
      bajaStatus?.();
      bajaPayment?.();
      bajaItemCancelado?.();
    };
  }, [socketOn, comensal, deduplicador]);

  if (cargando) {
    return null;
  }

  if (!valida) {
    const motivosDespedida = ['pagada', 'liberada', 'MESA_LIBERADA'];
    if (motivoCierre && motivosDespedida.includes(motivoCierre)) {
      const motivoNorm = motivoCierre === 'MESA_LIBERADA' ? 'liberada' : motivoCierre;
      return <Navigate to="/despedida" replace state={{ motivo: motivoNorm, numeroMesa: mesa }} />;
    }
    return <Navigate to="/" replace />;
  }

  return (
    <div
      className={`min-h-screen flex flex-col relative transition-colors duration-500 ${
        esComanda
          ? esRojoSeguimiento
            ? 'fondo-comanda-rojo text-tinta'
            : 'fondo-comanda text-tinta'
          : 'bg-fondo text-texto'
      }`}
      style={
        esComanda
          ? { '--fondo-pagina': esRojoSeguimiento ? '#E5212E' : '#FFB02E' }
          : undefined
      }
    >
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-primario focus:text-white focus:font-etiqueta focus:font-bold focus:text-sm"
      >
        Saltar al contenido
      </a>
      <Header
        numeroMesa={mesa}
        comensal={comensal}
        cantidadCarrito={totalUnidades}
      />

      {/* Toast global cuando otro comensal envía su pedido o cuando mi pedido sale caliente */}
      {toastPedido && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md bg-superficie-2 border p-3.5 rounded-2xl flex items-center justify-between gap-2.5 text-xs font-semibold shadow-2xl animate-fadeIn ${
            toastPedido.tipo === 'sale_caliente'
              ? 'border-primario text-white'
              : toastPedido.tipo === 'item_cancelado'
                ? 'border-acento text-texto'
                : 'border-exito text-texto'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                toastPedido.tipo === 'sale_caliente'
                  ? 'bg-primario'
                  : toastPedido.tipo === 'item_cancelado'
                    ? 'bg-acento'
                    : 'bg-exito'
              }`}
            />
            <span className="truncate">
              {toastPedido.mensaje || toastPedido}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setToastPedido(null)}
            className="min-w-11 min-h-11 inline-flex items-center justify-center text-texto-suave hover:text-texto p-2 -mr-2 rounded-lg cursor-pointer"
            aria-label="Cerrar notificación"
          >
            ✕
          </button>
        </div>
      )}

      {/* La carta cambió con el carrito lleno (menu:actualizado): precio nuevo o plato retirado */}
      {avisosMenu.length > 0 && (
        <div
          role="alert"
          data-testid="avisos-menu"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 w-11/12 max-w-md bg-superficie-2 border border-acento p-3.5 rounded-2xl shadow-2xl animate-fadeIn text-xs text-texto"
        >
          <p className="font-etiqueta font-bold uppercase tracking-wide text-acento mb-1.5">La carta cambió</p>
          <ul className="space-y-1.5 leading-relaxed">
            {avisosMenu.map((aviso) => (
              <li key={aviso.clave}>{aviso.texto}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={descartarAvisosMenu}
            className="mt-2.5 min-h-11 w-full rounded-xl border border-borde font-etiqueta font-bold uppercase text-texto hover:border-acento cursor-pointer"
          >
            Entendido
          </button>
        </div>
      )}

      <main id="contenido-principal" tabIndex={-1} className={`flex-1 w-full max-w-[480px] mx-auto focus:outline-none ${esComanda ? 'pb-28' : 'px-4 pb-8'}`}>{children}</main>
    </div>
  );
}

export default Layout;
