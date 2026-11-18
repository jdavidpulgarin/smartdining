import TituloSeccion from '../componentes/TituloSeccion.jsx';

/**
 * Sección '¿Cómo pedir?' al estilo póster de restaurante.
 * Guía paso a paso con ilustraciones SVG vectoriales, etiquetas ámbar giradas,
 * líneas punteadas conectoras y diseño responsivo adaptado.
 */
function ComoPedir() {
  const pasos = [
    {
      numero: 1,
      titulo: 'Escanea el QR de tu mesa',
      descripcion:
        'Abre la cámara de tu celular y apunta al código que está en tu mesa.',
      imagen: '/img/como-pedir/paso-1-escanear.svg',
    },
    {
      numero: 2,
      titulo: 'Arma tu pedido desde el celular',
      descripcion:
        'Mira la carta completa, personaliza tus platos y envía la orden directo a cocina.',
      imagen: '/img/como-pedir/paso-2-pedir.svg',
    },
    {
      numero: 3,
      titulo: 'Paga y sigue tu pedido en vivo',
      descripcion:
        'Paga con tu método preferido o pide la cuenta en efectivo, y mira cómo avanza tu comida.',
      imagen: '/img/como-pedir/paso-3-pagar.svg',
    },
  ];

  return (
    <section
      id="como-pedir"
      aria-labelledby="titulo-como-pedir"
      className="fondo-poster-brillo-bl text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <TituloSeccion
          id="titulo-como-pedir"
          linea1="¿Cómo"
          linea2="pedir?"
          descripcion="Sin filas ni esperas: todo se hace desde el celular, sentado en tu mesa."
          className="mb-12 sm:mb-16"
        />

        <ol className="pasos-lista">
          {pasos.map((paso) => (
            <li key={paso.numero} className="paso-card">
              <span className="etiqueta-girada font-titulo text-lg tracking-wider px-3.5 py-1 self-start mb-2">
                Paso {paso.numero}
              </span>

              <img
                src={paso.imagen}
                width="320"
                height="220"
                alt=""
                loading="lazy"
                decoding="async"
                className="paso-art block w-full h-auto aspect-[240/170] object-contain my-3"
              />

              <h3 className="font-titulo text-2xl sm:text-3xl uppercase tracking-wide leading-tight min-h-[2.5em] flex items-end mb-2 text-papel">
                {paso.titulo}
              </h3>

              <p className="font-cuerpo-poster text-sm sm:text-base text-papel/75 leading-relaxed m-0">
                {paso.descripcion}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default ComoPedir;
