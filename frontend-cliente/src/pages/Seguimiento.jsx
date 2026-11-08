import { useLocation, Link } from 'react-router-dom';
import useSeguimientoMesa from '../hooks/useSeguimientoMesa';
import TarjetaEstado from '../components/seguimiento/TarjetaEstado';
import LineaTiempo from '../components/seguimiento/LineaTiempo';
import OtrosPedidos from '../components/seguimiento/OtrosPedidos';
import { infoEstado } from '../utils/seguimiento';
import { formatearPrecio } from '../utils/formato';

/**
 * Pantalla principal de seguimiento de pedidos en mesa (J-07).
 */
function Seguimiento() {
  const location = useLocation();
  const {
    misPedidos,
    otrosPedidos,
    pedidoActivo,
    setPedidoActivo,
    avisoMesero,
    cooldownMesero,
    llamarMesero,
    mesa,
  } = useSeguimientoMesa(location.state?.pedido);

  if (!pedidoActivo) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-full bg-superficie border border-borde text-texto-suave flex items-center justify-center mb-4"
        >
          <svg
            width="36"
            height="36"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <path d="M12 11h4" />
            <path d="M12 16h4" />
            <path d="M8 11h.01" />
            <path d="M8 16h.01" />
          </svg>
        </div>
        <h2 className="text-2xl font-titulo uppercase tracking-wider text-texto mb-2">
          No tienes pedidos activos en esta mesa
        </h2>
        <p className="text-sm text-texto-suave max-w-xs mb-6">
          Cuando confirmes un pedido desde el carrito, podrás ver su estado y avance aquí.
        </p>
        <Link
          to="/menu"
          className="min-h-12 inline-flex items-center justify-center px-6 py-3 bg-primario hover:bg-primario-hover text-white font-etiqueta uppercase tracking-wider font-bold text-sm rounded-xl transition-colors shadow-sm"
        >
          Ver menú
        </Link>
      </div>
    );
  }

  // Filtrar otros pedidos para no repetir el que se esté mostrando como activo
  const otrosAMostrar = otrosPedidos.filter(
    (p) => String(p.id_pedido) !== String(pedidoActivo.id_pedido)
  );

  const detalles = pedidoActivo.detalles || [];

  return (
    <div className="flex flex-col gap-3.5 pb-8">
      {/* Aviso temporal de llamada al mesero */}
      {avisoMesero && (() => {
        const mensaje =
          typeof avisoMesero === 'string'
            ? avisoMesero
            : avisoMesero.mensaje;
        const esLimite =
          (typeof avisoMesero === 'object' && avisoMesero?.tipo === 'limite') ||
          (typeof avisoMesero === 'string' &&
            /ya llam[oó] al mesero|espera/i.test(avisoMesero));

        return (
          <div
            role="status"
            aria-live="polite"
            className={`bg-superficie-2 px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-lg border ${
              esLimite ? 'border-[#6B6B6B]' : 'border-acento'
            } text-texto`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                esLimite ? 'bg-[#6B6B6B]' : 'bg-acento'
              }`}
            />
            <span>{mensaje}</span>
          </div>
        );
      })()}

      {/* Tira horizontal de chips si el comensal tiene más de un pedido */}
      {misPedidos.length > 1 && (
        <div
          role="tablist"
          aria-label="Mis pedidos"
          className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar"
        >
          {misPedidos.map((p) => {
            const esActivo =
              String(p.id_pedido) === String(pedidoActivo.id_pedido);
            const info = infoEstado(p.estado);
            const cod = p.codigo_pedido
              ? p.codigo_pedido.startsWith('#')
                ? p.codigo_pedido
                : `#${p.codigo_pedido}`
              : `#PED-${p.id_pedido}`;

            return (
              <button
                key={p.id_pedido}
                type="button"
                role="tab"
                aria-selected={esActivo}
                onClick={() => setPedidoActivo(p.id_pedido)}
                className={`min-h-[44px] px-3.5 py-1.5 rounded-xl border font-etiqueta font-bold text-xs tracking-wider uppercase whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                  esActivo
                    ? 'bg-superficie-2 text-white shadow-sm'
                    : 'bg-superficie text-texto-suave border-borde hover:text-white'
                }`}
                style={esActivo ? { borderColor: info.color } : {}}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: info.color }}
                />
                <span>
                  {cod} · {info.pill}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Tarjeta principal con halo y animación */}
      <TarjetaEstado pedido={pedidoActivo} numeroMesa={mesa} />

      {/* Línea de tiempo de 4 pasos */}
      <LineaTiempo estado={pedidoActivo.estado} />

      {/* TU ORDEN (si el pedido activo es mío y tiene ítems) */}
      {detalles.length > 0 && pedidoActivo.esMio && (
        <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-2.5">
          <h2 className="m-0 font-etiqueta font-bold text-[15px] tracking-wider text-texto-suave uppercase">
            TU ORDEN
          </h2>
          <div className="flex flex-col gap-2">
            {detalles.map((detalle, idx) => (
              <div
                key={detalle.id_detalle ?? idx}
                className="flex justify-between items-baseline text-[15px] gap-2"
              >
                <span className="text-white truncate">
                  {detalle.cantidad} × {detalle.plato_nombre || detalle.nombre}
                </span>
                <span className="text-texto-suave shrink-0 font-medium">
                  {formatearPrecio(detalle.subtotal)}
                </span>
              </div>
            ))}
          </div>
          <div className="h-px bg-borde my-1" />
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-texto-suave">Total de tu orden</span>
            <span className="font-titulo text-[28px] tracking-wider text-white">
              {formatearPrecio(pedidoActivo.total)}
            </span>
          </div>
        </section>
      )}

      {/* OTROS PEDIDOS DE LA MESA */}
      <OtrosPedidos pedidos={otrosAMostrar} />

      {/* Botones de acción */}
      <div className="flex flex-col gap-2.5 pt-1">
        <Link
          to="/menu"
          className="flex items-center justify-center min-h-[56px] rounded-2xl bg-primario hover:bg-primario-hover text-white font-etiqueta font-bold text-[19px] tracking-wider transition-colors no-underline"
        >
          PEDIR MÁS PLATOS
        </Link>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={llamarMesero}
            disabled={cooldownMesero > 0}
            className={`min-h-[52px] rounded-xl border border-borde bg-superficie hover:bg-superficie-2 text-white font-etiqueta font-bold text-[15px] tracking-wider flex items-center justify-center gap-2 transition-colors ${
              cooldownMesero > 0
                ? 'opacity-60 cursor-not-allowed'
                : 'cursor-pointer'
            }`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#F2B705"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
            {cooldownMesero > 0
              ? `LLAMAR AL MESERO (${cooldownMesero}s)`
              : 'LLAMAR AL MESERO'}
          </button>
          <Link
            to="/pago"
            className="min-h-[52px] rounded-xl border border-borde bg-superficie hover:bg-superficie-2 text-white font-etiqueta font-bold text-[15px] tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer no-underline"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#E3242B"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 1V2l-1 1-3-2-3 2-3-2-3 2-3-2Z" />
              <path d="M8 8h8M8 12h8M8 16h5" />
            </svg>
            PEDIR LA CUENTA
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Seguimiento;
