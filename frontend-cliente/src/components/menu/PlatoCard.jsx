import { formatearPrecio } from '../../utils/formato';
import { ETIQUETAS_MAP } from '../../constants/dieta';
import Imagen from '../ui/Imagen';

function PlatoCard({ plato, onSeleccionar }) {
  const { nombre, descripcion, precio, imagen, etiquetas, disponible = true } = plato;

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSeleccionar?.(plato);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      onClick={() => onSeleccionar?.(plato)}
      onKeyDown={handleKeyDown}
      className={`grid grid-cols-[104px_1fr] gap-3.5 items-start bg-papel text-tinta rounded-[18px] p-3 shadow-[0_16px_26px_-18px_rgba(0,0,0,0.65)] anim-entra transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa ${
        !disponible ? 'opacity-40 grayscale-[25%]' : 'hover:shadow-lg'
      }`}
    >
      {/* Contenedor de Imagen con overlay si está agotado */}
      <div className="relative w-[104px] h-[104px] shrink-0 rounded-xl overflow-hidden bg-carbon/5 border border-papel-linea">
        <Imagen
          src={imagen}
          alt={nombre}
          width={104}
          height={104}
          aspecto="1/1"
          className="w-full h-full object-cover rounded-xl"
        />
        {!disponible && (
          <span className="absolute inset-0 bg-carbon/75 backdrop-blur-[1px] flex items-center justify-center text-ambar text-xs font-titulo font-bold uppercase tracking-wider text-center px-1">
            AGOTADO
          </span>
        )}
      </div>

      {/* Información del plato */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-1">
          <h3 className="font-titulo text-[27px] leading-[1.02] tracking-[0.02em] text-carbon uppercase truncate mt-0.5">
            {nombre}
          </h3>
          {!disponible && (
            <span className="shrink-0 text-[11px] font-titulo font-bold uppercase text-rojo-tinta bg-brasa/10 border border-brasa/30 px-1.5 py-0.5 rounded">
              AGOTADO
            </span>
          )}
        </div>
        <p className="text-[14px] leading-[1.4] text-papel-suave font-cuerpo line-clamp-2 mt-1">
          {descripcion}
        </p>

        {/* Badges de etiquetas */}
        {etiquetas && etiquetas.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {etiquetas.map((tag) => {
              const conf = ETIQUETAS_MAP[tag] || {
                label: tag.replace('_', ' '),
                style: 'bg-carbon/10 text-carbon border border-carbon/20 font-titulo text-[11px] uppercase font-semibold',
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

      {/* Fila inferior: línea punteada, precio en Bebas rojo y botón AGREGAR */}
      <div className="col-span-2 flex items-center justify-between border-t-[3px] border-dashed border-papel-linea pt-2.5 mt-0.5">
        <b className="font-titulo text-[32px] leading-none text-rojo-tinta tracking-[0.02em]">
          {formatearPrecio(precio)}
        </b>
        <span
          aria-hidden="true"
          className="flex items-center gap-2 min-h-11 min-w-11 px-4 rounded-full font-titulo text-[21px] tracking-[0.08em] bg-carbon text-ambar select-none pointer-events-none"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" className="w-5 h-5" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>AGREGAR</span>
        </span>
      </div>
    </div>
  );
}

export default PlatoCard;
