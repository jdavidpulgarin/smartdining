import { useEffect, useRef, useState } from 'react';
import Button from '../components/ui/Button.jsx';
import { leerPreferenciasVideoNavegador } from '../utils/sitioPublico.js';
import { elegirFuentePortada } from '../utils/portada.js';

/**
 * Sección de portada (Hero).
 * El póster LCP se encuentra siempre en el HTML estático inicial con fetchpriority="high".
 * El video y el control accesible de pausa se montan solo tras el primer render en el cliente.
 */
function Inicio({ datosRestaurante = {} }) {
  const [videoSrc, setVideoSrc] = useState(null);
  const [reproduciendo, setReproduciendo] = useState(true);
  const videoRef = useRef(null);

  const nombre = datosRestaurante.nombre || 'SmartDining Restaurante';
  const eslogan = datosRestaurante.eslogan || '';

  useEffect(() => {
    const ancho = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const prefs = leerPreferenciasVideoNavegador();
    const fuente = elegirFuentePortada({ anchoPantalla: ancho, prefs });
    if (fuente) {
      setVideoSrc(fuente);
    }
  }, []);

  const alternarReproduccion = () => {
    if (!videoRef.current) return;
    if (reproduciendo) {
      videoRef.current.pause();
      setReproduciendo(false);
    } else {
      videoRef.current.play();
      setReproduciendo(true);
    }
  };

  return (
    <section
      id="inicio"
      aria-labelledby="titulo-inicio"
      className="relative min-h-[85vh] flex items-center justify-center border-b border-borde overflow-hidden scroll-mt-16 py-20 px-4 sm:px-6"
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

      {/* Capa de degradado oscuro para garantizar contraste AA de texto */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-fondo via-fondo/80 to-fondo/45"
      />

      {/* Control WCAG 2.2.2 para pausar/reanudar movimiento de video */}
      {videoSrc && (
        <button
          type="button"
          onClick={alternarReproduccion}
          aria-pressed={!reproduciendo}
          aria-label={
            reproduciendo ? 'Pausar video de portada' : 'Reproducir video de portada'
          }
          className="absolute bottom-4 right-4 z-20 px-3.5 py-1.5 rounded-xl bg-superficie/80 hover:bg-superficie text-texto text-xs font-etiqueta font-bold uppercase tracking-wider border border-borde backdrop-blur-sm cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
        >
          {reproduciendo ? 'Pausar video' : 'Reproducir video'}
        </button>
      )}

      {/* Contenido centrado de la portada */}
      <div className="relative z-10 max-w-4xl mx-auto w-full text-center space-y-6">
        <img
          src="/logo.png"
          alt={nombre}
          width={160}
          height={160}
          className="w-28 h-28 sm:w-36 sm:h-36 lg:w-40 lg:h-40 object-contain rounded-3xl mx-auto shadow-2xl bg-superficie-2/60 border border-borde p-2"
        />

        <div className="space-y-3">
          <h1
            id="titulo-inicio"
            className="font-titulo text-5xl sm:text-6xl lg:text-7xl uppercase tracking-wider text-texto leading-none"
          >
            {nombre}
          </h1>
          {eslogan && (
            <p className="text-base sm:text-lg lg:text-xl text-texto-suave font-cuerpo max-w-xl mx-auto leading-relaxed">
              {eslogan}
            </p>
          )}
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-center gap-4">
          <Button href="#carta" variante="primario">
            Ver la carta
          </Button>
          <Button href="#como-pedir" variante="secundario">
            ¿Cómo pedir?
          </Button>
        </div>
      </div>
    </section>
  );
}

export default Inicio;
