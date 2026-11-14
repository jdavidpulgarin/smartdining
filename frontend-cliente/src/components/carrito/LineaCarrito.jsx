import { formatearPrecio } from '../../utils/formato';
import { urlImagen } from '../../utils/imagenes';
import Imagen from '../ui/Imagen';

function LineaCarrito({
  linea,
  onActualizarCantidad,
  onAjustarCantidad,
  onEliminar,
  soloLectura = false,
  mostrarComensal = false,
  faltantes = [],
  disponible: disponibleProp,
  puedeAjustar: puedeAjustarProp,
}) {
  const subtotal =
    linea.subtotal !== undefined
      ? Number(linea.subtotal)
      : (Number(linea.precioUnitario) || 0) * (Number(linea.cantidad) || 0);
  const imagenUrl = urlImagen(linea.imagen || linea.url_imagen);

  const faltantesLista = Array.isArray(faltantes) ? faltantes : [];
  const tieneFaltante =
    linea.disponible === false || faltantesLista.length > 0;
  const ingredientesFaltantes = faltantesLista.filter(
    (f) => f?.tipo === 'ingrediente'
  );
  const nombresIngFaltantes = ingredientesFaltantes
    .map((f) => f.nombre || `ingrediente #${f.id}`)
    .filter(Boolean);
  const esPlatoConstructorConFaltante =
    ingredientesFaltantes.length > 0 || Boolean(linea.ingredienteAgotado);

  const disponible =
    disponibleProp !== undefined
      ? disponibleProp
      : (faltantesLista.find((f) => f?.disponible !== undefined)?.disponible ?? null);

  const cantidadNum = Number(linea.cantidad) || 1;
  const puedeAjustar =
    puedeAjustarProp !== undefined
      ? Boolean(puedeAjustarProp)
      : Boolean(
          disponible !== null &&
          disponible > 0 &&
          disponible < cantidadNum
        );

  const mensajeFaltante =
    disponible !== null && disponible > 0
      ? `Solo quedan ${disponible}`
      : 'Agotado';

  return (
    <article
      className={`bg-superficie rounded-2xl p-3.5 sm:p-4 border shadow-sm flex flex-col gap-3 transition-colors ${
        tieneFaltante
          ? 'border-primario bg-primario/5'
          : 'border-borde'
      }`}
    >
      {/* Cabecera y cuerpo de la línea */}
      <div className="flex items-start gap-3">
        <Imagen
          src={imagenUrl}
          alt={linea.nombre}
          width={64}
          height={64}
          aspecto="1/1"
          className="w-16 h-16 rounded-xl shrink-0 border border-borde"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-etiqueta uppercase text-base font-bold text-texto leading-tight">
                  {linea.nombre}
                </h3>
                {tieneFaltante && (
                  <span className="inline-flex items-center text-[11px] font-etiqueta uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-superficie-2 text-primario border border-primario">
                    {mensajeFaltante}
                  </span>
                )}
              </div>
              {mostrarComensal && linea.comensal && (
                <span className="inline-flex items-center text-[11px] font-etiqueta uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-superficie-2 text-texto-suave border border-borde mt-1">
                  Para {linea.comensal}
                </span>
              )}
            </div>

            {/* Botón eliminar (solo si no es de solo lectura) */}
            {!soloLectura && onEliminar && (
              <button
                type="button"
                onClick={() => onEliminar(linea.id_linea)}
                aria-label={`Eliminar ${linea.nombre} del carrito`}
                className="w-11 h-11 min-h-11 min-w-11 flex items-center justify-center text-texto-suave hover:text-primario hover:bg-superficie-2 active:bg-superficie-2/80 rounded-lg transition-colors shrink-0 -mr-1 -mt-1 cursor-pointer"
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
            )}
          </div>

          {Array.isArray(linea.detalle) && linea.detalle.length > 0 && (
            <p className="text-xs text-texto-suave leading-snug mt-1.5">
              {linea.detalle
                .map((item) => `${item.nombre} (${item.porcion})`)
                .join(' · ')}
            </p>
          )}
          {esPlatoConstructorConFaltante && nombresIngFaltantes.length > 0 && (
            <p className="text-xs font-semibold text-primario-texto mt-1">
              Ingrediente agotado: {nombresIngFaltantes.join(', ')}
            </p>
          )}
          {linea.notas && (
            <p className="text-xs text-texto-tenue italic leading-snug mt-0.5">
              {linea.notas}
            </p>
          )}
        </div>
      </div>

      {/* Acción rápida para ajustar cantidad o quitar plato cuando hay faltante */}
      {!soloLectura && onEliminar && tieneFaltante && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-borde/60">
          <span className="text-xs text-primario-texto font-medium">
            {disponible !== null && disponible > 0
              ? `Solo quedan ${disponible}`
              : (esPlatoConstructorConFaltante
                  ? 'Un ingrediente de este plato se acabó'
                  : 'Agotado')}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {puedeAjustar && (onAjustarCantidad || onActualizarCantidad) && (
              <button
                type="button"
                onClick={() =>
                  onAjustarCantidad
                    ? onAjustarCantidad(linea.id_linea, disponible)
                    : onActualizarCantidad?.(linea.id_linea, disponible)
                }
                className="min-h-11 px-3.5 py-2 rounded-xl bg-acento hover:bg-acento/90 text-fondo font-etiqueta uppercase tracking-wider font-bold text-xs transition-colors cursor-pointer shrink-0"
              >
                Ajustar a {disponible}
              </button>
            )}
            <button
              type="button"
              onClick={() => onEliminar(linea.id_linea)}
              className="min-h-11 px-3.5 py-2 rounded-xl bg-primario hover:bg-primario-hover text-white font-etiqueta uppercase tracking-wider font-bold text-xs transition-colors cursor-pointer shrink-0"
            >
              Quitar plato
            </button>
          </div>
        </div>
      )}

      {/* Pie de la línea: selector de cantidad y precios */}
      <div className="flex items-center justify-between pt-2 border-t border-borde gap-2">
        {soloLectura ? (
          <div className="text-xs font-etiqueta uppercase font-bold text-texto-suave bg-superficie-2 px-2.5 py-1 rounded-lg border border-borde">
            Cantidad: {linea.cantidad}
          </div>
        ) : (
          /* Selector de cantidad */
          <div className="flex items-center gap-1 bg-superficie-2 border border-borde rounded-xl p-1">
            <button
              type="button"
              onClick={() =>
                onActualizarCantidad?.(linea.id_linea, linea.cantidad - 1)
              }
              disabled={linea.cantidad <= 1}
              aria-label={`Disminuir cantidad de ${linea.nombre}`}
              className="w-11 h-11 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-texto hover:text-primario hover:bg-superficie active:bg-superficie/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer font-bold text-base"
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
                onActualizarCantidad?.(linea.id_linea, linea.cantidad + 1)
              }
              disabled={linea.cantidad >= 20 || tieneFaltante}
              aria-label={`Aumentar cantidad de ${linea.nombre}`}
              className="w-11 h-11 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-texto hover:text-primario hover:bg-superficie active:bg-superficie/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer font-bold text-base"
            >
              +
            </button>
          </div>
        )}

        {/* Subtotal */}
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
    </article>
  );
}

export default LineaCarrito;
