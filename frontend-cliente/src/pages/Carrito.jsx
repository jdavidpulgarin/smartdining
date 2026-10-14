import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCarrito } from '../context/CarritoContext';
import { formatearPrecio } from '../utils/formato';
import { obtenerApodo } from '../utils/apodo';
import LineaCarrito from '../components/carrito/LineaCarrito';
import Button from '../components/ui/Button';
import { crearPedido } from '../services/pedidoService';
import { recargarMenu } from '../services/menuService';
import { traducirErrorPedido } from '../utils/erroresPedido';

function Carrito() {
  const navigate = useNavigate();
  const {
    lineas,
    totalUnidades,
    total,
    actualizarCantidad,
    eliminarLinea,
    vaciarCarrito,
  } = useCarrito();

  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);
  const [notasGenerales, setNotasGenerales] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorPedido, setErrorPedido] = useState(null);
  const [bloqueoSegundos, setBloqueoSegundos] = useState(0);

  const miNombre = obtenerApodo();

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
    if (enviando || bloqueoSegundos > 0) return;

    setEnviando(true);
    setErrorPedido(null);

    try {
      const respuesta = await crearPedido({
        lineas,
        notasGenerales,
      });

      vaciarCarrito();
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

  if (lineas.length === 0) {
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

      {/* Barra de conteo y botón vaciar */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-texto-suave font-medium">
          {totalUnidades} {totalUnidades === 1 ? 'producto' : 'productos'}
        </span>

        {confirmandoVaciar ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                vaciarCarrito();
                setConfirmandoVaciar(false);
              }}
              className="text-xs font-bold text-primario-texto hover:underline px-2 py-1 rounded transition-colors cursor-pointer"
            >
              Sí, vaciar
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
            Vaciar carrito
          </button>
        )}
      </div>

      {/* Sección LO TUYO con borde rojo */}
      <section className="bg-superficie rounded-2xl border-2 border-primario p-3.5 sm:p-4 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-borde">
          <h2 className="font-etiqueta font-bold text-base uppercase tracking-wider text-white">
            LO TUYO{miNombre ? ` · ${miNombre.toUpperCase()}` : ''}
          </h2>
          <span className="font-etiqueta font-bold text-base text-white">
            {formatearPrecio(total)}
          </span>
        </div>

        <div className="space-y-3">
          {lineas.map((linea) => (
            <LineaCarrito
              key={linea.id_linea}
              linea={linea}
              onActualizarCantidad={actualizarCantidad}
              onEliminar={eliminarLinea}
            />
          ))}
        </div>
      </section>

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
            Subtotal ({totalUnidades}{' '}
            {totalUnidades === 1 ? 'producto' : 'productos'})
          </span>
          <span className="font-etiqueta font-bold text-texto text-base">
            {formatearPrecio(total)}
          </span>
        </div>
        <div className="border-t border-borde pt-3 flex justify-between items-center">
          <span className="font-etiqueta uppercase font-bold text-texto text-lg tracking-wide">
            Total estimado
          </span>
          <span className="font-etiqueta font-black text-2xl text-white">
            {formatearPrecio(total)}
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
          onClick={manejarConfirmarPedido}
          disabled={enviando || bloqueoSegundos > 0}
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
          ) : bloqueoSegundos > 0 ? (
            <span>Espera {bloqueoSegundos}s...</span>
          ) : (
            <span>Enviar pedido a cocina</span>
          )}
        </Button>
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
    </div>
  );
}

export default Carrito;
