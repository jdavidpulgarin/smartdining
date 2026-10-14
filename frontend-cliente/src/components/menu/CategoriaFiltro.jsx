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
          className={`min-h-12 px-4 py-2 rounded-full text-sm inline-flex items-center justify-center transition-all cursor-pointer select-none shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            esTodasSeleccionada
              ? 'bg-primary text-white font-semibold shadow-sm'
              : 'bg-white text-cafe border border-gray-200 hover:bg-primary/10 font-medium'
          }`}
        >
          Todas
        </button>

        {/* Chips de Categorías */}
        {categorias.map((cat) => {
          const esActiva = categoriaSeleccionada === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSeleccionar && onSeleccionar(cat.id)}
              className={`min-h-12 px-4 py-2 rounded-full text-sm inline-flex items-center justify-center transition-all cursor-pointer select-none shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                esActiva
                  ? 'bg-primary text-white font-semibold shadow-sm'
                  : 'bg-white text-cafe border border-gray-200 hover:bg-primary/10 font-medium'
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
