/**
 * Botón reutilizable del sistema de diseño SmartDining (tema oscuro).
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
      ? 'border border-texto bg-transparent text-texto hover:bg-texto/10 active:bg-texto/20 disabled:border-texto/30 disabled:text-texto/40'
      : 'bg-primario text-white hover:bg-primario-hover active:bg-primario-hover shadow-sm disabled:opacity-40';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 px-4 py-2.5 rounded-xl font-etiqueta uppercase text-lg tracking-wide inline-flex items-center justify-center gap-2 transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto focus-visible:ring-offset-2 focus-visible:ring-offset-fondo disabled:cursor-not-allowed ${estilosVariante} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

export default Button;
