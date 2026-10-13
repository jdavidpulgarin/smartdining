import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCarrito } from '../context/CarritoContext';
import { formatearPrecio } from '../utils/formato';
import LineaCarrito from '../components/carrito/LineaCarrito';
import Button from '../components/ui/Button';
import { crearPedido } from '../services/pedidoService';
import { recargarMenu } from '../services/menuService';
import { ErrorApi } from '../services/api';

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
      if (err?.status === 401) {
        // El manejador central en api.js borra sesión y redirige a /despedida
        return;
      }

      if (err instanceof ErrorApi || err?.name === 'ErrorApi') {
        if (err.status === 409) {
          recargarMenu();
          setErrorPedido({
            tipo: 409,
            mensaje:
              err.mensaje || 'El plato o ingrediente seleccionado se agotó.',
            ayuda: 'Revisa tu pedido: algo se agotó en cocina',
          });
        } else if (err.status === 429) {
          const seg = err.retryAfter || 60;
          setBloqueoSegundos(seg);
          setErrorPedido({
            tipo: 429,
            mensaje: `Demasiados intentos. Espera ${seg} segundos`,
          });
        } else if (err.status === 0 || err.motivo === 'sin_conexion') {
          setErrorPedido({
            tipo: 0,
            mensaje:
              'No pudimos enviar tu pedido. Revisa tu conexión a internet e intenta de nuevo',
            esConexion: true,
          });
        } else if (err.status === 400 || err.status === 422) {
          setErrorPedido({
            tipo: err.status,
            mensaje: err.mensaje || 'Revisa los datos del pedido',
          });
        } else {
          setErrorPedido({
            tipo: err.status,
            mensaje: err.mensaje || 'Ocurrió un error al enviar el pedido',
          });
        }
      } else {
        setErrorPedido({
          tipo: 'local',
          mensaje: err.message || 'Error al procesar el pedido',
        });
      }
    } finally {
      setEnviando(false);
    }
  };

  if (lineas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-3xl mb-4 shadow-inner"
        >
          🛒
        </div>
        <h2 className="text-xl font-bold text-cafe mb-2">
          Tu carrito está vacío
        </h2>
        <p className="text-sm text-gray-600 max-w-xs mb-6">
          Aún no has agregado ningún plato a tu pedido. Revisa nuestro menú para
          elegir tus favoritos.
        </p>
        <Link
          to="/menu"
          className="min-h-12 inline-flex items-center justify-center px-6 py-3 bg-primary hover:bg-primary-hover active:bg-primary-hover text-white font-bold text-sm rounded-xl transition-colors shadow-sm"
        >
          Explorar menú
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      {/* Título de la página y botón vaciar */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-cafe">Tu Carrito</h1>
          <p className="text-xs text-gray-600">
            {totalUnidades} {totalUnidades === 1 ? 'producto' : 'productos'}
          </p>
        </div>

        {confirmandoVaciar ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                vaciarCarrito();
                setConfirmandoVaciar(false);
              }}
              className="min-h-12 text-xs font-bold text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Sí, vaciar
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoVaciar(false)}
              className="min-h-12 text-xs font-semibold text-cafe hover:text-cafe bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmandoVaciar(true)}
            className="min-h-12 text-xs font-medium text-gray-600 hover:text-primary py-1.5 px-3 rounded-lg hover:bg-primary/10 transition-colors cursor-pointer"
          >
            Vaciar carrito
          </button>
        )}
      </div>

      {/* Lista de líneas */}
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

      {/* Notas generales para la cocina */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-2">
        <label
          htmlFor="notas-generales-pedido"
          className="block text-xs font-bold text-cafe"
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
          className="w-full text-sm p-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none bg-gray-50/50 text-cafe"
        />
      </div>

      {/* Resumen del pedido y botón confirmar */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>
            Subtotal ({totalUnidades}{' '}
            {totalUnidades === 1 ? 'producto' : 'productos'})
          </span>
          <span className="font-semibold text-cafe">
            {formatearPrecio(total)}
          </span>
        </div>
        <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
          <span className="font-bold text-cafe text-base">Total estimado</span>
          <span className="font-black text-xl text-primary">
            {formatearPrecio(total)}
          </span>
        </div>
      </div>

      {/* Mensaje de error si falla el pedido */}
      {errorPedido && (
        <div
          role="alert"
          className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm space-y-1 animate-fadeIn"
        >
          <p className="font-semibold">{errorPedido.mensaje}</p>
          {errorPedido.ayuda && (
            <p className="text-xs text-red-600 font-medium">
              {errorPedido.ayuda}
            </p>
          )}
          {errorPedido.esConexion && (
            <button
              type="button"
              onClick={manejarConfirmarPedido}
              className="text-xs font-bold text-red-800 underline hover:no-underline pt-1 block cursor-pointer"
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
          onClick={manejarConfirmarPedido}
          disabled={enviando || bloqueoSegundos > 0}
          className="w-full min-h-12 py-3 px-4 font-bold text-base rounded-xl flex items-center justify-center gap-2"
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
            <span>Confirmar pedido</span>
          )}
        </Button>

        <Link
          to="/menu"
          className="min-h-12 inline-flex items-center justify-center w-full text-center py-2.5 text-sm font-semibold text-primary hover:text-primary-hover active:text-primary-hover transition-colors"
        >
          ← Seguir pidiendo
        </Link>
      </div>
    </div>
  );
}

export default Carrito;
