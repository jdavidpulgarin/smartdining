function CategoriaFiltro({
  categorias = [],
  categoriaSeleccionada = null,
  onSeleccionar,
}) {
  const esTodasSeleccionada =
    categoriaSeleccionada === null || categoriaSeleccionada === 'todas';

  return (
    <div className="sticky top-[79px] z-20 flex gap-2.5 overflow-x-auto -mx-4 px-4 py-3.5 bg-ambar border-b-[3px] border-carbon scrollbar-none">
      {/* Chip Todas */}
      <button
        type="button"
        aria-pressed={esTodasSeleccionada}
        onClick={() => onSeleccionar && onSeleccionar(null)}
        className={`min-h-11 px-5 py-2 rounded-full font-titulo text-[21px] tracking-[0.07em] inline-flex items-center justify-center transition-colors cursor-pointer select-none shrink-0 border-2 border-carbon focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa ${
          esTodasSeleccionada
            ? 'bg-carbon text-ambar'
            : 'bg-papel text-carbon hover:bg-carbon hover:text-ambar'
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
            aria-pressed={esActiva}
            onClick={() => onSeleccionar && onSeleccionar(cat.id)}
            className={`min-h-11 px-5 py-2 rounded-full font-titulo text-[21px] tracking-[0.07em] inline-flex items-center justify-center transition-colors cursor-pointer select-none shrink-0 border-2 border-carbon focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa ${
              esActiva
                ? 'bg-carbon text-ambar'
                : 'bg-papel text-carbon hover:bg-carbon hover:text-ambar'
            }`}
          >
            {cat.nombre.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

export default CategoriaFiltro;
