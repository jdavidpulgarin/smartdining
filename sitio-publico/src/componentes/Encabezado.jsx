import { useEffect, useState } from 'react';

/**
 * Encabezado principal accesible y responsivo.
 * Incluye enlace 'Saltar al contenido' en primer lugar, logo, navegación
 * de escritorio y menú móvil interactivo con cierre mediante tecla Escape.
 */
function Encabezado({ secciones = [], datosRestaurante = {} }) {
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const nombreRestaurante = datosRestaurante.nombre || 'SmartDining';

  useEffect(() => {
    if (!menuMovilAbierto) return undefined;
    const manejarTeclaEscape = (evento) => {
      if (evento.key === 'Escape') {
        setMenuMovilAbierto(false);
      }
    };
    window.addEventListener('keydown', manejarTeclaEscape);
    return () => window.removeEventListener('keydown', manejarTeclaEscape);
  }, [menuMovilAbierto]);

  return (
    <header className="sticky top-0 z-50 bg-fondo/95 backdrop-blur-md border-b border-borde">
      {/* Enlace accesible 'Saltar al contenido' */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primario focus:text-white focus:rounded-xl focus:outline-none focus:ring-2 focus:ring-primario-texto font-etiqueta uppercase text-sm font-bold shadow-lg"
      >
        Saltar al contenido
      </a>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Logo y nombre con enlace a #inicio */}
        <a
          href="#inicio"
          className="flex items-center gap-3 min-w-0 min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto rounded-xl"
        >
          <img
            src="/logo.png"
            alt={nombreRestaurante}
            width={40}
            height={40}
            className="w-10 h-10 rounded-xl object-cover shrink-0"
          />
          <span className="font-titulo text-2xl sm:text-3xl tracking-wider uppercase text-texto truncate">
            {nombreRestaurante}
          </span>
        </a>

        {/* Navegación de escritorio */}
        <nav
          aria-label="Principal"
          className="hidden md:flex items-center gap-1 lg:gap-3"
        >
          {secciones.map((sec) => (
            <a
              key={sec.href}
              href={sec.href}
              className="min-h-11 px-3 inline-flex items-center font-etiqueta uppercase tracking-wider text-base font-bold text-texto-suave hover:text-acento transition-colors rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
            >
              {sec.etiqueta}
            </a>
          ))}
        </nav>

        {/* Botón menú hamburguesa en celular */}
        <button
          type="button"
          onClick={() => setMenuMovilAbierto((prev) => !prev)}
          aria-expanded={menuMovilAbierto}
          aria-controls="menu-movil"
          aria-label={menuMovilAbierto ? 'Cerrar menú' : 'Abrir menú'}
          className="md:hidden min-w-11 min-h-11 p-2.5 rounded-xl border border-borde bg-superficie-2 text-texto hover:bg-superficie inline-flex items-center justify-center cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
        >
          {menuMovilAbierto ? (
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          ) : (
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Panel desplegable móvil */}
      {menuMovilAbierto && (
        <nav
          id="menu-movil"
          aria-label="Principal móvil"
          className="md:hidden border-t border-borde bg-superficie px-4 py-3 space-y-1"
        >
          {secciones.map((sec) => (
            <a
              key={sec.href}
              href={sec.href}
              onClick={() => setMenuMovilAbierto(false)}
              className="min-h-11 px-3 rounded-xl flex items-center font-etiqueta uppercase tracking-wider text-lg font-bold text-texto hover:bg-superficie-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
            >
              {sec.etiqueta}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

export default Encabezado;
