function CategoriaFiltro({
  categorias = [],
  categoriaSeleccionada = null,
  seleccionada = null,
  onSeleccionar,
}) {
  const catSel = categoriaSeleccionada ?? seleccionada;
  const esTodasSeleccionada =
    catSel === null || catSel === 'todas' || catSel === 'todos';

  return (
    <div
      role="tablist"
      aria-label="Categorías de la carta"
      className="flex gap-2.5 overflow-x-auto py-2 mb-8 scrollbar-none whitespace-nowrap"
    >
      <button
        type="button"
        role="tab"
        aria-selected={esTodasSeleccionada}
        onClick={() => onSeleccionar && onSeleccionar(null)}
        className={`shrink-0 min-h-[46px] px-5 py-2 rounded-full font-titulo text-lg tracking-wider uppercase transition-colors cursor-pointer border focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto ${
          esTodasSeleccionada
            ? 'bg-primario text-white border-primario font-bold shadow-md'
            : 'bg-transparent text-papel/80 border-papel/15 hover:border-papel/60 font-medium'
        }`}
      >
        Todas
      </button>

      {categorias.map((cat) => {
        const esActiva = catSel === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={esActiva}
            onClick={() => onSeleccionar && onSeleccionar(cat.id)}
            className={`shrink-0 min-h-[46px] px-5 py-2 rounded-full font-titulo text-lg tracking-wider uppercase transition-colors cursor-pointer border focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto ${
              esActiva
                ? 'bg-primario text-white border-primario font-bold shadow-md'
                : 'bg-transparent text-papel/80 border-papel/15 hover:border-papel/60 font-medium'
            }`}
          >
            {cat.nombre}
          </button>
        );
      })}
    </div>
  );
}

export default CategoriaFiltro;
