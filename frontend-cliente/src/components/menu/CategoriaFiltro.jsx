function CategoriaFiltro({
  categorias = [],
  categoriaSeleccionada = null,
  onSeleccionar,
}) {
  const esTodasSeleccionada =
    categoriaSeleccionada === null || categoriaSeleccionada === 'todas';

  return (
    <div className="overflow-x-auto pb-2 scrollbar-none">
      <div className="flex gap-2 min-w-max">
        {/* Chip Todas */}
        <button
          type="button"
          onClick={() => onSeleccionar && onSeleccionar(null)}
          className={`min-h-10 px-4 py-1.5 rounded-full text-sm font-etiqueta uppercase tracking-wider inline-flex items-center justify-center transition-all cursor-pointer select-none shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto ${
            esTodasSeleccionada
              ? 'bg-primario text-white font-bold shadow-sm border border-primario'
              : 'bg-superficie-2 text-texto-suave border border-borde hover:text-texto hover:bg-superficie font-semibold'
          }`}
        >
          TODAS
        </button>

        {/* Chips de Categorías */}
        {categorias.map((cat) => {
          const esActiva = categoriaSeleccionada === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSeleccionar && onSeleccionar(cat.id)}
              className={`min-h-10 px-4 py-1.5 rounded-full text-sm font-etiqueta uppercase tracking-wider inline-flex items-center justify-center transition-all cursor-pointer select-none shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto ${
                esActiva
                  ? 'bg-primario text-white font-bold shadow-sm border border-primario'
                  : 'bg-superficie-2 text-texto-suave border border-borde hover:text-texto hover:bg-superficie font-semibold'
              }`}
            >
              {cat.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CategoriaFiltro;
