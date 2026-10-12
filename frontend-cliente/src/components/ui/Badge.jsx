/**
 * Etiqueta informativa (Badge) con variantes semánticas de la marca.
 *
 * Props:
 * - variante: 'neutro' | 'exito' | 'alerta' (por defecto 'neutro')
 * - className: clases adicionales de Tailwind CSS
 * - children: texto o contenido del badge
 */
function Badge({ variante = 'neutro', className = '', children, ...rest }) {
  const estilosPorVariante = {
    neutro: 'bg-cafe/10 text-cafe',
    exito: 'bg-verde text-white',
    alerta: 'bg-primary text-white',
  };

  const estiloVariante = estilosPorVariante[variante] || estilosPorVariante.neutro;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${estiloVariante} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}

export default Badge;
