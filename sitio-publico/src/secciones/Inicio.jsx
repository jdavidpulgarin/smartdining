import { useEffect, useRef, useState } from 'react';
import restauranteDefault from '../datos/restaurante.js';
import Button from '../components/ui/Button.jsx';
import { leerPreferenciasVideoNavegador } from '../utils/sitioPublico.js';
import { elegirFuentePortada } from '../utils/portada.js';
import { estadoHorario } from '../utils/horario.js';

/**
 * Sección de portada (Hero) al estilo póster de restaurante.
 * - Póster LCP siempre en HTML inicial con fetchPriority="high".
 * - Video de fondo montado únicamente en cliente según preferencias y ancho.
 * - Título tipográfico contorneado/relleno de gran formato accesible.
 * - Emblema circular con anillo SVG giratorio pausable.
 * - Ticket de horario con estado "ABIERTO"/"CERRADO".
 * - Cinta ámbar estática inclinada al pie.
 */
function Inicio({ datosRestaurante = {} }) {
  const [videoSrc, setVideoSrc] = useState(null);
  const [reproduciendo, setReproduciendo] = useState(true);
  const [montado, setMontado] = useState(false);
  const videoRef = useRef(null);

  const nombre = datosRestaurante.nombre || 'SmartDining Restaurante';
  const eslogan = datosRestaurante.eslogan || restauranteDefault.eslogan;
  const horario = datosRestaurante.horario || restauranteDefault.horario;

  const [estado, setEstado] = useState(() => estadoHorario(new Date(), horario));

  useEffect(() => {
    setMontado(true);
    const ancho = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const prefs = leerPreferenciasVideoNavegador();
    const fuente = elegirFuentePortada({ anchoPantalla: ancho, prefs });
    if (fuente) {
      setVideoSrc(fuente);
    }
  }, []);

  useEffect(() => {
    setEstado(estadoHorario(new Date(), horario));
    const timer = setInterval(() => {
      setEstado(estadoHorario(new Date(), horario));
    }, 60000);
    return () => clearInterval(timer);
  }, [horario]);

  const alternarReproduccion = () => {
    const nuevoEstado = !reproduciendo;
    setReproduciendo(nuevoEstado);
    if (videoRef.current) {
      if (nuevoEstado) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  };

  return (
    <section
      id="inicio"
      aria-labelledby="titulo-inicio"
      className="relative min-h-[90vh] flex flex-col justify-between border-b border-papel/10 overflow-hidden scroll-mt-16 pt-12 sm:pt-16 pb-0"
    >
      {/* Fondo base: Imagen LCP estática siempre en el HTML inicial */}
      <img
        src="/videos/portada-poster.webp"
        alt=""
        width={1280}
        height={720}
        fetchPriority="high"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Video montado únicamente en cliente si las preferencias lo permiten */}
      {videoSrc && (
        <video
          ref={videoRef}
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/videos/portada-poster.webp"
          aria-hidden="true"
          tabIndex={-1}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Capas de degradado para contraste AA: casi opaco a la izquierda, carne visible a la derecha, tinte rojo suave y fundido a fondo */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-fondo via-fondo/90 lg:via-fondo/80 to-transparent pointer-events-none"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(circle_at_75%_35%,rgba(163,20,28,0.22),transparent_65%)] bg-gradient-to-t from-fondo via-transparent to-transparent pointer-events-none"
      />

      {/* Control accesible WCAG 2.2.2 para pausar/reanudar movimiento de video y animación (en escritorio) */}
      {montado && (
        <div className="hidden sm:flex absolute bottom-24 right-8 z-20 items-center justify-end">
          <button
            type="button"
            onClick={alternarReproduccion}
            aria-pressed={!reproduciendo}
            aria-label={
              reproduciendo
                ? 'Pausar video y animación de la portada'
                : 'Reproducir video y animación de la portada'
            }
            className="px-3.5 py-1.5 rounded-xl bg-superficie/85 hover:bg-superficie text-texto text-xs font-etiqueta font-bold uppercase tracking-wider border border-borde backdrop-blur-sm cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto shadow-lg"
          >
            {reproduciendo ? 'Pausar animación' : 'Reproducir animación'}
          </button>
        </div>
      )}

      {/* Contenido principal de la portada: 2 columnas en escritorio */}
      <div className="relative z-10 max-w-6xl mx-auto w-full px-4 sm:px-6 my-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center py-8">
        {/* Columna izquierda: antetítulo, títulos SMART DINING, eslogan y botones */}
        <div className="lg:col-span-7 space-y-6">
          <span className="font-titulo text-base sm:text-lg tracking-[0.35em] text-ambar uppercase block">
            RESTAURANTE
          </span>

          <h1 id="titulo-inicio" className="leading-[0.85] uppercase m-0">
            <span className="sr-only">{nombre}</span>
            <span
              aria-hidden="true"
              className="block font-titulo text-[clamp(4.2rem,11.5vw,8.5rem)] texto-contorno tracking-wide"
            >
              SMART
            </span>
            <span
              aria-hidden="true"
              className="block font-titulo text-[clamp(4.2rem,11.5vw,8.5rem)] text-papel tracking-wide"
            >
              DINING
            </span>
          </h1>

          {eslogan && (
            <p className="mt-6 sm:mt-8 text-base sm:text-xl text-papel/85 font-cuerpo-poster max-w-lg leading-relaxed">
              {eslogan}
            </p>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-4">
            <Button
              href="#carta"
              variante="primario"
              className="rounded-xl px-7 py-3 text-lg font-titulo tracking-wider"
            >
              Ver la carta
            </Button>
            <Button
              href="#como-pedir"
              variante="secundario"
              className="rounded-xl px-7 py-3 text-lg font-titulo tracking-wider border-papel/40 text-papel hover:bg-papel/10"
            >
              ¿Cómo pedir?
            </Button>
          </div>
        </div>

        {/* Columna derecha: Emblema circular con logo, anillo SVG rotativo y ticket ABIERTO/CERRADO */}
        <div className="lg:col-span-5 flex flex-col items-center lg:items-end">
          <div className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 flex items-center justify-center">
            {/* Círculo rojo central con el chef */}
            <div className="w-44 h-44 sm:w-56 sm:h-56 md:w-64 md:h-64 rounded-full bg-primario flex items-center justify-center shadow-2xl relative z-0">
              <img
                src="/logo.png"
                alt=""
                width={160}
                height={160}
                className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 object-contain"
              />
            </div>

            {/* Anillo de texto circular SVG que gira muy lento */}
            <svg
              viewBox="0 0 320 320"
              aria-hidden="true"
              className={`absolute inset-0 w-full h-full pointer-events-none ${
                reproduciendo ? 'motion-safe:animate-[spin_40s_linear_infinite]' : ''
              }`}
              style={{ animationPlayState: reproduciendo ? 'running' : 'paused' }}
            >
              <defs>
                <path
                  id="textoAnilloPath"
                  d="M 160, 160 m -125, 0 a 125,125 0 1,1 250,0 a 125,125 0 1,1 -250,0"
                />
              </defs>
              <text
                fill="#FFF3E6"
                className="font-titulo text-[14px] uppercase tracking-[0.18em]"
              >
                <textPath
                  href="#textoAnilloPath"
                  startOffset="0%"
                  textLength="785.4"
                  lengthAdjust="spacing"
                >
                  SABOR VALLENATO <tspan fill="#FFB81C">•</tspan> SERVICIO INTELIGENTE <tspan fill="#FFB81C">•</tspan> SABOR VALLENATO <tspan fill="#FFB81C">•</tspan> SERVICIO INTELIGENTE <tspan fill="#FFB81C">•</tspan>{' '}
                </textPath>
              </text>
            </svg>

            {/* Ticket de estado de horario sobre el borde del emblema */}
            <div className="absolute -bottom-2 -left-2 sm:bottom-2 sm:-left-4 z-10 -rotate-6 bg-papel text-tinta border-2 border-dashed border-tinta/40 rounded-xl px-4 py-2.5 shadow-2xl">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    estado.abierto ? 'bg-exito' : 'bg-neutral-400'
                  }`}
                />
                <span className="font-titulo text-xl sm:text-2xl tracking-wider uppercase leading-none">
                  {estado.abierto ? 'ABIERTO' : 'CERRADO'}
                </span>
              </div>
              <p className="text-xs font-cuerpo-poster font-medium text-tinta/80 mt-1 whitespace-nowrap">
                {estado.texto}
              </p>
            </div>
          </div>

          {/* En celular: botón debajo del emblema para no tapar el ticket de horario */}
          {montado && (
            <div className="mt-6 flex sm:hidden justify-center z-20">
              <button
                type="button"
                onClick={alternarReproduccion}
                aria-pressed={!reproduciendo}
                aria-label={
                  reproduciendo
                    ? 'Pausar video y animación de la portada'
                    : 'Reproducir video y animación de la portada'
                }
                className="px-3.5 py-1.5 rounded-xl bg-superficie/85 hover:bg-superficie text-texto text-xs font-etiqueta font-bold uppercase tracking-wider border border-borde backdrop-blur-sm cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto shadow-lg"
              >
                {reproduciendo ? 'Pausar animación' : 'Reproducir animación'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cinta ámbar inclinada al pie (-rotate-2, sin scroll horizontal, centrada y adaptable en celular) */}
      <div className="relative z-10 w-full overflow-hidden mt-8 sm:mt-12 -mb-2 sm:-mb-3">
        <div className="w-[120%] -ml-[10%] bg-ambar text-tinta py-2.5 sm:py-3.5 -rotate-2 shadow-2xl select-none flex justify-center">
          <ul className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-6 gap-y-1 font-titulo text-xs sm:text-base md:text-lg tracking-wider uppercase text-center px-4 max-w-5xl mx-auto list-none m-0">
            <li>PIDE DESDE TU MESA</li>
            <li aria-hidden="true" className="text-primario text-xs sm:text-sm">✦</li>
            <li>ESCANEA EL QR</li>
            <li aria-hidden="true" className="text-primario text-xs sm:text-sm">✦</li>
            <li>SIGUE TU PEDIDO EN VIVO</li>
            <li aria-hidden="true" className="text-primario text-xs sm:text-sm">✦</li>
            <li>SIN APPS</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export default Inicio;
