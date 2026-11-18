/**
 * Pie de página institucional del sitio público.
 * Video de portada: Mixkit (licencia gratuita de Mixkit)
 */
function Pie({ datosRestaurante = {}, secciones = [] }) {
  const nombre = datosRestaurante.nombre || 'SmartDining';
  const anioActual = new Date().getFullYear();

  return (
    <footer className="border-t border-borde bg-superficie py-12 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-center md:text-left space-y-1.5">
          <p className="font-titulo text-2xl tracking-wider uppercase text-texto">
            {nombre}
          </p>
          <p className="text-xs text-texto-suave font-cuerpo">
            Proyecto académico · UPC
          </p>
          <p className="text-xs text-texto-tenue font-cuerpo">
            © {anioActual} {nombre}
          </p>
        </div>

        <nav
          aria-label="Enlaces del pie de página"
          className="flex flex-wrap items-center justify-center gap-3"
        >
          {secciones.map((sec) => (
            <a
              key={sec.href}
              href={sec.href}
              className="min-h-11 px-3 inline-flex items-center font-etiqueta uppercase tracking-wider text-sm font-bold text-texto-suave hover:text-acento transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto rounded-lg"
            >
              {sec.etiqueta}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

export default Pie;
