/**
 * Pie de página institucional estilo póster de restaurante.
 * Conserva atribuciones académicas, créditos de imágenes con IA, enlaces
 * y el espaciado inferior para convivir con el botón flotante de WhatsApp.
 */
function Pie({ datosRestaurante = {}, secciones = [] }) {
  const nombre = datosRestaurante.nombre || 'SmartDining';
  const anioActual = new Date().getFullYear();

  return (
    <footer className="border-t border-papel/10 bg-[#0B0B0B] fondo-poster pt-12 pb-28 md:pb-12 px-4 sm:px-6 text-papel">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="text-center md:text-left space-y-1.5">
          <p className="font-titulo text-2xl sm:text-3xl tracking-wider uppercase text-papel m-0">
            {nombre}
          </p>
          <p className="text-xs text-papel/70 font-cuerpo-poster m-0">
            Proyecto académico · UPC
          </p>
          <p className="text-xs text-papel/50 font-cuerpo-poster m-0">
            Imágenes y videos ilustrativos generados con IA · Imagen base del bowl: Freepik
          </p>
          <p className="text-xs text-papel/50 font-cuerpo-poster m-0">
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
              className="min-h-11 px-3 inline-flex items-center font-titulo uppercase tracking-wider text-base text-papel/70 hover:text-ambar transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto rounded-lg"
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
