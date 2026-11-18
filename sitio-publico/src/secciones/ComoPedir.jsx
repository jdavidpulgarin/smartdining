/**
 * Sección '¿Cómo pedir?': guía paso a paso para el comensal.
 * Incluye marcos de dispositivo en CSS (tablet horizontal y celulares verticales con isla decorativa)
 * y capturas reales de la aplicación web de pedidos.
 */
function ComoPedir() {
  const pasos = [
    {
      numero: 1,
      titulo: 'Escanea el QR de tu mesa',
      descripcion:
        'Abre la cámara de tu teléfono móvil y escanea el código QR colocado en tu mesa. No necesitas descargar ninguna aplicación.',
      imagen: {
        src: '/img/como-pedir/paso-1-qr.webp',
        alt: 'Pantalla de la mesa con el código QR para entrar a la carta',
        width: 602,
        height: 520,
      },
      tipoMarco: 'tablet',
    },
    {
      numero: 2,
      titulo: 'Arma tu pedido desde el celular',
      descripcion:
        'Explora nuestra carta completa, personaliza los ingredientes de tus platos favoritos y envía la orden directamente a cocina.',
      imagen: {
        src: '/img/como-pedir/paso-2-carta.webp',
        alt: 'Carta en el celular con la sección Arma tu plato',
        width: 540,
        height: 960,
      },
      tipoMarco: 'celular',
    },
    {
      numero: 3,
      titulo: 'Paga desde la mesa y sigue tu pedido en vivo',
      descripcion:
        'Realiza el pago con tu método preferido o solicita la cuenta en efectivo, mientras ves en tiempo real el progreso de tu comida.',
      imagen: {
        src: '/img/como-pedir/paso-3-seguimiento.webp',
        alt: 'Seguimiento del pedido en vivo: recibido, en preparación, listo y en tu mesa',
        width: 540,
        height: 960,
      },
      tipoMarco: 'celular',
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

      <div className="relative">
        {/* Línea horizontal punteada en escritorio que une los números */}
        <div
          aria-hidden="true"
          className="hidden md:block absolute top-7 left-[18%] right-[18%] border-t-2 border-dashed border-borde z-0"
        />

        {/* Línea vertical punteada en celular a la izquierda */}
        <div
          aria-hidden="true"
          className="md:hidden absolute top-7 bottom-24 left-6 sm:left-7 border-l-2 border-dashed border-borde z-0"
        />

        <ol className="relative grid grid-cols-1 md:grid-cols-3 gap-8 lg:gap-10 list-none p-0">
          {pasos.map((paso) => (
            <li
              key={paso.numero}
              className="relative flex flex-col bg-superficie rounded-3xl border border-borde p-6 sm:p-8 space-y-6 shadow-lg motion-safe:transition-transform motion-safe:duration-300 hover:-translate-y-1"
            >
              {/* Cabecera con número grande en círculo primario */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-primario text-white flex items-center justify-center font-titulo text-2xl sm:text-3xl shadow-lg relative z-10 shrink-0">
                  {paso.numero}
                </div>
                <span className="font-etiqueta uppercase tracking-wider text-xs font-bold text-acento md:hidden">
                  Paso {paso.numero}
                </span>
              </div>

              {/* Marco de dispositivo hecho en CSS */}
              <div className="w-full h-56 sm:h-64 flex items-center justify-center py-2">
                {paso.tipoMarco === 'tablet' ? (
                  /* Marco de tablet horizontal */
                  <div className="w-full max-w-[280px] sm:max-w-[300px] rounded-[1.75rem] border-4 sm:border-[6px] border-superficie-2 bg-superficie-2 p-1 shadow-xl overflow-hidden">
                    <img
                      src={paso.imagen.src}
                      alt={paso.imagen.alt}
                      width={paso.imagen.width}
                      height={paso.imagen.height}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-auto object-cover rounded-[1.25rem]"
                    />
                  </div>
                ) : (
                  /* Marco de celular vertical con pequeña isla superior decorativa */
                  <div className="w-full max-w-[160px] sm:max-w-[175px] aspect-[9/16] rounded-[2.25rem] border-4 sm:border-[6px] border-superficie-2 bg-superficie-2 p-1 shadow-xl relative overflow-hidden flex flex-col">
                    <div
                      className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-2 rounded-full bg-fondo/80 z-10"
                      aria-hidden="true"
                    />
                    <img
                      src={paso.imagen.src}
                      alt={paso.imagen.alt}
                      width={paso.imagen.width}
                      height={paso.imagen.height}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover object-top rounded-[1.75rem]"
                    />
                  </div>
                )}
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
      </div>

      {/* Nota aclaratoria debajo de los pasos */}
      <p className="text-xs text-texto-tenue font-cuerpo text-center pt-2">
        Capturas reales de la app SmartDining. El código QR de la imagen es ilustrativo.
      </p>
    </section>
  );
}

export default ComoPedir;
