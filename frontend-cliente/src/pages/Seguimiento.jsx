import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import useSeguimientoMesa from '../hooks/useSeguimientoMesa';
import TarjetaEstado from '../components/seguimiento/TarjetaEstado';
import LineaTiempo from '../components/seguimiento/LineaTiempo';
import OtrosPedidos from '../components/seguimiento/OtrosPedidos';
import TarjetaPermisoPush from '../components/seguimiento/TarjetaPermisoPush';
import {
  accionErrorQuitar,
  etiquetaItemCancelado,
  infoEstado,
  puedeQuitar,
} from '../utils/seguimiento';
import { formatearPrecio } from '../utils/formato';

/**
 * Pantalla principal de seguimiento de pedidos en mesa (J-07, J-14).
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
    recargar,
    quitarPlato,
    mesa,
    comensal,
  } = useSeguimientoMesa(location.state?.pedido);

  const [itemAConfirmar, setItemAConfirmar] = useState(null);
  const [quitando, setQuitando] = useState(false);
  const [errorQuitar, setErrorQuitar] = useState(null);
  const quitandoRef = useRef(false);
  const dialogConfirmarRef = useRef(null);
  const tituloConfirmarId = useId();

  useEffect(() => {
    const dialog = dialogConfirmarRef.current;
    if (!dialog) return;
    if (itemAConfirmar) {
      if (!dialog.open && typeof dialog.showModal === 'function') {
        dialog.showModal();
      }
    } else if (dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
  }, [itemAConfirmar]);

  const abrirConfirmacion = (detalle, idPedido) => {
    if (quitandoRef.current) return;
    setErrorQuitar(null);
    setItemAConfirmar(
      detalle
        ? {
            ...detalle,
            id_pedido: idPedido ?? detalle.id_pedido ?? pedidoActivo?.id_pedido,
          }
        : null
    );
  };

  const cerrarConfirmacion = () => {
    if (quitandoRef.current) return;
    setItemAConfirmar(null);
  };

  const confirmarQuitar = async () => {
    if (quitandoRef.current || !itemAConfirmar) return;
    const idPedidoAQuitar = itemAConfirmar.id_pedido ?? pedidoActivo?.id_pedido;
    if (!idPedidoAQuitar) return;

    quitandoRef.current = true;
    setQuitando(true);
    setErrorQuitar(null);

    try {
      await quitarPlato(idPedidoAQuitar, itemAConfirmar.id_detalle);
      setItemAConfirmar(null);
    } catch (err) {
      setItemAConfirmar(null);
      const accion = accionErrorQuitar(err);
      if (accion.refrescar) {
        await recargar();
      }
      if (accion.mensaje) {
        setErrorQuitar(accion.mensaje);
      }
    } finally {
      quitandoRef.current = false;
      setQuitando(false);
    }
  };

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
        <h1 className="text-2xl font-titulo uppercase tracking-wider text-texto mb-2">
          No tienes pedidos activos en esta mesa
        </h1>
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
              esLimite ? 'border-[#969696]' : 'border-acento'
            } text-texto`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                esLimite ? 'bg-[#969696]' : 'bg-acento'
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
                onClick={() => {
                  setErrorQuitar(null);
                  setPedidoActivo(p.id_pedido);
                }}
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

      {/* Solicitud discreta de notificaciones push tras confirmar pedido */}
      <TarjetaPermisoPush tienePedidoConfirmado={misPedidos.length > 0} />

      {/* Línea de tiempo de 4 pasos */}
      <LineaTiempo estado={pedidoActivo.estado} />

      {/* TU ORDEN (si el pedido activo es mío y tiene ítems) */}
      {detalles.length > 0 && pedidoActivo.esMio && (
        <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-2.5">
          <h2 className="m-0 font-etiqueta font-bold text-[15px] tracking-wider text-texto-suave uppercase">
            TU ORDEN
          </h2>

          {errorQuitar && (
            <div
              role="alert"
              className="p-3 rounded-xl border border-primario bg-superficie-2 text-primario-texto text-xs font-medium"
            >
              {errorQuitar}
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {detalles.map((detalle, idx) => {
              const nombrePlato = detalle.plato_nombre || detalle.nombre || 'Plato';
              const esCancelado =
                String(detalle.estado_item || '').trim().toLowerCase() === 'cancelado';
              const etiquetaCancelado = etiquetaItemCancelado(detalle);
              const permiteQuitar = puedeQuitar(detalle, {
                yo: comensal,
                estadoPedido: pedidoActivo.estado,
              });

              return (
                <div
                  key={detalle.id_detalle ?? idx}
                  className="flex items-center justify-between gap-2 text-[15px]"
                >
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span
                      className={`truncate ${
                        esCancelado ? 'line-through text-texto-tenue' : 'text-white'
                      }`}
                    >
                      {detalle.cantidad} × {nombrePlato}
                    </span>
                    {etiquetaCancelado && (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md bg-superficie-2 border font-etiqueta font-bold text-[11px] uppercase tracking-wider shrink-0 ${
                          detalle.origen_cancelacion === 'personal'
                            ? 'border-primario/50 text-primario-texto'
                            : 'border-borde text-texto-suave'
                        }`}
                      >
                        {etiquetaCancelado}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-medium ${
                        esCancelado ? 'line-through text-texto-tenue' : 'text-texto-suave'
                      }`}
                    >
                      {formatearPrecio(detalle.subtotal)}
                    </span>
                    {permiteQuitar && (
                      <button
                        type="button"
                        onClick={() => abrirConfirmacion(detalle, pedidoActivo.id_pedido)}
                        disabled={quitando}
                        aria-label={`Quitar ${nombrePlato}`}
                        className="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl border border-borde bg-superficie-2 hover:border-primario hover:text-white text-primario-texto font-etiqueta font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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

      {/* Diálogo nativo de confirmación para quitar un plato */}
      <dialog
        ref={dialogConfirmarRef}
        aria-labelledby={tituloConfirmarId}
        onCancel={(e) => {
          if (quitandoRef.current) {
            e.preventDefault();
            return;
          }
          setItemAConfirmar(null);
        }}
        onClose={() => {
          if (!quitandoRef.current) {
            setItemAConfirmar(null);
          }
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-borde bg-superficie p-5 text-texto shadow-2xl"
      >
        {itemAConfirmar && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h2
                id={tituloConfirmarId}
                className="m-0 font-etiqueta font-bold text-xl tracking-wide text-white"
              >
                ¿Quitar {itemAConfirmar.plato_nombre || itemAConfirmar.nombre || 'este plato'} de tu pedido?
              </h2>
              {Number(itemAConfirmar.cantidad) > 1 && (
                <p className="m-0 text-xs text-texto-suave">
                  Se quitará la línea completa ({itemAConfirmar.cantidad} unidades) de tu orden.
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row-reverse gap-2.5">
              <button
                type="button"
                onClick={confirmarQuitar}
                disabled={quitando}
                className="min-h-[44px] flex-1 px-4 py-2.5 rounded-xl bg-primario hover:bg-primario-hover text-white font-etiqueta font-bold text-sm uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {quitando ? 'Quitando...' : 'Sí, quitar'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={cerrarConfirmacion}
                disabled={quitando}
                className="min-h-[44px] flex-1 px-4 py-2.5 rounded-xl border border-borde bg-superficie-2 hover:bg-superficie text-texto font-etiqueta font-bold text-sm uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </dialog>

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
