import { formatearPrecio } from '../../utils/formato.js';

/**
 * Tarjeta de plato individual estilo póster de restaurante.
 * Renderizada como <button> accesible que abre el detalle al tocarla.
 * Presenta foto arriba (o degradado de respaldo), nombre con title y line-clamp-2,
 * descripción en 2 líneas y precio en ámbar.
 */
function PlatoCard({ plato, onSeleccionar, soloLectura = true }) {
  if (!plato) return null;

  const {
    nombre = '',
    descripcion = '',
    precio = 0,
    imagen,
    url_imagen,
    disponible = true,
  } = plato;

  const imagenUrl = imagen || url_imagen;

  return (
    <button
      type="button"
      onClick={() => onSeleccionar?.(plato)}
      aria-label={`Ver detalle de ${nombre}`}
      className={`group flex flex-col w-full text-left p-0 overflow-hidden bg-[#161010] border border-papel/15 rounded-xl hover:border-primario motion-safe:transition-all motion-safe:duration-200 hover:-translate-y-1 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto shadow-lg ${
        !disponible ? 'opacity-50 grayscale-[25%]' : ''
      }`}
    >
      {/* Contenedor de foto con respaldo de degradado */}
      <div className="relative aspect-[16/11] w-full overflow-hidden bg-gradient-to-br from-[#43201a] to-[#150c0c] shrink-0">
        {imagenUrl ? (
          <img
            src={imagenUrl}
            alt=""
            width={640}
            height={440}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}

        {!disponible && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px] flex items-center justify-center">
            <span className="font-titulo text-lg tracking-wider uppercase text-primario-texto bg-fondo/80 border border-primario/30 px-3 py-1 rounded">
              AGOTADO
            </span>
          </div>
        )}
      </div>

      {/* Cuerpo de la tarjeta */}
      <div className="p-4 sm:p-5 flex flex-col gap-2 flex-1 w-full">
        <h3
          title={nombre}
          className="font-titulo text-2xl uppercase tracking-wide text-papel line-clamp-2 leading-tight m-0"
        >
          {nombre}
        </h3>

        {descripcion && (
          <p className="font-cuerpo-poster text-sm text-papel/70 line-clamp-2 leading-relaxed m-0">
            {descripcion}
          </p>
        )}

        <div className="mt-auto pt-3 flex items-center justify-between gap-2 border-t border-papel/10">
          <span className="font-titulo text-2xl text-ambar tracking-wide">
            {formatearPrecio(precio)}
          </span>
          {soloLectura && (
            <span className="text-xs font-etiqueta uppercase tracking-wider text-papel/60 group-hover:text-papel transition-colors">
              Ver detalle →
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default PlatoCard;
