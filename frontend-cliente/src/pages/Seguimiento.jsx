import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import useSeguimientoMesa from '../hooks/useSeguimientoMesa';
import TarjetaEstado from '../components/seguimiento/TarjetaEstado';
import LineaTiempo from '../components/seguimiento/LineaTiempo';
import OtrosPedidos from '../components/seguimiento/OtrosPedidos';
import TarjetaPermisoPush from '../components/seguimiento/TarjetaPermisoPush';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import {
  accionErrorQuitar,
  accionErrorCancelarPedido,
  etiquetaItemCancelado,
  infoEstado,
  puedeQuitar,
  puedeCancelarPedido,
} from '../utils/seguimiento';
import { formatearPrecio } from '../utils/formato';

/**
 * Pantalla principal de seguimiento de pedidos en mesa al estilo comanda (J-07, J-14).
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
    cancelarPedido,
    mesa,
    comensal,
  } = useSeguimientoMesa(location.state?.pedido);

  const [itemAConfirmar, setItemAConfirmar] = useState(null);
  const [quitando, setQuitando] = useState(false);
  const [errorQuitar, setErrorQuitar] = useState(null);
  const quitandoRef = useRef(false);
  const dialogConfirmarRef = useRef(null);
  const tituloConfirmarId = useId();

  const [idPedidoACancelar, setIdPedidoACancelar] = useState(null);
  const [cancelando, setCancelando] = useState(false);
  const cancelandoRef = useRef(false);

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

  const abrirConfirmarCancelar = (idPedido) => {
    if (cancelandoRef.current) return;
    setErrorQuitar(null);
    setIdPedidoACancelar(idPedido ?? pedidoActivo?.id_pedido ?? null);
  };

  const cerrarConfirmarCancelar = () => {
    if (cancelandoRef.current) return;
    setIdPedidoACancelar(null);
  };

  const confirmarCancelarPedido = async () => {
    if (cancelandoRef.current || !idPedidoACancelar) return;
    const targetId = idPedidoACancelar;

    cancelandoRef.current = true;
    setCancelando(true);
    setErrorQuitar(null);

    try {
      await cancelarPedido(targetId);
      setIdPedidoACancelar(null);
    } catch (err) {
      setIdPedidoACancelar(null);
      const accion = accionErrorCancelarPedido(err);
      if (accion.recargar) {
        await recargar();
        if (targetId != null) {
          setPedidoActivo(targetId);
        }
      }
      if (accion.mensaje) {
        setErrorQuitar(accion.mensaje);
      }
    } finally {
      cancelandoRef.current = false;
      setCancelando(false);
    }
  };

  if (!pedidoActivo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="ticket-comanda w-full max-w-sm p-6 flex flex-col items-center gap-4 text-center">
          <div
            aria-hidden="true"
            className="w-20 h-20 rounded-full bg-carbon text-ambar flex items-center justify-center shadow-md"
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
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
          <h1 className="text-2xl font-titulo uppercase tracking-wider text-carbon m-0">
            No tienes pedidos activos en esta mesa
          </h1>
          <p className="text-sm text-[#5B4A46] max-w-xs m-0">
            Cuando confirmes un pedido desde el carrito, podrás ver su estado y avance aquí.
          </p>
          <div className="corte-comanda w-full my-2" />
          <Link
            to="/menu"
            className="btn-comanda no-underline"
          >
            Ver menú
          </Link>
        </div>
      </div>
    );
  }

  // Filtrar otros pedidos para no repetir el que se esté mostrando como activo
  const otrosAMostrar = otrosPedidos.filter(
    (p) => String(p.id_pedido) !== String(pedidoActivo.id_pedido)
  );

  const detalles = pedidoActivo.detalles || [];
  const normEstado = String(pedidoActivo.estado || '').toLowerCase();
  const esRojo = normEstado === 'en_preparacion' || normEstado === 'entregado';

  return (
    <div
      className="flex flex-col gap-4 pb-8 transition-colors duration-500 w-full max-w-full overflow-x-hidden"
      style={{ '--fondo-pagina': esRojo ? '#E5212E' : '#FFB02E' }}
    >
      {/* Confeti decorativo cuando el pedido está entregado */}
      {normEstado === 'entregado' && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
          <i className="absolute top-0 left-[10%] w-2 h-3 rounded-xs bg-[#E5212E] anim-cae" />
          <i className="absolute top-0 left-[25%] w-2 h-3 rounded-xs bg-[#FFB02E] anim-cae [animation-delay:0.7s]" />
          <i className="absolute top-0 left-[50%] w-2 h-3 rounded-xs bg-[#1FA65A] anim-cae [animation-delay:1.4s]" />
          <i className="absolute top-0 left-[75%] w-2 h-3 rounded-xs bg-[#FFF4E6] anim-cae [animation-delay:0.3s]" />
          <i className="absolute top-0 left-[90%] w-2 h-3 rounded-xs bg-[#E5212E] anim-cae [animation-delay:1.1s]" />
        </div>
      )}

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
            className="bg-carbon text-ambar px-4 py-3 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-lg border-2 border-carbon"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                esLimite ? 'bg-[#969696]' : 'bg-ambar'
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
          className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar -mx-4 px-4"
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
                className={`min-h-[44px] px-4 py-2 rounded-xl font-titulo text-sm tracking-wider uppercase whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 border-2 ${
                  esActivo
                    ? 'bg-carbon text-ambar border-carbon shadow-md'
                    : 'bg-papel text-carbon border-carbon/40 hover:border-carbon'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
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

      {/* Tarjeta principal con ilustración vectorial animada y título */}
      <TarjetaEstado pedido={pedidoActivo} numeroMesa={mesa} />

      {/* Solicitud discreta de notificaciones push tras confirmar pedido */}
      <TarjetaPermisoPush tienePedidoConfirmado={misPedidos.length > 0} />

      {/* Línea de tiempo de 4 pasos */}
      <LineaTiempo estado={pedidoActivo.estado} />

      {/* TU ORDEN (si el pedido activo es mío y tiene ítems) */}
      {detalles.length > 0 && pedidoActivo.esMio && (
        <section className="ticket-comanda mt-6 anim-sube anim-sube-d2">
          <div className="banda-comanda flex justify-between items-center px-5 py-3">
            <span>TU ORDEN</span>
            <small className="font-cuerpo font-semibold text-xs tracking-normal text-[#E9C98A]">
              {detalles.length} {detalles.length === 1 ? 'PLATO' : 'PLATOS'}
            </small>
          </div>

          {errorQuitar && (
            <div
              role="alert"
              className="m-4 p-3 rounded-xl border-2 border-brasa bg-brasa/10 text-brasa text-xs font-bold"
            >
              {errorQuitar}
            </div>
          )}

          <div className="flex flex-col">
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
                  className="flex items-center justify-between gap-3 p-4 sm:px-5 border-b-2 border-dashed border-[#E6D6C4] last:border-b-0"
                >
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[15px] sm:text-base font-semibold leading-snug ${
                          esCancelado ? 'line-through text-texto-tenue' : 'text-carbon'
                        }`}
                      >
                        {detalle.cantidad} × {nombrePlato}
                      </span>
                      {etiquetaCancelado && (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md border font-titulo text-xs uppercase tracking-wider shrink-0 ${
                            detalle.origen_cancelacion === 'personal'
                              ? 'border-brasa text-brasa bg-brasa/10'
                              : 'border-carbon/30 text-[#5B4A46]'
                          }`}
                        >
                          {etiquetaCancelado}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <span
                      className={`font-titulo text-[22px] sm:text-[23px] tracking-wide ${
                        esCancelado ? 'line-through text-texto-tenue' : 'text-rojo'
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
                        className="min-h-9 px-3.5 rounded-full border-2 border-rojo bg-transparent hover:bg-rojo hover:text-white text-rojo font-titulo text-base uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="corte-comanda my-2" />

          <div className="flex justify-between items-baseline px-5 py-3">
            <span className="font-titulo text-[20px] sm:text-[22px] tracking-wider text-carbon">
              TOTAL DE TU ORDEN
            </span>
            <span className="font-titulo text-[36px] sm:text-[42px] leading-none text-rojo">
              {formatearPrecio(pedidoActivo.total)}
            </span>
          </div>

          {puedeCancelarPedido(pedidoActivo, { yo: comensal }) ? (
            <div className="px-5 pb-5 pt-1">
              <button
                type="button"
                onClick={() => abrirConfirmarCancelar(pedidoActivo.id_pedido)}
                disabled={cancelando || quitando}
                className="w-full min-h-[52px] rounded-xl border-3 border-carbon bg-transparent hover:bg-carbon hover:text-papel text-carbon font-titulo text-xl tracking-wider transition-colors cursor-pointer disabled:opacity-50"
              >
                {cancelando && idPedidoACancelar === pedidoActivo.id_pedido
                  ? 'Cancelando...'
                  : 'Cancelar pedido'}
              </button>
            </div>
          ) : (
            normEstado !== 'recibido' && (
              <p className="text-center text-xs text-[#5B4A46] pb-4 px-5 m-0 leading-relaxed">
                Este pedido ya no se puede modificar desde aquí. Habla con tu mesero si necesitas cambios.
              </p>
            )
          )}
        </section>
      )}

      {/* Modal de confirmación para cancelar todo el pedido */}
      <Modal
        abierto={Boolean(idPedidoACancelar)}
        onCerrar={cerrarConfirmarCancelar}
        titulo="¿Cancelar todo el pedido?"
      >
        <div className="p-4 space-y-4 text-center">
          <p className="text-sm text-carbon font-medium m-0">
            Se cancelarán todos tus platos de este pedido. Esta acción no se puede deshacer.
          </p>

          <div className="flex flex-col sm:flex-row-reverse gap-2.5 pt-2">
            <Button
              type="button"
              variante="primario"
              onClick={confirmarCancelarPedido}
              disabled={cancelando}
              className="flex-1 min-h-11 py-2.5 text-sm font-titulo tracking-wider uppercase"
            >
              {cancelando ? 'Cancelando...' : 'Sí, cancelar'}
            </Button>
            <Button
              type="button"
              variante="secundario"
              onClick={cerrarConfirmarCancelar}
              disabled={cancelando}
              className="flex-1 min-h-11 py-2.5 text-sm font-titulo tracking-wider uppercase"
            >
              Volver
            </Button>
          </div>
        </div>
      </Modal>

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
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border-3 border-carbon bg-papel p-5 text-carbon shadow-2xl"
      >
        {itemAConfirmar && (
          <div className="flex flex-col gap-4 text-center">
            <div className="flex flex-col gap-1.5">
              <h2
                id={tituloConfirmarId}
                className="m-0 font-titulo text-2xl tracking-wide text-carbon uppercase"
              >
                ¿Quitar {itemAConfirmar.plato_nombre || itemAConfirmar.nombre || 'este plato'} de tu pedido?
              </h2>
              {Number(itemAConfirmar.cantidad) > 1 && (
                <p className="m-0 text-xs text-[#5B4A46]">
                  Se quitará la línea completa ({itemAConfirmar.cantidad} unidades) de tu orden.
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row-reverse gap-2.5">
              <button
                type="button"
                onClick={confirmarQuitar}
                disabled={quitando}
                className="min-h-[44px] flex-1 px-4 py-2.5 rounded-xl bg-brasa hover:bg-brasa/90 text-white font-titulo text-lg uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {quitando ? 'Quitando...' : 'Sí, quitar'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={cerrarConfirmacion}
                disabled={quitando}
                className="min-h-[44px] flex-1 px-4 py-2.5 rounded-xl border-2 border-carbon bg-papel hover:bg-carbon/10 text-carbon font-titulo text-lg uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
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
      <div className="flex flex-col gap-3 pt-2">
        <Link
          to="/menu"
          className="btn-comanda no-underline"
        >
          PEDIR MÁS PLATOS
        </Link>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={llamarMesero}
            disabled={cooldownMesero > 0}
            className={`min-h-[54px] rounded-xl border-2 border-carbon bg-papel hover:bg-carbon hover:text-ambar text-carbon font-titulo text-[18px] sm:text-[20px] tracking-wider flex items-center justify-center gap-2 transition-colors shadow-sm ${
              cooldownMesero > 0
                ? 'opacity-60 cursor-not-allowed'
                : 'cursor-pointer'
            }`}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
            </svg>
            {cooldownMesero > 0
              ? `LLAMAR (${cooldownMesero}s)`
              : 'LLAMAR AL MESERO'}
          </button>
          <Link
            to="/pago"
            className="min-h-[54px] rounded-xl border-2 border-carbon bg-papel hover:bg-carbon hover:text-ambar text-carbon font-titulo text-[18px] sm:text-[20px] tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer no-underline shadow-sm"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
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
