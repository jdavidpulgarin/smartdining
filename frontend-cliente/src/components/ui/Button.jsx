/**
 * Botón reutilizable del sistema de diseño SmartDining.
 *
 * Props:
 * - variante: 'primario' | 'secundario' (por defecto 'primario')
 * - type: 'button' | 'submit' | 'reset' (por defecto 'button')
 * - onClick: función manejadora del clic
 * - disabled: booleano para deshabilitar el botón
 * - className: clases adicionales de Tailwind CSS
 * - children: contenido interno del botón
 */
function Button({
  variante = 'primario',
  type = 'button',
  onClick,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const estilosVariante =
    variante === 'secundario'
      ? 'border-2 border-primary bg-transparent text-primary hover:bg-primary/10 active:bg-primary/20 disabled:border-gray-300 disabled:text-gray-400 disabled:bg-transparent'
      : 'bg-primary text-white hover:bg-primary-hover active:bg-primary-hover shadow-sm disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 px-4 py-2.5 rounded-xl font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed ${estilosVariante} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
