import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCarrito } from '../context/CarritoContext';
import { useMesaSocket } from '../context/MesaSocketContext';
import { useSesion } from '../context/SesionContext';
import { formatearPrecio } from '../utils/formato';
import { obtenerApodo } from '../utils/apodo';
import { pluralizar } from '../utils/pluralizar';
import { puedoEnviar } from '../utils/carritoCompartido';
import LineaCarrito from '../components/carrito/LineaCarrito';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { crearPedido } from '../services/pedidoService';
import {
  recargarMenu,
  marcarFaltantesEnCache,
  actualizarDisponibilidadPlatoEnCache,
  actualizarDisponibilidadEnCache,
} from '../services/menuService';
import {
  faltantesDelItem,
  resumenFaltantes,
  accionErrorPedido,
  actualizarMarcasPorDisponibilidad,
  aplicarAjusteFaltantes,
} from '../utils/sinStock';

function Carrito({ faltantesIniciales = [], errorPedidoInicial = null } = {}) {
  const navigate = useNavigate();
  const { sesion } = useSesion();
  const mesa = sesion?.numeroMesa ?? null;
  const {
    modo,
    estadoConexion,
    misLineas,
    otros,
    totalMio,
    totalMesa,
    totalUnidades,
    actualizarCantidad,
    eliminarLinea,
    vaciarCarrito,
    marcarFaltantesEnMenu,
  } = useCarrito();
  const { on: socketOn } = useMesaSocket();

  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);
  const [modalConfirmarAbierto, setModalConfirmarAbierto] = useState(false);
  const [notasGenerales, setNotasGenerales] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState(errorPedidoInicial);
  const [faltantesStock, setFaltantesStock] = useState(
    faltantesIniciales.length > 0
      ? faltantesIniciales
      : (errorPedidoInicial?.faltantes || [])
  );
  const [bloqueoSegundos, setBloqueoSegundos] = useState(0);

  const miNombre = obtenerApodo();
  const validacionEnvio = puedoEnviar(misLineas);
  const resumenStock = useMemo(
    () => resumenFaltantes(misLineas, faltantesStock),
    [misLineas, faltantesStock]
  );
  const tieneFaltantesPendientes =
    (errorPedido?.tipo === 'sin_stock' && (errorPedido?.idsLineasAfectadas?.length ?? 0) > 0) ||
    resumenStock.idsLineasAfectadas.length > 0;
  const errorMarcabaLineas =
    (errorPedido?.idsLineasAfectadas?.length ?? 0) > 0;
  const errorPedidoVisible =
    errorPedido?.tipo === 'sin_stock' &&
    errorMarcabaLineas &&
    !tieneFaltantesPendientes &&
    validacionEnvio.ok
      ? null
      : errorPedido;

  useEffect(() => {
    if (!socketOn) return undefined;
    const bajaPlato = socketOn('plato:disponibilidad', (data) => {
      const idPlato = Number(data?.id_plato ?? data?.idPlato);
      const disponible = Boolean(data?.disponible);
      if (!idPlato || !disponible) return;
      actualizarDisponibilidadPlatoEnCache(idPlato, true);
      setFaltantesStock((prev) =>
        actualizarMarcasPorDisponibilidad(prev, {
          tipo: 'plato',
          id: idPlato,
          disponible: true,
        })
      );
    });
    const bajaIng = socketOn('ingrediente:disponibilidad', (data) => {
      const idIng = Number(data?.id_ingrediente ?? data?.idIngrediente);
      const disponible = Boolean(data?.disponible);
      if (!idIng || !disponible) return;
      actualizarDisponibilidadEnCache(idIng, true);
      setFaltantesStock((prev) =>
        actualizarMarcasPorDisponibilidad(prev, {
          tipo: 'ingrediente',
          id: idIng,
          disponible: true,
        })
      );
    });
    return () => {
      bajaPlato?.();
      bajaIng?.();
    };
  }, [socketOn]);

  useEffect(() => {
    if (bloqueoSegundos <= 0) return;
    const interval = setInterval(() => {
      setBloqueoSegundos((prev) => {
        if (prev <= 1) {
          setErrorPedido(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [bloqueoSegundos]);

  const manejarConfirmarPedido = async () => {
    if (
      enviando ||
      bloqueoSegundos > 0 ||
      !validacionEnvio.ok ||
      tieneFaltantesPendientes
    ) {
      return;
    }

    setEnviando(true);
    setErrorPedido(null);

    try {
      const respuesta = await crearPedido({
        lineas: misLineas,
        notasGenerales,
      });

      setModalConfirmarAbierto(false);
      setFaltantesStock([]);
      await vaciarCarrito();
      navigate('/seguimiento', { state: { pedido: respuesta } });
    } catch (err) {
      const infoError = accionErrorPedido(err, misLineas);
      if (infoError.ignorar) return;

      if (infoError.tipo === 'sin_stock') {
        const listaFaltantes = infoError.faltantes || [];
        setFaltantesStock(listaFaltantes);
        if (listaFaltantes.length > 0) {
          marcarFaltantesEnCache(listaFaltantes);
          marcarFaltantesEnMenu?.(listaFaltantes);
        } else {
          recargarMenu();
        }
        setModalConfirmarAbierto(false);
        setErrorPedido(infoError);
        return;
      }

      if (infoError.recargarMenu) {
        recargarMenu();
      }
      if (infoError.bloquearSegundos) {
        setBloqueoSegundos(infoError.bloquearSegundos);
      }
      setErrorPedido(infoError);
    } finally {
      setEnviando(false);
    }
  };

  const manejarAjustarCantidad = async (idLinea, cantidadDisponible) => {
    await actualizarCantidad(idLinea, cantidadDisponible);
    setErrorPedido((prev) => {
      const base = prev || (resumenStock?.hayFaltantes ? resumenStock : null);
      if (!base) return null;
      const nuevo = aplicarAjusteFaltantes(base, {
        idLinea,
        nuevaCantidad: cantidadDisponible,
        lineas: misLineas,
      });
      return nuevo?.hayFaltantes ? nuevo : null;
    });
    setFaltantesStock((prev) => {
      const nuevo = aplicarAjusteFaltantes(prev, {
        idLinea,
        nuevaCantidad: cantidadDisponible,
        lineas: misLineas,
      });
      return Array.isArray(nuevo) ? nuevo : (nuevo?.faltantes ?? []);
    });
  };

  const estaVacioTotal = misLineas.length === 0 && otros.length === 0;

  if (estaVacioTotal) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-full bg-papel border-2 border-carbon text-carbon flex items-center justify-center text-3xl mb-4 shadow-sm"
        >
          🛒
        </div>
        <h1 className="text-3xl font-titulo uppercase tracking-wider text-carbon mb-2">
          Tu carrito está vacío
        </h1>
        <p className="text-sm font-manuscrita text-2xl text-granate max-w-xs mb-6">
          Aún no has agregado ningún plato a tu pedido. Revisa nuestro menú para
          elegir tus favoritos.
        </p>
        <Link
          to="/menu"
          className="btn-comanda min-h-12 inline-flex items-center justify-center px-6 py-3 font-titulo uppercase tracking-wider text-lg rounded-xl transition-colors shadow-sm"
        >
          Explorar menú
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8 max-w-md mx-auto w-full max-w-full overflow-x-hidden">
      {/* Portada Hero Carrito */}
      <section className="relative px-1 pt-2 pb-2 mb-2 overflow-hidden">
        <div className="flex flex-col relative z-10 pr-24">
          <span className="inline-flex items-center gap-1.5 font-titulo uppercase tracking-[0.16em] text-xs font-bold text-carbon">
            <span className="w-2.5 h-2.5 rounded-full bg-[#1EA642] animate-pulse inline-block" aria-hidden="true" />
            {mesa ? `MESA ${mesa} · EN VIVO` : 'MESA · EN VIVO'}
          </span>
          <h1 className="font-titulo text-5xl sm:text-6xl text-papel tracking-[0.03em] leading-none uppercase mt-1 [text-shadow:3px_3px_0_var(--color-brasa)]">
            TU PEDIDO
          </h1>
          <p className="text-xs sm:text-sm text-tinta font-cuerpo mt-1">
            Se actualiza en vivo con lo que piden todos en la mesa.
          </p>
        </div>
        <img
          src="/img/mascota-chef.webp"
          alt=""
          aria-hidden="true"
          className="mascota-asomada absolute right-0 bottom-0 w-24 h-auto pointer-events-none select-none z-10"
        />
      </section>

      {/* Banner de estado de conexión compartida */}
      {modo === 'compartido' && estadoConexion !== 'conectado' && (
        <div
          role="status"
          className="bg-papel rounded-2xl border-2 border-dashed border-carbon/40 p-3 flex items-center gap-3 text-xs text-tinta"
        >
          {estadoConexion === 'conectando' ||
          estadoConexion === 'reconectando' ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-ambar animate-pulse shrink-0" />
              <span>
                Conectando con la mesa… Se sincronizarán los cambios
                automáticamente.
              </span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-brasa shrink-0" />
              <span className="text-rojo-tinta font-semibold">
                Sin conexión con la mesa. Reintentando…
              </span>
            </>
          )}
        </div>
      )}

      {/* Aviso superior cuando algo se agotó o hubo cruce al enviar */}
      {errorPedidoVisible && (
        <div
          role="alert"
          className="p-4 bg-papel rounded-2xl border-2 border-brasa text-rojo-tinta text-sm space-y-1.5 animate-fadeIn"
        >
          <p className="font-bold text-carbon font-cuerpo">
            {errorPedidoVisible.tipo === 'sin_stock'
              ? resumenStock.texto || errorPedidoVisible.mensaje
              : errorPedidoVisible.mensaje}
          </p>
          {errorPedidoVisible.ayuda && (
            <p className="text-xs text-papel-suave font-medium">
              {errorPedidoVisible.ayuda}
            </p>
          )}
          {(errorPedidoVisible.esConexion ||
            errorPedidoVisible.esReintentable) && (
            <button
              type="button"
              disabled={enviando}
              onClick={manejarConfirmarPedido}
              className="min-h-11 px-3 py-2 text-xs font-bold text-brasa hover:underline inline-flex items-center cursor-pointer"
            >
              Reintentar envío
            </button>
          )}
        </div>
      )}

      {/* Barra de conteo y botón vaciar lo mío */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-papel-suave font-semibold font-cuerpo">
          {totalUnidades} {pluralizar(totalUnidades, 'producto', 'productos')} en tu pedido
        </span>

        {misLineas.length > 0 &&
          (confirmandoVaciar ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  vaciarCarrito();
                  setConfirmandoVaciar(false);
                }}
                className="min-h-11 text-xs font-bold text-rojo-tinta hover:underline px-2.5 py-1 rounded transition-colors cursor-pointer font-titulo uppercase tracking-wider"
              >
                Sí, vaciar lo mío
              </button>
              <button
                type="button"
                onClick={() => setConfirmandoVaciar(false)}
                className="min-h-11 text-xs font-semibold text-papel-suave hover:text-carbon px-2.5 py-1 rounded transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmandoVaciar(true)}
              className="min-h-11 text-xs font-semibold text-papel-suave hover:text-rojo-tinta py-1 px-2.5 rounded transition-colors cursor-pointer"
            >
              Vaciar lo mío
            </button>
          ))}
      </div>

      {/* Sección LO TUYO como ticket-comanda con banda carbón */}
      <section className="ticket-comanda bg-papel text-tinta mb-6">
        <div className="banda-comanda flex justify-between items-center">
          <span>LO TUYO{miNombre ? ` · ${miNombre.toUpperCase()}` : ''}</span>
          <span className="text-sm font-titulo tracking-wider text-ambar">
            {misLineas.length} {pluralizar(misLineas.length, 'PLATO', 'PLATOS')}
          </span>
        </div>

        {misLineas.length === 0 ? (
          <div className="py-8 px-4 text-center space-y-2">
            <p className="font-manuscrita text-2xl text-granate">
              No tienes platos agregados a tu pedido personal.
            </p>
            <Link
              to="/menu"
              className="min-h-11 inline-flex items-center justify-center px-3 text-sm font-bold text-brasa hover:underline font-titulo uppercase tracking-wider"
            >
              + Agregar platos desde el menú
            </Link>
          </div>
        ) : (
          <div>
            <div className="divide-y divide-dashed divide-papel-linea">
              {misLineas.map((linea) => {
                const itemAfectado = resumenStock.itemsAfectados.find(
                  (it) => it.id_linea === linea.id_linea || it.idLinea === linea.id_linea
                );
                return (
                  <LineaCarrito
                    key={linea.id_linea}
                    linea={linea}
                    faltantes={
                      itemAfectado
                        ? itemAfectado.faltantes
                        : faltantesDelItem(linea, faltantesStock)
                    }
                    disponible={itemAfectado?.disponible}
                    puedeAjustar={itemAfectado?.puedeAjustar}
                    onAjustarCantidad={manejarAjustarCantidad}
                    onActualizarCantidad={actualizarCantidad}
                    onEliminar={eliminarLinea}
                  />
                );
              })}
            </div>

            {/* Corte con muescas y subtotal lo tuyo */}
            <div className="corte-comanda my-0" aria-hidden="true">
              <span className="corte-comanda-muesca-izq" />
              <span className="corte-comanda-muesca-der" />
            </div>

            <div className="flex justify-between items-baseline px-4 sm:px-5 py-3.5 bg-papel">
              <span className="font-titulo text-lg tracking-[0.14em] text-papel-suave">
                SUBTOTAL LO TUYO
              </span>
              <b className="font-titulo text-3xl leading-none text-carbon">
                {formatearPrecio(totalMio)}
              </b>
            </div>
          </div>
        )}
      </section>

      {/* Sección DE LA MESA (otros comensales, solo lectura) */}
      {modo === 'compartido' && otros.length > 0 && (
        <div className="bg-papel/55 border-2 border-dashed border-carbon/35 rounded-2xl p-3.5 sm:p-4 mb-4">
          <div className="flex justify-between items-center font-titulo uppercase tracking-[0.16em] text-base text-carbon">
            <span>EN LA MESA TAMBIÉN</span>
            <span className="font-cuerpo text-xs font-semibold text-tinta tracking-normal">
              {otros.reduce((acc, g) => acc + g.lineas.length, 0)}{' '}
              {pluralizar(
                otros.reduce((acc, g) => acc + g.lineas.length, 0),
                'plato',
                'platos'
              )}
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {otros.map((grupo) => (
              <div key={grupo.comensal} className="space-y-2 border-t border-dashed border-carbon/20 pt-2.5 first:border-t-0 first:pt-0">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-carbon text-ambar flex items-center justify-center font-titulo text-base">
                      {grupo.comensal ? grupo.comensal.charAt(0).toUpperCase() : '?'}
                    </span>
                    <span className="font-cuerpo font-semibold text-sm text-tinta">{grupo.comensal}</span>
                    <span className="text-xs text-papel-suave">
                      ({grupo.lineas.length} {pluralizar(grupo.lineas.length, 'plato', 'platos')})
                    </span>
                  </div>
                  <span className="font-titulo text-base text-carbon">{formatearPrecio(grupo.subtotal)}</span>
                </div>

                <div className="space-y-1.5 pl-9">
                  {grupo.lineas.map((linea) => (
                    <div key={linea.id_linea} className="flex justify-between items-center text-xs text-papel-suave">
                      <span className="truncate pr-2 font-cuerpo">
                        {linea.cantidad}x {linea.nombre}
                      </span>
                      <span className="font-titulo text-sm text-carbon shrink-0">
                        {formatearPrecio(linea.subtotal ?? (Number(linea.precioUnitario) * Number(linea.cantidad)))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notas generales para la cocina */}
      <div className="ticket-comanda bg-papel mb-6">
        <div className="banda-comanda flex justify-between items-center">
          <span>NOTAS PARA LA COCINA</span>
          <span className="font-cuerpo text-[11px] text-ambar font-medium tracking-normal">(OPCIONAL)</span>
        </div>
        <div className="p-3.5 sm:p-4 bg-papel">
          <label htmlFor="notas-generales-pedido" className="sr-only">
            Notas para la cocina (opcional)
          </label>
          <div className="flex justify-between items-center text-xs font-titulo uppercase tracking-wider text-papel-suave mb-1">
            <span>INDICACIONES GENERALES</span>
            <span className="font-cuerpo text-[11px] text-papel-suave">{notasGenerales.length}/500</span>
          </div>
          <textarea
            id="notas-generales-pedido"
            rows={3}
            maxLength={500}
            value={notasGenerales}
            onChange={(e) => setNotasGenerales(e.target.value)}
            placeholder="Ej. Traer todo al mismo tiempo, sin cubiertos plásticos..."
            className="w-full min-h-[96px] bg-[repeating-linear-gradient(transparent_0_31px,#e3cfb8_31px_33px)] leading-[33px] px-2 font-manuscrita text-2xl text-carbon placeholder:text-papel-suave/60 border-0 focus:outline-none focus:ring-2 focus:ring-brasa rounded resize-y"
          />
        </div>
      </div>

      {/* Resumen del pedido / CUENTA */}
      <div className="ticket-comanda bg-papel mb-6">
        <div className="banda-comanda">
          <span>CUENTA</span>
        </div>
        <div className="p-3.5 sm:p-4 bg-papel space-y-1.5 text-sm">
          <div className="flex justify-between items-center text-papel-suave font-cuerpo">
            <span>
              Subtotal lo tuyo ({misLineas.length}{' '}
              {pluralizar(misLineas.length, 'producto', 'productos')})
            </span>
            <b className="text-carbon font-bold font-titulo text-lg">
              {formatearPrecio(totalMio)}
            </b>
          </div>

          {modo === 'compartido' && totalMesa > totalMio && (
            <div className="flex justify-between items-center text-xs text-papel-suave font-cuerpo pt-1">
              <span>Total acumulado en la mesa</span>
              <b className="text-carbon font-semibold font-titulo text-base">
                {formatearPrecio(totalMesa)}
              </b>
            </div>
          )}
        </div>

        <div className="corte-comanda my-0" aria-hidden="true">
          <span className="corte-comanda-muesca-izq" />
          <span className="corte-comanda-muesca-der" />
        </div>

        <div className="p-3.5 sm:p-4 bg-papel flex justify-between items-baseline">
          <span className="font-titulo text-xl tracking-[0.06em] text-carbon">
            TOTAL A PAGAR POR TI
          </span>
          <b className="font-titulo text-4xl leading-none text-brasa">
            {formatearPrecio(totalMio)}
          </b>
        </div>
      </div>

      {/* Acciones finales: confirmar pedido y volver al menú */}
      <div className="space-y-3 pt-2 text-center">
        <Button
          type="button"
          variante="primario"
          onClick={() => setModalConfirmarAbierto(true)}
          disabled={
            enviando ||
            bloqueoSegundos > 0 ||
            misLineas.length === 0 ||
            !validacionEnvio.ok ||
            tieneFaltantesPendientes
          }
          className="btn-comanda w-full min-h-12 py-3 px-4 font-bold font-titulo uppercase text-xl rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md"
        >
          {bloqueoSegundos > 0 ? (
            <span>Espera {bloqueoSegundos}s...</span>
          ) : (
            <span>Enviar mi pedido a cocina</span>
          )}
        </Button>

        {(!validacionEnvio.ok || tieneFaltantesPendientes) &&
          misLineas.length > 0 && (
            <p className="text-xs text-rojo-tinta text-center font-semibold font-cuerpo">
              {(errorPedido?.tipo === 'sin_stock'
                ? errorPedido.texto || errorPedido.mensaje
                : null) ||
                resumenStock.texto ||
                validacionEnvio.motivo}
            </p>
          )}

        <p className="text-xs text-tinta text-center font-cuerpo font-medium">
          Se envía todo lo tuyo a la cocina. Cada quien paga lo suyo al final.
        </p>

        <div>
          <Link
            to="/menu"
            className="font-manuscrita text-2xl text-carbon hover:text-brasa border-b-2 border-carbon hover:border-brasa inline-block mx-auto text-center transition-colors"
          >
            ← Seguir pidiendo
          </Link>
        </div>
      </div>

      {/* Modal de confirmación para enviar solo lo mío */}
      <Modal
        abierto={modalConfirmarAbierto}
        onCerrar={() => !enviando && setModalConfirmarAbierto(false)}
        titulo="¿ENVIAR A COCINA?"
        className="bg-papel text-tinta border-2 border-carbon shadow-2xl rounded-2xl max-w-sm"
      >
        <div className="p-4 space-y-4 bg-papel">
          <p className="text-xs text-papel-suave font-cuerpo leading-relaxed">
            Estás a punto de enviar tus platos a la cocina. Cada comensal de la
            mesa envía y paga sus propios platos.
          </p>

          {/* Lista resumida de platos a enviar */}
          <div className="bg-papel rounded-xl p-3 border-2 border-dashed border-papel-linea space-y-2 max-h-48 overflow-y-auto">
            {misLineas.map((linea) => (
              <div
                key={linea.id_linea}
                className="flex items-center justify-between text-xs py-1 border-b border-dashed border-papel-linea last:border-b-0"
              >
                <div className="flex-1 min-w-0 pr-2">
                  <span className="font-titulo text-base text-carbon tracking-wide truncate block">
                    {linea.nombre}
                  </span>
                  <span className="text-papel-suave font-cuerpo">
                    Cantidad: {linea.cantidad}
                  </span>
                </div>
                <span className="font-titulo font-bold text-base text-carbon shrink-0">
                  {formatearPrecio(
                    linea.subtotal ??
                      Number(linea.precioUnitario) * Number(linea.cantidad)
                  )}
                </span>
              </div>
            ))}
          </div>

          {notasGenerales && (
            <div className="text-xs bg-papel/80 p-2.5 rounded-xl border border-papel-linea text-papel-suave">
              <span className="font-bold text-carbon font-cuerpo block mb-0.5">
                Notas para la cocina:
              </span>
              <p className="font-manuscrita text-lg text-carbon">{notasGenerales}</p>
            </div>
          )}

          <div className="flex justify-between items-baseline pt-2 border-t-2 border-dashed border-papel-linea">
            <span className="font-titulo uppercase font-bold text-lg text-carbon">
              Total de tu pedido
            </span>
            <span className="font-titulo font-bold text-3xl text-brasa">
              {formatearPrecio(totalMio)}
            </span>
          </div>

          {!validacionEnvio.ok && (
            <div
              role="alert"
              className="p-3 bg-papel rounded-xl border border-brasa text-rojo-tinta text-xs font-semibold"
            >
              {validacionEnvio.motivo}
            </div>
          )}

          {errorPedidoVisible && (
            <div
              role="alert"
              className="p-3 bg-papel rounded-xl border border-brasa text-rojo-tinta text-xs space-y-1"
            >
              <p className="font-bold">{errorPedidoVisible.mensaje}</p>
              {errorPedidoVisible.ayuda && (
                <p className="text-papel-suave">{errorPedidoVisible.ayuda}</p>
              )}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Button
              type="button"
              variante="primario"
              onClick={manejarConfirmarPedido}
              disabled={enviando || !validacionEnvio.ok}
              className="btn-comanda w-full min-h-12 py-3 px-4 font-bold font-titulo uppercase text-lg rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              {enviando ? (
                <>
                  <span
                    className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-ambar border-t-transparent"
                    aria-hidden="true"
                  />
                  <span>Enviando a cocina…</span>
                </>
              ) : (
                <span>Confirmar y enviar</span>
              )}
            </Button>
            <Button
              type="button"
              variante="secundario"
              onClick={() => setModalConfirmarAbierto(false)}
              disabled={enviando}
              className="btn-comanda btn-comanda-borde w-full min-h-11 font-titulo uppercase text-base cursor-pointer"
            >
              Revisar platos
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default Carrito;
