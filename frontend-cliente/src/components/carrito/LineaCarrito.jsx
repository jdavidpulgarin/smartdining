import { Link } from 'react-router-dom';
import { formatearPrecio } from '../../utils/formato';

function LineaCarrito({ linea, onActualizarCantidad, onEliminar }) {
  const subtotal = (linea.precioUnitario || 0) * (linea.cantidad || 0);
  const imagenUrl = linea.imagen || linea.url_imagen;

  return (
    <article className="bg-superficie rounded-2xl p-3.5 sm:p-4 border border-borde shadow-sm flex flex-col gap-3">
      {/* Cabecera y cuerpo de la línea */}
      <div className="flex items-start gap-3">
        {imagenUrl && (
          <img
            src={imagenUrl}
            alt={linea.nombre}
            className="w-16 h-16 rounded-xl object-cover shrink-0 bg-superficie-2 border border-borde"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-etiqueta uppercase text-base font-bold text-texto leading-tight">
                {linea.nombre}
              </h3>
              {linea.comensal && (
                <span className="inline-flex items-center text-[11px] font-etiqueta uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-superficie-2 text-texto-suave border border-borde mt-1">
                  Para {linea.comensal}
                </span>
              )}
            </div>

            {/* Botón eliminar */}
            <button
              type="button"
              onClick={() => onEliminar(linea.id_linea)}
              aria-label={`Eliminar ${linea.nombre} del carrito`}
              className="w-9 h-9 min-h-9 flex items-center justify-center text-texto-suave hover:text-primario hover:bg-superficie-2 active:bg-superficie-2/80 rounded-lg transition-colors shrink-0 -mr-1 -mt-1 cursor-pointer"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
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

          {Array.isArray(linea.detalle) && linea.detalle.length > 0 && (
            <p className="text-xs text-texto-suave leading-snug mt-1.5">
              {linea.detalle
                .map((item) => `${item.nombre} (${item.porcion})`)
                .join(' · ')}
            </p>
          )}
          {linea.notas && (
            <p className="text-xs text-texto-tenue italic leading-snug mt-0.5">
              {linea.notas}
            </p>
          )}
        </div>
      </div>

      {/* Pie de la línea: selector de cantidad y precios */}
      <div className="flex items-center justify-between pt-2 border-t border-borde gap-2">
        {/* Selector de cantidad */}
        <div className="flex items-center gap-1 bg-superficie-2 border border-borde rounded-xl p-1">
          <button
            type="button"
            onClick={() =>
              onActualizarCantidad(linea.id_linea, linea.cantidad - 1)
            }
            disabled={linea.cantidad <= 1}
            aria-label={`Disminuir cantidad de ${linea.nombre}`}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-texto hover:text-primario hover:bg-superficie active:bg-superficie/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer font-bold text-base"
          >
            −
          </button>
          <span
            aria-live="polite"
            className="min-w-6 text-center font-bold font-etiqueta text-texto text-sm"
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
            className="w-8 h-8 flex items-center justify-center rounded-lg text-texto hover:text-primario hover:bg-superficie active:bg-superficie/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer font-bold text-base"
          >
            +
          </button>
        </div>

        {/* Acciones y Subtotal */}
        <div className="flex items-center gap-3">
          {linea.id_plato && (
            <Link
              to={`/armar/${linea.id_plato}`}
              className="text-xs font-semibold text-primario-texto hover:underline cursor-pointer"
            >
              Editar plato
            </Link>
          )}
          <div className="text-right">
            <div className="font-bold font-etiqueta text-base text-white">
              {formatearPrecio(subtotal)}
            </div>
            {linea.cantidad > 1 && (
              <div className="text-[11px] text-texto-suave">
                {formatearPrecio(linea.precioUnitario)} c/u
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default LineaCarrito;
