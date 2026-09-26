function CategoriaFiltro({ categorias = [] }) {
  return (
    <div className="overflow-x-auto pb-2 scrollbar-none">
      <div className="flex gap-2 min-w-max">
        {categorias.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 transition-colors"
          >
            {cat.nombre}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CategoriaFiltro;
