/**
 * Sección '¿Cómo pedir?': guía paso a paso para el comensal.
 */
function ComoPedir() {
  return (
    <section
      id="como-pedir"
      aria-labelledby="titulo-como-pedir"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-10"
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

      <ol className="grid grid-cols-1 md:grid-cols-3 gap-6 list-none p-0">
        <li className="bg-superficie rounded-3xl border border-borde p-6 sm:p-8 space-y-4 relative overflow-hidden shadow-lg">
          <span
            aria-hidden="true"
            className="font-titulo text-7xl text-acento/20 font-bold leading-none select-none block"
          >
            1
          </span>
          <div className="space-y-2">
            <h3 className="font-titulo text-2xl uppercase tracking-wide text-texto">
              Escanea el QR de tu mesa
            </h3>
            <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
              Abre la cámara de tu teléfono móvil y escanea el código QR colocado en tu mesa. No necesitas descargar ninguna aplicación.
            </p>
          </div>
        </li>

        <li className="bg-superficie rounded-3xl border border-borde p-6 sm:p-8 space-y-4 relative overflow-hidden shadow-lg">
          <span
            aria-hidden="true"
            className="font-titulo text-7xl text-acento/20 font-bold leading-none select-none block"
          >
            2
          </span>
          <div className="space-y-2">
            <h3 className="font-titulo text-2xl uppercase tracking-wide text-texto">
              Arma tu pedido desde el celular
            </h3>
            <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
              Explora nuestra carta completa, personaliza los ingredientes de tus platos favoritos y envía la orden directamente a cocina.
            </p>
          </div>
        </li>

        <li className="bg-superficie rounded-3xl border border-borde p-6 sm:p-8 space-y-4 relative overflow-hidden shadow-lg">
          <span
            aria-hidden="true"
            className="font-titulo text-7xl text-acento/20 font-bold leading-none select-none block"
          >
            3
          </span>
          <div className="space-y-2">
            <h3 className="font-titulo text-2xl uppercase tracking-wide text-texto">
              Paga desde la mesa y sigue tu pedido en vivo
            </h3>
            <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
              Realiza el pago con tu método preferido o solicita la cuenta en efectivo, mientras ves en tiempo real el progreso de tu comida.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}

export default ComoPedir;
