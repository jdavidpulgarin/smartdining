import { useMemo } from 'react';
import restauranteDefault from '../datos/restaurante.js';

/**
 * Sección 'Nosotros': historia del restaurante, año de fundación y propuesta de valor.
 * Diseño responsivo de 2 columnas con imagen institucional y lista de puntos clave.
 */
function Nosotros({ datosRestaurante = {} }) {
  const historia = datosRestaurante.historia || restauranteDefault.historia || '';
  const anioFundacion =
    datosRestaurante.anioFundacion || restauranteDefault.anioFundacion || 2016;

  const parrafos = useMemo(() => {
    if (!historia) return [];
    if (historia.includes('\n\n')) {
      return historia.split('\n\n').filter((p) => p.trim().length > 0);
    }
    const puntoIndex = historia.indexOf('. ');
    if (puntoIndex > 0 && puntoIndex < historia.length - 20) {
      return [
        historia.slice(0, puntoIndex + 1).trim(),
        historia.slice(puntoIndex + 1).trim(),
      ];
    }
    return [historia.trim()];
  }, [historia]);

  const puntosClave = [
    {
      titulo: 'Recetas de la casa',
      descripcion:
        'Cocinamos con recetas de la casa y los sabores de siempre del Cesar con un toque moderno.',
      icono: (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      ),
    },
    {
      titulo: 'Productos de la región',
      descripcion:
        'Seguimos cocinando con productos locales del Cesar para mantener viva la sazón de nuestra tierra.',
      icono: (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </svg>
      ),
    },
    {
      titulo: 'Pide y paga desde tu mesa',
      descripcion:
        'Cada mesa tiene su código QR para pedir y pagar desde el celular, sin filas ni esperas.',
      icono: (
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ];

  return (
    <section
      id="nosotros"
      aria-labelledby="titulo-nosotros"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-14 items-center">
        {/* Columna izquierda: Imagen en contenedor aspect-[4/5] */}
        <div className="space-y-2.5">
          <div className="relative aspect-[4/5] rounded-3xl overflow-hidden border border-borde bg-superficie shadow-xl">
            <img
              src="/img/nosotros.webp"
              width={825}
              height={1024}
              loading="lazy"
              decoding="async"
              alt="Interior del restaurante SmartDining: mesas de madera con su código QR, lámparas cálidas y barra al fondo"
              className="w-full h-full object-cover"
            />
            {/* Etiqueta "Desde <anioFundacion>" en la esquina inferior izquierda */}
            {anioFundacion && (
              <div className="absolute bottom-4 left-4 z-10 inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-fondo/85 backdrop-blur-md border border-borde text-acento font-etiqueta uppercase text-base sm:text-lg font-bold tracking-widest shadow-lg">
                <span>Desde {anioFundacion}</span>
              </div>
            )}
          </div>
          <p className="text-xs text-texto-tenue font-cuerpo text-center sm:text-left">
            Imagen ilustrativa generada con IA
          </p>
        </div>

        {/* Columna derecha: Encabezado, historia y 3 puntos destacados */}
        <div className="space-y-6">
          <div className="space-y-2">
            <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
              Nuestra historia
            </span>
            <h2
              id="titulo-nosotros"
              className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none"
            >
              Nosotros
            </h2>
          </div>

          <div className="space-y-4 text-base sm:text-lg text-texto-suave font-cuerpo leading-relaxed">
            {parrafos.map((parrafo, idx) => (
              <p key={idx} className="first:text-texto">
                {parrafo}
              </p>
            ))}
          </div>

          <ul className="space-y-4 pt-2 list-none p-0">
            {puntosClave.map((punto) => (
              <li
                key={punto.titulo}
                className="flex items-start gap-3.5 bg-superficie/60 border border-borde/60 rounded-2xl p-4 shadow-sm"
              >
                <div className="w-10 h-10 rounded-xl bg-superficie-2 border border-borde text-acento flex items-center justify-center shrink-0 mt-0.5">
                  {punto.icono}
                </div>
                <div className="space-y-1">
                  <h3 className="font-etiqueta uppercase text-base font-bold tracking-wide text-texto">
                    {punto.titulo}
                  </h3>
                  <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
                    {punto.descripcion}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default Nosotros;
