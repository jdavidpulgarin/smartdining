/**
 * Sección '¿Cómo pedir?': guía paso a paso para el comensal.
 * Incluye ilustraciones vectoriales SVG decorativas y explicación concisa.
 */
function ComoPedir() {
  const pasos = [
    {
      numero: 1,
      titulo: 'Escanea el QR de tu mesa',
      descripcion:
        'Abre la cámara de tu teléfono móvil y escanea el código QR colocado en tu mesa. No necesitas descargar ninguna aplicación.',
      imagen: '/img/como-pedir/paso-1-escanear.svg',
    },
    {
      numero: 2,
      titulo: 'Arma tu pedido desde el celular',
      descripcion:
        'Explora nuestra carta completa, personaliza los ingredientes de tus platos favoritos y envía la orden directamente a cocina.',
      imagen: '/img/como-pedir/paso-2-pedir.svg',
    },
    {
      numero: 3,
      titulo: 'Paga desde la mesa y sigue tu pedido en vivo',
      descripcion:
        'Realiza el pago con tu método preferido o solicita la cuenta en efectivo, mientras ves en tiempo real el progreso de tu comida.',
      imagen: '/img/como-pedir/paso-3-pagar.svg',
    },
  ];

  return (
    <section
      id="como-pedir"
      aria-labelledby="titulo-como-pedir"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-12"
    >
      <div className="space-y-2">
        <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
          Paso a paso
        </span>
        <h2
          id="titulo-como-pedir"
          className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none"
        >
          ¿Cómo pedir?
        </h2>
      </div>

      <ol className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 list-none p-0">
        {pasos.map((paso) => (
          <li
            key={paso.numero}
            className="bg-superficie rounded-3xl border border-borde p-6 sm:p-8 flex flex-col justify-between space-y-4 shadow-lg motion-safe:transition-transform motion-safe:duration-300 hover:-translate-y-1"
          >
            {/* Pastilla con número arriba a la izquierda */}
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-acento text-fondo font-etiqueta font-bold text-xs uppercase tracking-wider self-start">
                Paso {paso.numero}
              </span>
            </div>

            {/* Ilustración SVG centrada (decorativa con alt="") */}
            <div className="w-full flex items-center justify-center py-2">
              <img
                src={paso.imagen}
                width="320"
                height="220"
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full max-w-[280px] h-auto object-contain mx-auto"
              />
            </div>

            {/* Título y descripción */}
            <div className="space-y-2 pt-2">
              <h3 className="font-titulo text-2xl uppercase tracking-wide text-texto leading-snug">
                {paso.titulo}
              </h3>
              <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
                {paso.descripcion}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default ComoPedir;
