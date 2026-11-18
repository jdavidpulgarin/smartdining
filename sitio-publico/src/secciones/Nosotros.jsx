import { useMemo } from 'react';

/**
 * Sección 'Nosotros': historia del restaurante y año de fundación.
 */
function Nosotros({ datosRestaurante = {} }) {
  const historia = datosRestaurante.historia || '';
  const anioFundacion = datosRestaurante.anioFundacion;

  const parrafos = useMemo(() => {
    if (!historia) return [];
    // Dividir en oraciones o párrafos coherentes si vienen en un solo bloque
    if (historia.includes('\n\n')) {
      return historia.split('\n\n').filter((p) => p.trim().length > 0);
    }
    // Si viene como un párrafo largo, dividir tras el primer punto si es extenso
    const puntoIndex = historia.indexOf('. ');
    if (puntoIndex > 0 && puntoIndex < historia.length - 20) {
      return [
        historia.slice(0, puntoIndex + 1).trim(),
        historia.slice(puntoIndex + 1).trim(),
      ];
    }
    return [historia.trim()];
  }, [historia]);

  return (
    <section
      id="nosotros"
      aria-labelledby="titulo-nosotros"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
            Nuestra historia
          </span>
          <h2
            id="titulo-nosotros"
            className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none mt-1"
          >
            Nosotros
          </h2>
        </div>

        {anioFundacion && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-superficie-2 border border-borde text-acento font-etiqueta uppercase text-xl font-bold tracking-widest self-start sm:self-auto">
            <span>Desde {anioFundacion}</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-base sm:text-lg text-texto-suave font-cuerpo leading-relaxed bg-superficie rounded-3xl border border-borde p-6 sm:p-10 shadow-lg">
        {parrafos.map((parrafo, idx) => (
          <p key={idx} className="first:text-texto">
            {parrafo}
          </p>
        ))}
      </div>
    </section>
  );
}

export default Nosotros;
