import { formatearPrecio } from '../../utils/formato.js';
import { ETIQUETAS_MAP } from '../../constants/dieta.js';
import Imagen from '../ui/Imagen.jsx';

function PlatoCard({ plato, onSeleccionar, soloLectura = true }) {
  const { nombre, descripcion, precio, imagen, etiquetas, disponible = true } = plato;

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSeleccionar?.(plato);
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`Ver detalle de ${nombre}`}
      onClick={() => onSeleccionar?.(plato)}
      onKeyDown={handleKeyDown}
      className={`bg-superficie rounded-2xl border border-borde overflow-hidden flex gap-3 p-3 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto group ${
        !disponible
          ? 'opacity-40 grayscale-[25%]'
          : 'hover:border-primario/40 hover:-translate-y-0.5'
      }`}
    >
      {/* Contenedor de Imagen con overlay si está agotado */}
      <div className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-superficie-2 border border-borde">
        <Imagen
          src={imagen}
          alt={nombre}
          width={96}
          height={96}
          aspecto="1/1"
          className="w-full h-full"
        />
        {!disponible && (
          <span className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex items-center justify-center text-primario-texto text-xs font-etiqueta font-bold uppercase tracking-wider text-center px-1">
            AGOTADO
          </span>
        )}
      </div>

      {/* Información del plato */}
      <div className="flex flex-col justify-between flex-1 min-w-0">
        <div>
          <div className="flex items-start justify-between gap-1">
            <h3 className="font-etiqueta font-bold text-texto text-lg leading-snug uppercase tracking-wide truncate">
              {nombre}
            </h3>
            {!disponible && (
              <span className="shrink-0 text-[10px] font-etiqueta font-bold uppercase text-primario-texto bg-primario/15 border border-primario/30 px-1.5 py-0.5 rounded">
                AGOTADO
              </span>
            )}
          </div>
          {descripcion && (
            <p className="text-xs text-texto-suave font-cuerpo line-clamp-2 mt-0.5">
              {descripcion}
            </p>
          )}

          {/* Badges de etiquetas */}
          {etiquetas && etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {etiquetas.map((tag) => {
                const conf = ETIQUETAS_MAP[tag] || {
                  label: tag.replace('_', ' '),
                  style:
                    'bg-superficie-2 text-texto-suave border border-borde font-etiqueta text-[10px] uppercase font-semibold',
                };
                return (
                  <span
                    key={tag}
                    className={`px-1.5 py-0.5 rounded ${conf.style}`}
                  >
                    {conf.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Precio y Ver detalle */}
        <div className="mt-2 flex items-center justify-between">
          <span className="font-etiqueta font-bold text-texto text-xl tracking-wide">
            {formatearPrecio(precio)}
          </span>
          {soloLectura && (
            <span className="text-xs font-etiqueta uppercase tracking-wider text-texto-suave group-hover:text-texto transition-colors">
              Ver detalle →
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export default PlatoCard;
