/**
 * Etiqueta informativa (Badge) del sistema de diseño SmartDining (tema oscuro).
 *
 * Props:
 * - variante: 'obligatorio' | 'preparando' | 'entregado' | 'pagado' | 'pendiente' | 'neutro' | 'exito' | 'alerta'
 * - className: clases adicionales de Tailwind CSS
 * - children: texto o contenido del badge
 */
function Badge({ variante = 'neutro', className = '', children, ...rest }) {
  const estilosPorVariante = {
    obligatorio: 'bg-primario text-white',
    alerta: 'bg-primario text-white',
    preparando: 'bg-acento text-black font-bold',
    entregado: 'bg-texto text-fondo font-bold',
    pagado: 'bg-texto text-fondo font-bold',
    pendiente: 'border border-primario-texto text-primario-texto bg-transparent',
    exito: 'bg-texto text-fondo font-bold',
    neutro: 'bg-superficie-2 text-texto-suave border border-borde',
  };

  const estiloVariante = estilosPorVariante[variante] || estilosPorVariante.neutro;

  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-xs font-etiqueta uppercase tracking-wider font-semibold ${estiloVariante} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}

export default Badge;
