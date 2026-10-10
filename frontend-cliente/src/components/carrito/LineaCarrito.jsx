import { formatearPrecio } from '../../utils/formato';

function LineaCarrito({ linea, onActualizarCantidad, onEliminar }) {
  const subtotal = (linea.precioUnitario || 0) * (linea.cantidad || 0);

  return (
    <article className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex flex-col gap-3">
      {/* Cabecera de la línea: nombre, comensal y botón eliminar */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-bold text-gray-900 text-base leading-tight">
              {linea.nombre}
            </h3>
            {linea.comensal && (
              <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                Para {linea.comensal}
              </span>
            )}
          </div>
          {linea.notas && (
            <p className="text-xs text-gray-500 italic leading-snug">
              {linea.notas}
            </p>
          )}
        </div>

        {/* Botón eliminar */}
        <button
          type="button"
          onClick={() => onEliminar(linea.id_linea)}
          aria-label={`Eliminar ${linea.nombre} del carrito`}
          className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 active:bg-red-100 rounded-lg transition-colors shrink-0 -mr-2 -mt-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.75}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>

      {/* Pie de la línea: selector de cantidad y precios */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-50 gap-2">
        {/* Selector de cantidad */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              onActualizarCantidad(linea.id_linea, linea.cantidad - 1)
            }
            disabled={linea.cantidad <= 1}
            aria-label={`Disminuir cantidad de ${linea.nombre}`}
            className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 text-lg font-bold hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            −
          </button>
          <span
            aria-live="polite"
            className="min-w-8 text-center font-bold text-gray-900 text-base"
          >
            {linea.cantidad}
          </span>
          <button
            type="button"
            onClick={() =>
              onActualizarCantidad(linea.id_linea, linea.cantidad + 1)
            }
            disabled={linea.cantidad >= 20}
            aria-label={`Aumentar cantidad de ${linea.nombre}`}
            className="w-11 h-11 flex items-center justify-center rounded-lg border border-gray-200 text-gray-700 text-lg font-bold hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            +
          </button>
        </div>

        {/* Precio y subtotal */}
        <div className="text-right">
          <div className="font-extrabold text-blue-600 text-base">
            {formatearPrecio(subtotal)}
          </div>
          {linea.cantidad > 1 && (
            <div className="text-xs text-gray-400">
              {formatearPrecio(linea.precioUnitario)} c/u
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export default LineaCarrito;
