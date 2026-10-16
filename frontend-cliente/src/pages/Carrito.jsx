import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCarrito } from '../context/CarritoContext';
import { useMesaSocketContext } from '../context/MesaSocketContext';
import { formatearPrecio } from '../utils/formato';
import { obtenerApodo } from '../utils/apodo';
import { pluralizar } from '../utils/pluralizar';
import { puedoEnviar } from '../utils/carritoCompartido';
import LineaCarrito from '../components/carrito/LineaCarrito';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { crearPedido } from '../services/pedidoService';
import { recargarMenu } from '../services/menuService';
import { traducirErrorPedido } from '../utils/erroresPedido';

function Carrito() {
  const navigate = useNavigate();
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
  } = useCarrito();

  const { on: socketOn } = useMesaSocketContext();

  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);
  const [modalConfirmarAbierto, setModalConfirmarAbierto] = useState(false);
  const [notasGenerales, setNotasGenerales] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState(null);
  const [bloqueoSegundos, setBloqueoSegundos] = useState(0);
  const [toastPedido, setToastPedido] = useState(null);

  const miNombre = obtenerApodo();
  const validacionEnvio = puedoEnviar(misLineas);

  // Escuchar order:created en la mesa para notificar cuando otro comensal envía su pedido
  useEffect(() => {
    if (!socketOn) return undefined;
    const baja = socketOn('order:created', (data) => {
      const emisor =
        data?.pedido?.comensal || data?.pedido?.usuario || data?.pedido?.alias;
      const miAliasNorm = (miNombre || '').trim().toLowerCase();
      if (emisor && emisor.trim().toLowerCase() !== miAliasNorm) {
        setToastPedido(`${emisor} envió su pedido a cocina`);
        const timer = setTimeout(() => setToastPedido(null), 4000);
        return () => clearTimeout(timer);
      }
      return undefined;
    });
    return baja;
  }, [socketOn, miNombre]);

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
    if (enviando || bloqueoSegundos > 0 || !validacionEnvio.ok) return;

    setEnviando(true);
    setErrorPedido(null);

    try {
      const respuesta = await crearPedido({
        lineas: misLineas,
        notasGenerales,
      });

      setModalConfirmarAbierto(false);
      await vaciarCarrito();
      navigate('/seguimiento', { state: { pedido: respuesta } });
    } catch (err) {
      const infoError = traducirErrorPedido(err);
      if (infoError.ignorar) return;

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

  const estaVacioTotal = misLineas.length === 0 && otros.length === 0;

  if (estaVacioTotal) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-full bg-superficie border border-borde text-texto-suave flex items-center justify-center text-3xl mb-4 shadow-inner"
        >
          🛒
        </div>
        <h2 className="text-2xl font-titulo uppercase tracking-wider text-texto mb-2">
          Tu carrito está vacío
        </h2>
        <p className="text-sm text-texto-suave max-w-xs mb-6">
          Aún no has agregado ningún plato a tu pedido. Revisa nuestro menú para
          elegir tus favoritos.
        </p>
        <Link
          to="/menu"
          className="min-h-12 inline-flex items-center justify-center px-6 py-3 bg-primario hover:bg-primario-hover text-white font-etiqueta uppercase tracking-wider font-bold text-sm rounded-xl transition-colors shadow-sm"
        >
          Explorar menú
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Portada Hero Carrito */}
      <div className="-mx-4 -mt-4 mb-2 relative h-40 sm:h-48 overflow-hidden rounded-b-3xl bg-superficie">
        <img
          src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&q=80&auto=format"
          alt="Comida fresca"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-fondo via-fondo/75 to-fondo/20" />
        <div className="absolute bottom-0 inset-x-0 p-4">
          <h1 className="font-titulo text-4xl sm:text-5xl text-primario tracking-wider leading-none uppercase">
            CARRITO DE LA MESA
          </h1>
          <p className="text-xs text-texto-suave flex items-center gap-1.5 mt-1">
            <span className="w-2 h-2 rounded-full bg-exito inline-block" />
            Se actualiza en vivo con lo que piden todos
          </p>
        </div>
      </div>

      {/* Banner de estado de conexión compartida */}
      {modo === 'compartido' && estadoConexion !== 'conectado' && (
        <div
          role="status"
          className="bg-superficie rounded-2xl border border-borde p-3 flex items-center gap-3 text-xs text-texto-suave"
        >
          {estadoConexion === 'conectando' ||
          estadoConexion === 'reconectando' ? (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-acento animate-pulse shrink-0" />
              <span>
                Conectando con la mesa… Se sincronizarán los cambios
                automáticamente.
              </span>
            </>
          ) : (
            <>
              <span className="w-2.5 h-2.5 rounded-full bg-primario shrink-0" />
              <span className="text-primario-texto">
                Sin conexión con la mesa. Reintentando…
              </span>
            </>
          )}
        </div>
      )}

      {/* Toast temporal cuando otro comensal envía su pedido */}
      {toastPedido && (
        <div
          role="status"
          className="bg-superficie-2 border border-exito text-texto p-3.5 rounded-2xl flex items-center gap-2.5 text-xs font-semibold shadow-lg animate-fadeIn"
        >
          <span className="w-2 h-2 rounded-full bg-exito shrink-0" />
          <span>{toastPedido}</span>
        </div>
      )}

      {/* Barra de conteo y botón vaciar lo mío */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-texto-suave font-medium">
          {totalUnidades} {pluralizar(totalUnidades, 'producto', 'productos')} en tu
          pedido
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
                className="text-xs font-bold text-primario-texto hover:underline px-2 py-1 rounded transition-colors cursor-pointer"
              >
                Sí, vaciar lo mío
              </button>
              <button
                type="button"
                onClick={() => setConfirmandoVaciar(false)}
                className="text-xs font-semibold text-texto-suave hover:text-texto px-2 py-1 rounded transition-colors cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmandoVaciar(true)}
              className="text-xs font-medium text-texto-suave hover:text-primario-texto py-1 px-2 rounded transition-colors cursor-pointer"
            >
              Vaciar lo mío
            </button>
          ))}
      </div>

      {/* Sección LO TUYO con borde rojo */}
      <section className="bg-superficie rounded-2xl border-2 border-primario p-3.5 sm:p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-borde">
          <h2 className="font-etiqueta font-bold text-base uppercase tracking-wider text-white">
            LO TUYO{miNombre ? ` · ${miNombre.toUpperCase()}` : ''}
          </h2>
          <span className="font-etiqueta font-bold text-base text-white">
            {formatearPrecio(totalMio)}
          </span>
        </div>

        {misLineas.length === 0 ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-xs text-texto-suave">
              No tienes platos agregados a tu pedido personal.
            </p>
            <Link
              to="/menu"
              className="inline-block text-xs font-bold text-primario-texto hover:underline"
            >
              + Agregar platos desde el menú
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {misLineas.map((linea) => (
              <LineaCarrito
                key={linea.id_linea}
                linea={linea}
                onActualizarCantidad={actualizarCantidad}
                onEliminar={eliminarLinea}
              />
            ))}
          </div>
        )}
      </section>

      {/* Sección DE LA MESA (otros comensales, solo lectura) */}
      {modo === 'compartido' && otros.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center gap-2 px-1">
            <span className="w-2 h-2 rounded-full bg-texto-suave" />
            <h2 className="font-etiqueta uppercase font-bold text-sm text-texto-suave tracking-wider">
              DE LA MESA ({otros.reduce((acc, g) => acc + g.lineas.length, 0)}{' '}
              {pluralizar(
                otros.reduce((acc, g) => acc + g.lineas.length, 0),
                'plato',
                'platos'
              )}{' '}
              de otros comensales)
            </h2>
          </div>

          {otros.map((grupo) => (
            <section
              key={grupo.comensal}
              className="bg-superficie rounded-2xl border border-borde p-3.5 sm:p-4 space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-borde">
                <span className="font-etiqueta font-bold text-sm uppercase tracking-wider text-texto-suave">
                  De {grupo.comensal}
                </span>
                <span className="font-etiqueta font-bold text-sm text-texto-suave">
                  {formatearPrecio(grupo.subtotal)}
                </span>
              </div>

              <div className="space-y-3">
                {grupo.lineas.map((linea) => (
                  <LineaCarrito
                    key={linea.id_linea}
                    linea={linea}
                    soloLectura={true}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Notas generales para la cocina */}
      <div className="bg-superficie rounded-2xl p-4 border border-borde space-y-2">
        <label
          htmlFor="notas-generales-pedido"
          className="block text-xs font-etiqueta uppercase tracking-wider font-bold text-texto"
        >
          Notas para la cocina (opcional)
        </label>
        <textarea
          id="notas-generales-pedido"
          rows={2}
          maxLength={500}
          value={notasGenerales}
          onChange={(e) => setNotasGenerales(e.target.value)}
          placeholder="Ej. Traer todo al mismo tiempo, sin cubiertos plásticos..."
          className="w-full text-sm p-3 rounded-xl border border-borde bg-superficie-2 text-texto placeholder:text-texto-tenue focus:outline-none focus-visible:ring-2 focus-visible:ring-primario resize-none"
        />
      </div>

      {/* Resumen del pedido */}
      <div className="bg-superficie rounded-2xl p-4 border border-borde space-y-3">
        <div className="flex justify-between items-center text-sm text-texto-suave">
          <span>
            Subtotal lo tuyo ({misLineas.length}{' '}
            {pluralizar(misLineas.length, 'producto', 'productos')})
          </span>
          <span className="font-etiqueta font-bold text-texto text-base">
            {formatearPrecio(totalMio)}
          </span>
        </div>

        {modo === 'compartido' && totalMesa > totalMio && (
          <div className="flex justify-between items-center text-xs text-texto-tenue pt-1 border-t border-borde/50">
            <span>Total acumulado en la mesa</span>
            <span className="font-etiqueta font-semibold text-texto-suave text-sm">
              {formatearPrecio(totalMesa)}
            </span>
          </div>
        )}

        <div className="border-t border-borde pt-3 flex justify-between items-center">
          <span className="font-etiqueta uppercase font-bold text-texto text-lg tracking-wide">
            Total a pagar por ti
          </span>
          <span className="font-etiqueta font-black text-2xl text-white">
            {formatearPrecio(totalMio)}
          </span>
        </div>
      </div>

      {/* Mensaje de error si falla el pedido */}
      {errorPedido && (
        <div
          role="alert"
          className="p-4 bg-superficie rounded-2xl border border-primario text-primario-texto text-sm space-y-1 animate-fadeIn"
        >
          <p className="font-semibold">{errorPedido.mensaje}</p>
          {errorPedido.ayuda && (
            <p className="text-xs text-texto-suave font-medium">
              {errorPedido.ayuda}
            </p>
          )}
          {errorPedido.esConexion && (
            <button
              type="button"
              onClick={manejarConfirmarPedido}
              className="text-xs font-bold text-primario hover:underline pt-1 block cursor-pointer"
            >
              Reintentar ahora
            </button>
          )}
        </div>
      )}

      {/* Acciones finales: confirmar pedido y volver al menú */}
      <div className="space-y-2 pt-2">
        <Button
          type="button"
          variante="primario"
          onClick={() => setModalConfirmarAbierto(true)}
          disabled={
            enviando ||
            bloqueoSegundos > 0 ||
            misLineas.length === 0 ||
            !validacionEnvio.ok
          }
          className="w-full min-h-12 py-3 px-4 font-bold font-etiqueta uppercase text-base rounded-xl flex items-center justify-center gap-2"
        >
          {bloqueoSegundos > 0 ? (
            <span>Espera {bloqueoSegundos}s...</span>
          ) : (
            <span>Enviar mi pedido a cocina</span>
          )}
        </Button>

        {!validacionEnvio.ok && misLineas.length > 0 && (
          <p className="text-xs text-primario-texto text-center font-medium">
            {validacionEnvio.motivo}
          </p>
        )}

        <p className="text-xs text-texto-suave text-center">
          Se envía todo lo tuyo a la cocina. Cada quien paga lo suyo al final.
        </p>

        <Link
          to="/menu"
          className="min-h-11 inline-flex items-center justify-center w-full text-center py-2 text-sm font-semibold text-primario-texto hover:underline transition-colors"
        >
          ← Seguir pidiendo
        </Link>
      </div>

      {/* Modal de confirmación para enviar solo lo mío */}
      <Modal
        abierto={modalConfirmarAbierto}
        onCerrar={() => !enviando && setModalConfirmarAbierto(false)}
        titulo="Confirmar mi pedido"
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-texto-suave">
            Estás a punto de enviar tus platos a la cocina. Cada comensal de la
            mesa envía y paga sus propios platos.
          </p>

          {/* Lista resumida de platos a enviar */}
          <div className="bg-superficie-2 rounded-xl p-3 border border-borde space-y-2 max-h-48 overflow-y-auto">
            {misLineas.map((linea) => (
              <div
                key={linea.id_linea}
                className="flex items-center justify-between text-xs py-1 border-b border-borde/40 last:border-b-0"
              >
                <div className="flex-1 min-w-0 pr-2">
                  <span className="font-semibold text-texto truncate block">
                    {linea.nombre}
                  </span>
                  <span className="text-texto-tenue">
                    Cantidad: {linea.cantidad}
                  </span>
                </div>
                <span className="font-bold font-etiqueta text-sm text-white shrink-0">
                  {formatearPrecio(
                    linea.subtotal ??
                      Number(linea.precioUnitario) * Number(linea.cantidad)
                  )}
                </span>
              </div>
            ))}
          </div>

          {notasGenerales && (
            <div className="text-xs bg-superficie-2 p-2.5 rounded-xl border border-borde text-texto-suave">
              <span className="font-bold text-texto block mb-0.5">
                Notas para la cocina:
              </span>
              <p className="italic">{notasGenerales}</p>
            </div>
          )}

          <div className="flex justify-between items-center pt-2 border-t border-borde">
            <span className="font-etiqueta uppercase font-bold text-base text-texto">
              Total de tu pedido
            </span>
            <span className="font-etiqueta font-black text-2xl text-white">
              {formatearPrecio(totalMio)}
            </span>
          </div>

          {!validacionEnvio.ok && (
            <div
              role="alert"
              className="p-3 bg-superficie rounded-xl border border-primario text-primario-texto text-xs"
            >
              {validacionEnvio.motivo}
            </div>
          )}

          {errorPedido && (
            <div
              role="alert"
              className="p-3 bg-superficie rounded-xl border border-primario text-primario-texto text-xs space-y-1"
            >
              <p className="font-semibold">{errorPedido.mensaje}</p>
              {errorPedido.ayuda && (
                <p className="text-texto-suave">{errorPedido.ayuda}</p>
              )}
            </div>
          )}

          <div className="space-y-2 pt-2">
            <Button
              type="button"
              variante="primario"
              onClick={manejarConfirmarPedido}
              disabled={enviando || !validacionEnvio.ok}
              className="w-full min-h-12 py-3 px-4 font-bold font-etiqueta uppercase text-base rounded-xl flex items-center justify-center gap-2"
            >
              {enviando ? (
                <>
                  <span
                    className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"
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
              className="w-full min-h-11"
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
