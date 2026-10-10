/**
 * Contenedor tipo tarjeta con fondo blanco, bordes redondeados y sombra suave.
 *
 * Props:
 * - className: clases adicionales de Tailwind CSS
 * - children: contenido de la tarjeta
 */
function Card({ className = '', children, ...rest }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-4 ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
