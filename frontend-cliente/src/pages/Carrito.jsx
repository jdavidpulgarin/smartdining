import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCarrito } from '../context/CarritoContext';
import { formatearPrecio } from '../utils/formato';
import LineaCarrito from '../components/carrito/LineaCarrito';

function Carrito() {
  const {
    lineas,
    totalUnidades,
    total,
    actualizarCantidad,
    eliminarLinea,
    vaciarCarrito,
  } = useCarrito();
  const [confirmandoVaciar, setConfirmandoVaciar] = useState(false);

  if (lineas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <div
          aria-hidden="true"
          className="w-20 h-20 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center text-3xl mb-4 shadow-inner"
        >
          🛒
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Tu carrito está vacío
        </h2>
        <p className="text-sm text-gray-500 max-w-xs mb-6">
          Aún no has agregado ningún plato a tu pedido. Revisa nuestro menú para
          elegir tus favoritos.
        </p>
        <Link
          to="/menu"
          className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm rounded-xl transition-colors shadow-sm"
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
          <h1 className="text-xl font-extrabold text-gray-900">Tu Carrito</h1>
          <p className="text-xs text-gray-500">
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
              className="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              Sí, vaciar
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoVaciar(false)}
              className="text-xs font-semibold text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmandoVaciar(true)}
            className="text-xs font-medium text-gray-500 hover:text-red-600 py-1.5 px-2 rounded-lg hover:bg-gray-100 transition-colors"
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

      {/* Resumen del pedido y botón confirmar */}
      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
        <div className="flex justify-between items-center text-sm text-gray-500">
          <span>
            Subtotal ({totalUnidades}{' '}
            {totalUnidades === 1 ? 'producto' : 'productos'})
          </span>
          <span className="font-semibold text-gray-700">
            {formatearPrecio(total)}
          </span>
        </div>
        <div className="border-t border-gray-100 pt-3 flex justify-between items-center">
          <span className="font-bold text-gray-900 text-base">Total</span>
          <span className="font-black text-xl text-blue-600">
            {formatearPrecio(total)}
          </span>
        </div>
      </div>

      {/* Acciones finales: confirmar pedido (deshabilitado) y volver al menú */}
      <div className="space-y-2 pt-2">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="w-full min-h-12 py-3 px-4 bg-gray-200 text-gray-500 font-bold text-base rounded-xl cursor-not-allowed flex flex-col items-center justify-center gap-0.5"
        >
          <span>Confirmar pedido</span>
          <span className="text-xs font-semibold text-gray-400">
            (próximamente)
          </span>
        </button>

        <Link
          to="/menu"
          className="block w-full text-center py-2.5 text-sm font-semibold text-blue-600 hover:text-blue-700 active:text-blue-800 transition-colors"
        >
          ← Seguir pidiendo
        </Link>
      </div>
    </div>
  );
}

export default Carrito;
