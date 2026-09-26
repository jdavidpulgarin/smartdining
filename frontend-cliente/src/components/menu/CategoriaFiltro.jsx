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
          className={`px-4 py-2 rounded-full text-sm transition-all cursor-pointer select-none shrink-0 ${
            esTodasSeleccionada
              ? 'bg-blue-600 text-white font-semibold shadow-sm'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium'
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
              className={`px-4 py-2 rounded-full text-sm transition-all cursor-pointer select-none shrink-0 ${
                esActiva
                  ? 'bg-blue-600 text-white font-semibold shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 font-medium'
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
