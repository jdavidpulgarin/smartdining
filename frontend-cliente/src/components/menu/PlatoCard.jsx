function PlatoCard({ plato }) {
  const { nombre, descripcion, precio, imagen } = plato;

  const precioFormateado = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(precio);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex gap-3 p-3 transition-shadow hover:shadow-md">
      <img
        src={imagen}
        alt={nombre}
        className="w-24 h-24 object-cover rounded-lg shrink-0 bg-gray-100"
        loading="lazy"
      />
      <div className="flex flex-col justify-between flex-1 min-w-0">
        <div>
          <h3 className="font-bold text-gray-900 text-base leading-snug truncate">
            {nombre}
          </h3>
          <p className="text-xs text-gray-500 line-clamp-2 mt-1">
            {descripcion}
          </p>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="font-extrabold text-blue-600 text-sm">
            {precioFormateado}
          </span>
        </div>
      </div>
    </div>
  );
}

export default PlatoCard;
