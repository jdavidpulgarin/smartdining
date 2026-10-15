/**
 * Contenedor tipo tarjeta del sistema de diseño SmartDining (tema oscuro).
 *
 * Props:
 * - seleccionada: booleano para indicar si la tarjeta está seleccionada (borde 2px primario)
 * - className: clases adicionales de Tailwind CSS
 * - children: contenido de la tarjeta
 */
function Card({ seleccionada = false, className = '', children, ...rest }) {
  const estiloBorde = seleccionada ? 'border-2 border-primario' : 'border border-borde';

  return (
    <div
      className={`bg-superficie rounded-2xl ${estiloBorde} p-4 text-texto ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
