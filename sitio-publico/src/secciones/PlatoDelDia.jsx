import { useEffect, useRef, useState } from 'react';
import { diaDeHoy, msHastaMedianocheBogota, obtenerPlatoDelDia } from '../utils/platoDelDia.js';

/**
 * Determina el día inicial para la sección:
 * 1. Prioriza prop explícito (para pruebas y control).
 * 2. Si estamos en DEV, comprueba query param ?dia=... en la URL.
 * 3. En cualquier otro caso, calcula el día de hoy en Bogotá.
 * @param {string|undefined} diaProp
 * @returns {string}
 */
function resolverDiaInicial(diaProp) {
  if (diaProp) {
    return diaProp;
  }
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const parametroDia = params.get('dia');
    if (parametroDia) {
      return parametroDia;
    }
  }
  return diaDeHoy();
}

/**
 * Sección "Plato del día" (promoción semanal).
 * Sección conectada a la carta en vivo para obtener precio y disponibilidad en tiempo real.
 * No realiza llamadas a la API duplicadas: consume la carta provista por App.jsx.
 */
export default function PlatoDelDia({
  dia: diaProp,
  carta,
  cargandoCarta = false,
  errorCarta = false,
  plato: platoProp,
}) {
  const [diaActual, setDiaActual] = useState(() => resolverDiaInicial(diaProp));
  const [reproduciendo, setReproduciendo] = useState(true);
  const [soloPortada, setSoloPortada] = useState(false);

  const seccionRef = useRef(null);
  const videoRef = useRef(null);

  // Si cambia el prop explícito de día, sincroniza el estado
  useEffect(() => {
    if (diaProp) {
      setDiaActual(diaProp);
    }
  }, [diaProp]);

  // Detección de preferencias de accesibilidad y ahorro de datos
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const conexion = navigator.connection;
    const prefiereAhorro = Boolean(conexion && conexion.saveData);

    const actualizarAhorro = () => {
      const reduceMovimiento = Boolean(mediaQuery && mediaQuery.matches);
      setSoloPortada(reduceMovimiento || prefiereAhorro);
    };

    actualizarAhorro();

    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener('change', actualizarAhorro);
      return () => mediaQuery.removeEventListener('change', actualizarAhorro);
    }
  }, []);

  // Programación del cambio de día a medianoche y detección de regreso a la pestaña
  useEffect(() => {
    if (diaProp) return;

    let temporizadorId;

    const programarSiguienteMedianoche = () => {
      const ms = msHastaMedianocheBogota();
      temporizadorId = setTimeout(() => {
        setDiaActual(diaDeHoy());
        programarSiguienteMedianoche();
      }, ms + 500);
    };

    programarSiguienteMedianoche();

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') {
        setDiaActual(diaDeHoy());
      }
    };

    document.addEventListener('visibilitychange', alCambiarVisibilidad);

    return () => {
      if (temporizadorId) clearTimeout(temporizadorId);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [diaProp]);

  const plato = platoProp || obtenerPlatoDelDia(diaActual, carta);
  const tieneVideo = Boolean(plato.video && plato.poster);

  // IntersectionObserver para reproducir video solo cuando la sección es visible
  useEffect(() => {
    if (!tieneVideo || soloPortada || typeof window === 'undefined') return;

    const seccionEl = seccionRef.current;
    if (!seccionEl) return;

    const observador = new IntersectionObserver(
      (entries) => {
        const [entrada] = entries;
        const video = videoRef.current;
        if (!video) return;

        if (entrada.isIntersecting && reproduciendo) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.25 }
    );

    observador.observe(seccionEl);

    return () => {
      observador.disconnect();
    };
  }, [tieneVideo, soloPortada, reproduciendo]);

  const alternarReproduccion = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch(() => {});
      setReproduciendo(true);
    } else {
      video.pause();
      setReproduciendo(false);
    }
  };

  // Si hay error en la carta, o el plato está agotado o no existe: bloque corto
  if (errorCarta || plato.estado === 'agotado' || plato.estado === 'no-existe') {
    return (
      <section
        id="hoy"
        ref={seccionRef}
        aria-labelledby="titulo-plato-del-dia"
        className="relative fondo-poster text-papel py-12 sm:py-16 scroll-mt-16 border-b border-papel/10"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h2
            id="titulo-plato-del-dia"
            className="font-titulo text-3xl sm:text-4xl uppercase text-papel/80 tracking-wide"
          >
            Hoy no hay plato del día
          </h2>
        </div>
      </section>
    );
  }

  const formateadorPrecio = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });

  const tienePrecioValido =
    typeof plato.precio === 'number' && !Number.isNaN(plato.precio);

  const precioFormateado = tienePrecioValido
    ? formateadorPrecio.format(plato.precio)
    : null;

  // Si es carta de respaldo fija o está cargando, no se muestra precio ni botón de pedido
  const mostrarPrecioYPedido =
    !plato.esRespaldo && !cargandoCarta && tienePrecioValido;

  return (
    <section
      id="hoy"
      ref={seccionRef}
      aria-labelledby="titulo-plato-del-dia"
      className="relative fondo-poster-brillo-tr text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10 overflow-hidden"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* Columna multimedia (video 16:9 o tarjeta sin video) */}
          <div className="lg:col-span-7">
            {tieneVideo ? (
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-fondo shadow-2xl border border-papel/10 group">
                {soloPortada ? (
                  <img
                    src={plato.poster}
                    alt={plato.nombre}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      src={plato.video}
                      poster={plato.poster}
                      muted
                      loop
                      playsInline
                      preload="none"
                      className="w-full h-full object-cover"
                    />

                    {/* Botón visible de control de reproducción */}
                    <button
                      type="button"
                      onClick={alternarReproduccion}
                      aria-label={reproduciendo ? 'Pausar video del plato del día' : 'Reproducir video del plato del día'}
                      className="absolute bottom-4 right-4 z-10 p-3 rounded-full bg-superficie/80 text-papel backdrop-blur-md border border-papel/20 hover:bg-superficie hover:text-ambar focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto transition-all cursor-pointer shadow-lg"
                    >
                      {reproduciendo ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 translate-x-0.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="relative aspect-video rounded-2xl bg-superficie-2 border border-papel/10 p-8 sm:p-12 flex flex-col justify-center items-center text-center shadow-xl">
                <span className="font-etiqueta uppercase tracking-widest text-sm text-ambar mb-3">
                  Especialidad de la casa
                </span>
                <span className="font-titulo text-3xl sm:text-5xl uppercase text-papel tracking-wide">
                  {plato.nombre}
                </span>
                <div className="mt-4 w-16 h-1 bg-primario rounded-full" />
              </div>
            )}
          </div>

          {/* Columna informativa estilo póster */}
          <div className="lg:col-span-5 flex flex-col items-start w-full">
            {/* 1) Etiqueta tipo marbete de cocina: bloque ámbar sólido + día + raya ámbar */}
            <div
              className="flex items-center gap-2 mb-4 select-none"
              aria-label={`Plato del día, ${plato.diaEtiqueta || plato.dia}`}
            >
              <span className="bg-ambar text-tinta font-titulo tracking-widest text-sm px-2.5 py-1 rounded-[2px] leading-none uppercase">
                PLATO DEL DÍA
              </span>
              <span className="font-titulo text-papel tracking-widest text-sm leading-none uppercase">
                {(plato.diaEtiqueta || plato.dia || '').toUpperCase()}
              </span>
              <span className="w-12 h-0.5 bg-ambar shrink-0 ml-1" aria-hidden="true" />
            </div>

            {/* 2) Título en dos líneas en Bebas Neue: titulo1 en papel y titulo2 en ámbar */}
            <h2
              id="titulo-plato-del-dia"
              className="font-titulo text-5xl sm:text-7xl lg:text-8xl uppercase tracking-tight leading-[0.88] mt-1 mb-1"
            >
              <span className="block text-papel">{plato.titulo1 || plato.nombre}</span>
              {plato.titulo2 && (
                <span className="block text-ambar">{plato.titulo2}</span>
              )}
            </h2>

            {/* Lema en letra a mano Caveat (ámbar, un poco inclinado) */}
            {plato.lema && (
              <span className="font-mano text-2xl sm:text-3xl text-ambar block -rotate-3 origin-left mb-3">
                {plato.lema}
              </span>
            )}

            {/* 3) Descripción suelta debajo del lema */}
            <p className="font-cuerpo text-texto-suave text-sm sm:text-base leading-relaxed max-w-lg mb-6">
              {plato.descripcion}
            </p>

            {/* 4) Ticket de papel con precio y botón de pedido (solo cuando está disponible en carta viva) */}
            {mostrarPrecioYPedido && (
              <>
                <div className="ticket-papel inline-flex flex-col items-start px-5 pt-4 pb-6 mb-6 max-w-full">
                  <small className="font-cuerpo text-[11px] font-bold uppercase tracking-[0.2em] text-primario-oscuro mb-1">
                    PRECIO DE HOY
                  </small>
                  <span className="font-titulo text-4xl sm:text-5xl text-tinta leading-none">
                    {precioFormateado}
                  </span>
                  <span className="font-cuerpo text-xs text-[#5b4a46] mt-1.5">
                    Disponible hoy
                  </span>
                </div>

                <div className="pt-1">
                  <a
                    href="#como-pedir"
                    className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-ambar text-tinta font-titulo text-lg sm:text-xl uppercase tracking-wider hover:bg-ambar/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto shadow-md"
                  >
                    PÍDELO EN TU MESA →
                  </a>
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </section>
  );
}
