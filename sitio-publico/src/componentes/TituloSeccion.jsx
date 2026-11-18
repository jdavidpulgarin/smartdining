/**
 * Título de sección estilo póster de restaurante.
 * Renderiza un h2 con id y dos líneas: la primera con efecto de contorno (.texto-contorno)
 * y la segunda con texto sólido relleno. Opcionalmente muestra un párrafo descriptivo
 * alineado a la derecha en escritorio y debajo en celular.
 */
function TituloSeccion({
  id,
  linea1,
  linea2,
  descripcion,
  className = '',
  idDescripcion,
}) {
  const encabezado = (
    <h2
      id={id}
      className="m-0 font-titulo text-[clamp(3.4rem,7.4vw,6.6rem)] leading-[0.88] uppercase tracking-[0.01em]"
    >
      <span className="block texto-contorno">{linea1}</span>
      <span className="block text-papel">{linea2}</span>
    </h2>
  );

  if (!descripcion) {
    return <div className={className}>{encabezado}</div>;
  }

  return (
    <div
      className={`flex flex-col md:flex-row md:items-end md:justify-between gap-6 sm:gap-8 ${className}`.trim()}
    >
      {encabezado}
      <p
        id={idDescripcion}
        className="m-0 max-w-sm text-base sm:text-lg text-papel/75 font-cuerpo-poster leading-relaxed"
      >
        {descripcion}
      </p>
    </div>
  );
}

export default TituloSeccion;
export { TituloSeccion };
