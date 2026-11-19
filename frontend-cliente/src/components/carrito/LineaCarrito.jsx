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
      className={`border-b-2 border-dashed border-[#E6D6C4] last:border-b-0 py-3.5 px-4 sm:px-5 transition-colors ${
        tieneFaltante ? 'bg-brasa/5' : ''
      }`}
    >
      <div className="grid grid-cols-[70px_1fr_auto] gap-3 items-center">
        {/* Foto cuadrada redondeada */}
        <Imagen
          src={imagenUrl}
          alt={linea.nombre}
          width={70}
          height={70}
          aspecto="1/1"
          className="w-[70px] h-[70px] rounded-xl shrink-0 border border-papel-linea object-cover"
        />

        {/* Información del plato */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-titulo uppercase text-[23px] font-bold text-carbon leading-tight tracking-[0.03em] truncate">
              {linea.nombre}
            </h3>
            {tieneFaltante && (
              <span className="inline-flex items-center text-[11px] font-titulo uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-brasa/15 text-rojo-tinta border border-brasa/30">
                {mensajeFaltante}
              </span>
            )}
          </div>

          {mostrarComensal && linea.comensal && (
            <span className="inline-flex items-center text-[11px] font-titulo uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-carbon/5 text-papel-suave border border-papel-linea mt-0.5">
              Para {linea.comensal}
            </span>
          )}

          {Array.isArray(linea.detalle) && linea.detalle.length > 0 && (
            <p className="text-xs text-papel-suave leading-snug mt-1 font-cuerpo">
              {linea.detalle
                .map((item) => `${item.nombre} (${item.porcion})`)
                .join(' · ')}
            </p>
          )}

          {esPlatoConstructorConFaltante && nombresIngFaltantes.length > 0 && (
            <p className="text-xs font-semibold text-rojo-tinta mt-1 font-cuerpo">
              Ingrediente agotado: {nombresIngFaltantes.join(', ')}
            </p>
          )}

          {linea.notas && (
            <p className="text-xs text-papel-suave/80 italic leading-snug mt-0.5 font-cuerpo">
              {linea.notas}
            </p>
          )}

          {/* Selector de cantidad o texto de solo lectura */}
          {soloLectura ? (
            <div className="inline-block text-xs font-titulo uppercase font-bold text-papel-suave bg-carbon/5 px-2.5 py-1 rounded-lg border border-papel-linea mt-2">
              Cantidad: {linea.cantidad}
            </div>
          ) : (
            <div className="inline-flex items-center border-2 border-carbon rounded-full overflow-hidden bg-white/70 mt-2">
              <button
                type="button"
                onClick={() =>
                  onActualizarCantidad?.(linea.id_linea, linea.cantidad - 1)
                }
                disabled={linea.cantidad <= 1}
                aria-label={`Disminuir cantidad de ${linea.nombre}`}
                className="w-11 h-11 min-w-11 min-h-11 flex items-center justify-center font-bold text-base text-carbon hover:bg-amber-100 active:bg-amber-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                −
              </button>
              <output
                aria-live="polite"
                className="min-w-6 text-center font-bold font-titulo text-carbon text-lg"
              >
                {linea.cantidad}
              </output>
              <button
                type="button"
                onClick={() =>
                  onActualizarCantidad?.(linea.id_linea, linea.cantidad + 1)
                }
                disabled={linea.cantidad >= 20 || tieneFaltante}
                aria-label={`Aumentar cantidad de ${linea.nombre}`}
                className="w-11 h-11 min-w-11 min-h-11 flex items-center justify-center font-bold text-base text-carbon hover:bg-amber-100 active:bg-amber-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                +
              </button>
            </div>
          )}
        </div>

        {/* Columna derecha: Precio y Papelera */}
        <div className="flex flex-col items-end gap-2.5 shrink-0 pl-1">
          <b className="whitespace-nowrap font-titulo text-[25px] leading-none text-rojo-tinta tracking-[0.02em]">
            {formatearPrecio(subtotal)}
          </b>
          {linea.cantidad > 1 && (
            <span className="text-[11px] text-papel-suave font-cuerpo">
              {formatearPrecio(linea.precioUnitario)} c/u
            </span>
          )}

          {!soloLectura && onEliminar && (
            <button
              type="button"
              onClick={() => onEliminar(linea.id_linea)}
              aria-label={`Eliminar ${linea.nombre} del carrito`}
              className="w-11 h-11 min-w-11 min-h-11 rounded-xl bg-[#F3E3D1] hover:bg-brasa/15 text-rojo-tinta flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
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
      </div>

      {/* Acción rápida para ajustar cantidad o quitar plato cuando hay faltante */}
      {!soloLectura && onEliminar && tieneFaltante && (
        <div className="flex items-center justify-between gap-2 pt-2.5 mt-2 border-t border-dashed border-papel-linea">
          <span className="text-xs text-rojo-tinta font-semibold font-cuerpo">
            {disponible !== null && disponible > 0
              ? `Solo quedan ${disponible}`
              : esPlatoConstructorConFaltante
                ? 'Un ingrediente de este plato se acabó'
                : 'Agotado'}
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
                className="min-h-11 px-3.5 py-1.5 rounded-xl bg-ambar hover:bg-ambar/90 text-carbon font-titulo uppercase tracking-wider font-bold text-sm transition-colors cursor-pointer shrink-0"
              >
                Ajustar a {disponible}
              </button>
            )}
            <button
              type="button"
              onClick={() => onEliminar(linea.id_linea)}
              className="min-h-11 px-3.5 py-1.5 rounded-xl bg-brasa hover:bg-rojo-tinta text-papel font-titulo uppercase tracking-wider font-bold text-sm transition-colors cursor-pointer shrink-0"
            >
              Quitar plato
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default LineaCarrito;
