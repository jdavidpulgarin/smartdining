const ETIQUETAS_MAP = {
  vegetariano: { label: 'Vegetariano', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  vegano: { label: 'Vegano', style: 'bg-green-50 text-green-700 border-green-200' },
  sin_gluten: { label: 'Sin gluten', style: 'bg-amber-50 text-amber-700 border-amber-200' },
};

function PlatoCard({ plato }) {
  const { nombre, descripcion, precio, imagen, etiquetas, disponible = true } = plato;

  const precioFormateado = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(precio);

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex gap-3 p-3 transition-all ${
        !disponible ? 'opacity-65 grayscale-[25%]' : 'hover:shadow-md'
      }`}
    >
      {/* Contenedor de Imagen con overlay de Agotado */}
      <div className="relative w-24 h-24 shrink-0 rounded-lg overflow-hidden bg-gray-100">
        <img
          src={imagen}
          alt={nombre}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {!disponible && (
          <span className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center text-white text-[11px] font-extrabold uppercase tracking-wider text-center px-1">
            Agotado
          </span>
        )}
      </div>

      {/* Información del plato */}
      <div className="flex flex-col justify-between flex-1 min-w-0">
        <div>
          <div className="flex items-start justify-between gap-1">
            <h3 className="font-bold text-gray-900 text-base leading-snug truncate">
              {nombre}
            </h3>
            {!disponible && (
              <span className="shrink-0 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
                Agotado
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 line-clamp-2 mt-1">
            {descripcion}
          </p>

          {/* Badges de etiquetas */}
          {etiquetas && etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {etiquetas.map((tag) => {
                const conf = ETIQUETAS_MAP[tag] || {
                  label: tag.replace('_', ' '),
                  style: 'bg-gray-50 text-gray-600 border-gray-200',
                };
                return (
                  <span
                    key={tag}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${conf.style}`}
                  >
                    {conf.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Precio */}
        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-extrabold text-blue-600 text-sm">
            {precioFormateado}
          </span>
        </div>
      </div>
    </div>
  );
}

export default PlatoCard;
