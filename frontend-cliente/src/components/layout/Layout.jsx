import { useState, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import Header from './Header';
import { useMesaSession } from '../../hooks/useMesaSession';
import { useCarrito } from '../../context/CarritoContext';
import { useMesaSocketContext } from '../../context/MesaSocketContext';
import { formatearMensajePedidoCreado } from '../../utils/notificacionesMesa';
import { esPedidoMio } from '../../utils/seguimiento';

function Layout({ children }) {
  const { mesa, comensal, valida, cargando } = useMesaSession();
  const { totalUnidades } = useCarrito();
  const { on: socketOn } = useMesaSocketContext();

  const [toastPedido, setToastPedido] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaCreated = socketOn('order:created', (data) => {
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
      if (!data) return;
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

    return () => {
      bajaCreated?.();
      bajaStatus?.();
    };
  }, [socketOn, comensal]);

  if (cargando) {
    return null;
  }

  if (!valida) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-fondo text-texto flex flex-col relative">
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
              : 'border-exito text-texto'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                toastPedido.tipo === 'sale_caliente'
                  ? 'bg-primario'
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
            className="text-texto-suave hover:text-texto p-1 -mr-1 rounded-lg cursor-pointer"
            aria-label="Cerrar notificación"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 w-full max-w-md mx-auto px-4 pb-8">{children}</main>
    </div>
  );
}

export default Layout;
