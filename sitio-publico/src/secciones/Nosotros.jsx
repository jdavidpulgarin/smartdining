import { useEffect, useRef, useState } from 'react';
import TituloSeccion from '../componentes/TituloSeccion.jsx';

/**
 * Sección 'Nosotros' al estilo póster de restaurante.
 * - Texto a la izquierda con título de 2 líneas (contorno + sólido), párrafos y separador ámbar.
 * - A la derecha fotografía real con marco rojo desplazado, etiqueta 'Desde 2016' girada y nota de IA.
 * - Comanda de papel crema con borde zigzag inferior y revelado una sola vez con IntersectionObserver.
 */
function Nosotros() {
  const [animar, setAnimar] = useState(false);
  const [impresa, setImpresa] = useState(false);
  const visualRef = useRef(null);

  useEffect(() => {
    // Si el usuario prefiere movimiento reducido o no soporta IntersectionObserver, no ocultar/animar
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced || !('IntersectionObserver' in window)) {
      return;
    }

    setAnimar(true);

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setImpresa(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.25 }
    );

    if (visualRef.current) {
      observer.observe(visualRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="nosotros"
      aria-labelledby="titulo-nosotros"
      className="fondo-poster-brillo-tr relative overflow-hidden text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
        {/* Columna de texto */}
        <div className="lg:col-span-6 space-y-6">
          <TituloSeccion
            id="titulo-nosotros"
            linea1="Del Cesar"
            linea2="a tu mesa"
          />

          <p className="text-lg sm:text-xl font-cuerpo-poster font-medium leading-relaxed text-papel">
            SmartDining nació en 2016 como una cocina familiar en el centro de
            Valledupar, con una idea simple: servir los sabores de siempre del
            Cesar con un toque moderno.
          </p>

          <p className="text-base sm:text-lg font-cuerpo-poster leading-relaxed text-papel/75">
            Diez años después seguimos cocinando con productos de la región y
            recetas de la casa. Lo que cambió es la forma de atender: cada mesa
            tiene su QR para pedir y pagar desde el celular. Lo que no cambió es la
            sazón, ni el gusto de recibirte como en casa.
          </p>

          <div
            className="w-18 h-1 bg-ambar mt-8 rounded-full"
            aria-hidden="true"
          />
        </div>

        {/* Columna visual: Foto con marco desplazado y comanda */}
        <div
          ref={visualRef}
          className="lg:col-span-6 relative pb-12 lg:pb-16 max-w-md mx-auto w-full"
        >
          <figure className="relative m-0">
            {/* Marco rojo desplazado detrás */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-primario translate-x-[-10px] translate-y-[10px] sm:translate-x-[-14px] sm:translate-y-[14px] rounded-md pointer-events-none"
            />

            {/* Foto institucional */}
            <img
              src="/img/nosotros.webp"
              width={825}
              height={1024}
              loading="lazy"
              decoding="async"
              alt="Interior del restaurante SmartDining: mesas de madera con su código QR, lámparas cálidas y barra al fondo"
              className="relative block w-full aspect-[4/5] object-cover rounded-md shadow-2xl bg-gradient-to-br from-[#3a1a14] to-[#140b0b]"
            />

            {/* Etiqueta 'Desde 2016' ámbar girada */}
            <span className="absolute top-5 -left-4 z-10 etiqueta-girada font-titulo text-xl sm:text-2xl tracking-wider px-4 py-1.5 shadow-xl">
              Desde 2016
            </span>

            <figcaption className="mt-4 text-xs text-papel/50 font-cuerpo-poster text-center sm:text-left">
              Imagen ilustrativa generada con IA
            </figcaption>
          </figure>

          {/* Comanda de papel crema con borde inferior en zigzag */}
          <div className="relative mt-[-4.5rem] ml-auto mr-0 w-[min(21rem,92%)] sm:w-[min(21rem,85%)] lg:absolute lg:right-[-2.5rem] lg:bottom-0 lg:mt-0 rotate-[2.5deg] drop-shadow-2xl z-20">
            <div
              className="comanda p-6 pb-8"
              style={
                animar
                  ? {
                      clipPath: impresa ? 'inset(0 0 -20px 0)' : 'inset(0 0 100% 0)',
                      transition: 'clip-path 1.1s cubic-bezier(.3,.7,.2,1) .25s',
                    }
                  : undefined
              }
            >
              <div className="flex justify-between items-baseline pb-3 border-b-2 border-dashed border-tinta/35">
                <strong className="font-titulo text-2xl tracking-wider uppercase">
                  COMANDA
                </strong>
                <span className="text-xs font-cuerpo-poster font-medium text-tinta/70">
                  · Valledupar, Cesar
                </span>
              </div>

              <ul className="list-none m-0 p-0">
                <li className="py-3.5 border-b border-dashed border-tinta/30">
                  <h3 className="m-0 mb-1 font-titulo text-lg tracking-wide flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 bg-primario shrink-0"
                    />
                    <span>Recetas de la casa</span>
                  </h3>
                  <p className="m-0 text-sm font-cuerpo-poster leading-snug text-tinta/80">
                    Los sabores de siempre del Cesar, con un toque moderno.
                  </p>
                </li>

                <li className="py-3.5 border-b border-dashed border-tinta/30">
                  <h3 className="m-0 mb-1 font-titulo text-lg tracking-wide flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 bg-primario shrink-0"
                    />
                    <span>Productos de la región</span>
                  </h3>
                  <p className="m-0 text-sm font-cuerpo-poster leading-snug text-tinta/80">
                    Ingredientes locales para mantener viva la sazón de nuestra
                    tierra.
                  </p>
                </li>

                <li className="py-3.5 pb-1">
                  <h3 className="m-0 mb-1 font-titulo text-lg tracking-wide flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 bg-primario shrink-0"
                    />
                    <span>Pide y paga desde tu mesa</span>
                  </h3>
                  <p className="m-0 text-sm font-cuerpo-poster leading-snug text-tinta/80">
                    Escanea el QR de tu mesa y listo: sin filas ni esperas.
                  </p>
                </li>
              </ul>

              <p className="mt-4 text-xs font-cuerpo-poster font-semibold text-center text-tinta/90">
                Gracias por sentarte a nuestra mesa.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default Nosotros;
