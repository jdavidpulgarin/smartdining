import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { obtenerMenuPublico, recargarMenu } from '../services/menuService';
import {
  normalizarConfiguracion,
  obtenerConfiguracionPublica,
  recargarConfiguracion,
  tieneDatosRestaurante,
} from '../services/configuracionService';
import CategoriaFiltro from '../components/menu/CategoriaFiltro';
import PlatoCard from '../components/menu/PlatoCard';
import PlatoDetalleModal from '../components/menu/PlatoDetalleModal';
import Button from '../components/ui/Button';
import { formatearPrecio } from '../utils/formato';
import {
  VIDEOS_SITIO,
  debeCargarVideo,
  leerPreferenciasVideoNavegador,
  elegirPosterPortada,
  elegirPosterArmaTuPlato,
  describirReglaPaso,
} from '../utils/sitioPublico';

const ENLACES_SECCIONES = [
  { href: '#carta', etiqueta: 'Carta' },
  { href: '#arma-tu-plato', etiqueta: 'Arma tu plato' },
  { href: '#nuestro-restaurante', etiqueta: 'Nuestro restaurante' },
];

function VideoFondo({
  src,
  poster,
  altPoster,
  permitirVideo,
  lazyPoster = false,
  className = '',
}) {
  const [videoFallido, setVideoFallido] = useState(false);
  const mostrarVideo = permitirVideo && Boolean(src) && !videoFallido;

  return (
    <div
      className={`relative overflow-hidden bg-superficie ${className}`.trim()}
    >
      <img
        src={poster}
        alt={altPoster}
        loading={lazyPoster ? 'lazy' : undefined}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {mostrarVideo && (
        <video
          key={src}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster}
          aria-hidden="true"
          onError={() => setVideoFallido(true)}
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source
            src={src}
            type="video/mp4"
            onError={() => setVideoFallido(true)}
          />
        </video>
      )}
    </div>
  );
}

function TarjetaPlatoArmablePublico({ plato }) {
  const pasos = Array.isArray(plato.pasos) ? plato.pasos : [];

  return (
    <article className="bg-superficie rounded-3xl border border-borde overflow-hidden flex flex-col justify-between shadow-lg">
      <div>
        <div className="relative w-full aspect-[16/9] bg-superficie-2 border-b border-borde overflow-hidden">
          {plato.url_imagen ? (
            <img
              src={plato.url_imagen}
              alt={`Plato personalizable ${plato.nombre}`}
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-texto-tenue font-etiqueta uppercase tracking-wider text-sm">
              Arma tu plato
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-superficie via-superficie/30 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex items-end justify-between gap-3">
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-acento text-fondo font-etiqueta font-bold text-xs uppercase tracking-wider mb-1">
                Personalizable
              </span>
              <h3 className="font-titulo text-3xl sm:text-4xl text-texto uppercase tracking-wide leading-none">
                {plato.nombre}
              </h3>
            </div>
            <span className="shrink-0 font-etiqueta font-bold text-2xl text-acento bg-fondo/85 backdrop-blur-sm px-3 py-1 rounded-xl border border-borde">
              Desde {formatearPrecio(plato.precio)}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {plato.descripcion && (
            <p className="text-sm text-texto-suave font-cuerpo leading-relaxed">
              {plato.descripcion}
            </p>
          )}

          {pasos.length > 0 && (
            <div className="space-y-3">
              {pasos.map((paso, idx) => {
                const ingredientes = Array.isArray(paso.ingredientes)
                  ? paso.ingredientes
                  : [];
                const regla = describirReglaPaso(paso);

                return (
                  <div
                    key={paso.id_paso ?? idx}
                    className="bg-superficie-2 rounded-2xl border border-borde p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-etiqueta font-bold text-base uppercase tracking-wide text-texto">
                        <span className="text-acento mr-1.5">
                          Paso {idx + 1}.
                        </span>
                        {paso.nombre}
                      </h4>
                      {regla && (
                        <span className="text-[11px] font-etiqueta uppercase tracking-wider px-2 py-0.5 rounded-md bg-superficie text-texto-suave border border-borde">
                          {regla}
                        </span>
                      )}
                    </div>

                    {ingredientes.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5 pt-1">
                        {ingredientes.map((ing) => {
                          const extra = Number(ing.precio_extra) || 0;
                          const agotado = ing.disponible === false;
                          return (
                            <li
                              key={ing.id_ingrediente ?? ing.nombre}
                              className={`inline-flex items-center gap-1.5 text-xs font-cuerpo px-2.5 py-1 rounded-lg border ${
                                agotado
                                  ? 'bg-superficie border-borde text-texto-tenue line-through'
                                  : 'bg-superficie border-borde text-texto'
                              }`}
                            >
                              <span>{ing.nombre}</span>
                              {extra > 0 && (
                                <span className="font-etiqueta font-bold text-acento">
                                  +{formatearPrecio(extra)}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-3.5 bg-superficie-2 border-t border-borde flex items-center gap-2.5 text-xs sm:text-sm text-acento font-semibold">
        <span className="w-2 h-2 rounded-full bg-acento shrink-0" />
        <p>Este plato lo armas a tu gusto en la mesa</p>
      </div>
    </article>
  );
}

function Carta() {
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [armables, setArmables] = useState([]);
  const [config, setConfig] = useState(() => normalizarConfiguracion(null));
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [categoriaActiva, setCategoriaActiva] = useState('todos');
  const [platoSeleccionado, setPlatoSeleccionado] = useState(null);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [logoFallido, setLogoFallido] = useState(false);

  const [preferenciasVideo, setPreferenciasVideo] = useState(() =>
    leerPreferenciasVideoNavegador()
  );

  useEffect(() => {
    try {
      if (
        typeof window === 'undefined' ||
        typeof window.matchMedia !== 'function'
      ) {
        return undefined;
      }
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      const actualizar = () => {
        setPreferenciasVideo(leerPreferenciasVideoNavegador());
      };
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', actualizar);
        return () => mql.removeEventListener('change', actualizar);
      }
    } catch {
      // Ignorar si matchMedia no está disponible
    }
    return undefined;
  }, []);

  useEffect(() => {
    let cancelado = false;

    async function cargarInicial() {
      try {
        const [datosMenu, datosConfig] = await Promise.all([
          obtenerMenuPublico(),
          obtenerConfiguracionPublica().catch(() =>
            normalizarConfiguracion(null)
          ),
        ]);

        if (!cancelado) {
          setCategorias(datosMenu.categorias);
          setPlatos(datosMenu.platos);
          setArmables(datosMenu.armables);
          setConfig(datosConfig);
          setLogoFallido(false);
        }
      } catch (err) {
        console.error('Error al cargar el sitio público:', err);
        if (!cancelado) {
          setError(true);
        }
      } finally {
        if (!cancelado) {
          setCargando(false);
        }
      }
    }

    cargarInicial();

    return () => {
      cancelado = true;
    };
  }, []);

  const manejarReintentar = async () => {
    recargarMenu();
    recargarConfiguracion();
    setCargando(true);
    setError(false);

    try {
      const [datosMenu, datosConfig] = await Promise.all([
        obtenerMenuPublico({ forzar: true }),
        obtenerConfiguracionPublica({ forzar: true }).catch(() =>
          normalizarConfiguracion(null)
        ),
      ]);

      setCategorias(datosMenu.categorias);
      setPlatos(datosMenu.platos);
      setArmables(datosMenu.armables);
      setConfig(datosConfig);
      setLogoFallido(false);
    } catch (err) {
      console.error('Error al reintentar el sitio público:', err);
      setError(true);
    } finally {
      setCargando(false);
    }
  };

  const permitirVideo = useMemo(
    () => debeCargarVideo(preferenciasVideo),
    [preferenciasVideo]
  );

  const posterPortada = useMemo(
    () => elegirPosterPortada(platos, armables),
    [platos, armables]
  );

  const posterArmaTuPlato = useMemo(
    () => elegirPosterArmaTuPlato(armables, platos),
    [armables, platos]
  );

  const platosFiltrados = useMemo(() => {
    if (categoriaActiva === 'todos') return platos;
    return platos.filter((p) => p.categoriaId === categoriaActiva);
  }, [platos, categoriaActiva]);

  const nombreRestaurante = config.nombre || 'SmartDining';
  const mostrarInfoRestaurante = tieneDatosRestaurante(config);
  const anioActual = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-fondo text-texto font-cuerpo flex flex-col overflow-x-hidden">
      {/* a) Encabezado fijo */}
      <header className="sticky top-0 z-50 bg-fondo/95 backdrop-blur-md border-b border-borde">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <a
            href="#portada"
            className="flex items-center gap-3 min-w-0 min-h-11 focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto rounded-xl"
          >
            {config.url_logo && !logoFallido ? (
              <img
                src={config.url_logo}
                alt={`Logo de ${nombreRestaurante}`}
                loading="lazy"
                onError={() => setLogoFallido(true)}
                className="w-10 h-10 rounded-xl object-cover bg-superficie-2 border border-borde shrink-0"
              />
            ) : (
              <span
                aria-hidden="true"
                className="w-10 h-10 shrink-0 rounded-xl bg-primario flex items-center justify-center text-white font-etiqueta font-bold text-xl tracking-wider shadow-sm"
              >
                SD
              </span>
            )}
            <span className="font-titulo text-2xl sm:text-3xl tracking-wider uppercase text-texto truncate">
              {nombreRestaurante}
            </span>
          </a>

          {/* Navegación de escritorio */}
          <nav
            aria-label="Secciones del sitio"
            className="hidden md:flex items-center gap-2 lg:gap-4"
          >
            {ENLACES_SECCIONES.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="min-h-11 px-3 inline-flex items-center font-etiqueta uppercase tracking-wider text-base font-bold text-texto-suave hover:text-acento transition-colors rounded-xl"
              >
                {item.etiqueta}
              </a>
            ))}
          </nav>

          {/* Botón Iniciar sesión deshabilitado (Próximamente) en escritorio */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="min-h-11 px-4 py-2 rounded-xl border border-borde bg-superficie-2 text-texto-suave font-etiqueta uppercase tracking-wider text-sm font-bold inline-flex items-center gap-2 opacity-75 cursor-not-allowed"
            >
              <span>Iniciar sesión</span>
              <span className="px-2 py-0.5 rounded-full bg-acento/15 text-acento border border-acento/30 text-[10px] font-etiqueta font-bold tracking-widest uppercase">
                Próximamente
              </span>
            </button>
          </div>

          {/* Botón menú hamburguesa en celular */}
          <button
            type="button"
            onClick={() => setMenuMovilAbierto((prev) => !prev)}
            aria-expanded={menuMovilAbierto}
            aria-controls="menu-movil-publico"
            aria-label={menuMovilAbierto ? 'Cerrar menú' : 'Abrir menú'}
            className="md:hidden min-w-11 min-h-11 p-2.5 rounded-xl border border-borde bg-superficie-2 text-texto hover:bg-superficie inline-flex items-center justify-center cursor-pointer"
          >
            {menuMovilAbierto ? (
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Panel desplegable móvil */}
        {menuMovilAbierto && (
          <nav
            id="menu-movil-publico"
            aria-label="Menú móvil"
            className="md:hidden border-t border-borde bg-superficie px-4 py-3 space-y-2"
          >
            {ENLACES_SECCIONES.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuMovilAbierto(false)}
                className="min-h-11 px-3 rounded-xl flex items-center font-etiqueta uppercase tracking-wider text-lg font-bold text-texto hover:bg-superficie-2 transition-colors"
              >
                {item.etiqueta}
              </a>
            ))}
            <div className="pt-2 border-t border-borde">
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="w-full min-h-11 px-4 py-2 rounded-xl border border-borde bg-superficie-2 text-texto-suave font-etiqueta uppercase tracking-wider text-sm font-bold inline-flex items-center justify-between opacity-75 cursor-not-allowed"
              >
                <span>Iniciar sesión</span>
                <span className="px-2 py-0.5 rounded-full bg-acento/15 text-acento border border-acento/30 text-[10px] font-etiqueta font-bold tracking-widest uppercase">
                  Próximamente
                </span>
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">
        {/* b) Portada (hero) */}
        <section
          id="portada"
          className="relative min-h-[420px] sm:min-h-[500px] lg:min-h-[560px] flex items-center border-b border-borde overflow-hidden"
        >
          <VideoFondo
            src={VIDEOS_SITIO.portada}
            poster={posterPortada}
            altPoster={`Especialidades de ${nombreRestaurante}`}
            permitirVideo={permitirVideo}
            lazyPoster={false}
            className="absolute inset-0 w-full h-full"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-fondo via-fondo/80 to-fondo/45"
          />

          <div className="relative z-10 max-w-6xl mx-auto w-full px-4 sm:px-6 py-16 sm:py-24">
            <div className="max-w-2xl space-y-5">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-superficie-2/90 border border-borde text-acento font-etiqueta uppercase tracking-widest text-xs font-bold">
                Carta digital · {nombreRestaurante}
              </span>
              <h1 className="font-titulo text-5xl sm:text-6xl lg:text-7xl uppercase tracking-wider text-texto leading-none">
                Sabor artesanal hecho al instante
              </h1>
              <p className="text-base sm:text-lg text-texto-suave font-cuerpo max-w-xl leading-relaxed">
                Conoce nuestros platos, ingredientes frescos y combinaciones
                personalizables antes de pedir en tu mesa.
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <a
                  href="#carta"
                  className="min-h-12 px-6 py-3 rounded-xl bg-primario hover:bg-primario-hover text-white font-etiqueta uppercase text-lg tracking-wider font-bold inline-flex items-center justify-center transition-colors shadow-lg"
                >
                  Ver la carta
                </a>
                <a
                  href="#arma-tu-plato"
                  className="min-h-12 px-6 py-3 rounded-xl border border-texto/80 bg-fondo/50 hover:bg-texto/10 text-texto font-etiqueta uppercase text-lg tracking-wider font-bold inline-flex items-center justify-center transition-colors"
                >
                  Arma tu plato
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* c) Carta por categorías */}
        <section
          id="carta"
          className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-8 scroll-mt-16"
        >
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
                Nuestra selección
              </span>
              <h2 className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none mt-1">
                Carta
              </h2>
            </div>
            <p className="text-sm text-texto-suave max-w-md">
              Toca cualquier plato para ver su descripción detallada,
              ingredientes y alérgenos.
            </p>
          </div>

          {cargando ? (
            <div
              role="status"
              aria-busy="true"
              aria-label="Cargando la carta"
              className="space-y-6"
            >
              <div className="flex gap-2 overflow-hidden">
                {[1, 2, 3, 4].map((n) => (
                  <div
                    key={n}
                    className="h-11 w-28 rounded-full bg-superficie-2 animate-pulse shrink-0"
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <div
                    key={n}
                    className="h-80 rounded-2xl bg-superficie-2 border border-borde animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : error ? (
            <div
              role="alert"
              className="bg-superficie-2 border border-borde rounded-2xl p-8 text-center max-w-md mx-auto space-y-4"
            >
              <p className="text-base text-texto font-medium">
                No pudimos cargar la carta. Inténtalo de nuevo.
              </p>
              <Button
                type="button"
                variante="primario"
                onClick={manejarReintentar}
              >
                Reintentar
              </Button>
            </div>
          ) : (
            <>
              <CategoriaFiltro
                categorias={categorias}
                seleccionada={categoriaActiva}
                onSeleccionar={setCategoriaActiva}
              />

              {platosFiltrados.length === 0 ? (
                <p className="text-center text-texto-suave py-12">
                  No hay platos en esta categoría por ahora.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {platosFiltrados.map((plato) => (
                    <PlatoCard
                      key={plato.id}
                      plato={plato}
                      onSeleccionar={setPlatoSeleccionado}
                      soloLectura
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* d) "Arma tu plato" */}
        <section
          id="arma-tu-plato"
          className="border-t border-borde bg-superficie-2/50 py-12 sm:py-16 scroll-mt-16"
        >
          <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-8">
            <div className="relative rounded-3xl overflow-hidden border border-borde min-h-[240px] sm:min-h-[280px] flex items-end">
              <VideoFondo
                src={VIDEOS_SITIO.armaTuPlato}
                poster={posterArmaTuPlato}
                altPoster="Ingredientes frescos para armar tu plato"
                permitirVideo={permitirVideo}
                lazyPoster
                className="absolute inset-0 w-full h-full"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-fondo via-fondo/80 to-fondo/30"
              />
              <div className="relative z-10 p-6 sm:p-8 max-w-2xl space-y-2">
                <span className="inline-block px-3 py-1 rounded-full bg-acento text-fondo font-etiqueta font-bold text-xs uppercase tracking-widest">
                  Experiencia interactiva en mesa
                </span>
                <h2 className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none">
                  Arma tu plato
                </h2>
                <p className="text-sm sm:text-base text-texto-suave font-cuerpo">
                  Explora nuestras bases, proteínas, acompañamientos y salsas.
                  Este plato lo armas a tu gusto en la mesa.
                </p>
              </div>
            </div>

            {!cargando && !error && armables.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {armables.map((plato) => (
                  <TarjetaPlatoArmablePublico
                    key={plato.id_plato}
                    plato={plato}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* e) "Nuestro restaurante" */}
        <section
          id="nuestro-restaurante"
          className="border-t border-borde max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-8 scroll-mt-16"
        >
          <div>
            <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
              Visítanos
            </span>
            <h2 className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none mt-1">
              Nuestro restaurante
            </h2>
          </div>

          {mostrarInfoRestaurante ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {config.direccion && (
                <div className="bg-superficie-2 rounded-2xl border border-borde p-5 space-y-2">
                  <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                    Dirección
                  </h3>
                  <p className="text-base text-texto font-cuerpo leading-relaxed">
                    {config.direccion}
                  </p>
                </div>
              )}

              {config.telefono && (
                <div className="bg-superficie-2 rounded-2xl border border-borde p-5 space-y-2">
                  <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                    Teléfono
                  </h3>
                  <p className="text-base text-texto font-cuerpo">
                    <a
                      href={`tel:${config.telefono.replace(/\s+/g, '')}`}
                      className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                    >
                      {config.telefono}
                    </a>
                  </p>
                </div>
              )}

              {config.correo && (
                <div className="bg-superficie-2 rounded-2xl border border-borde p-5 space-y-2">
                  <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                    Correo
                  </h3>
                  <p className="text-base text-texto font-cuerpo break-all">
                    <a
                      href={`mailto:${config.correo}`}
                      className="min-h-11 inline-flex items-center hover:text-acento underline decoration-borde underline-offset-4 transition-colors"
                    >
                      {config.correo}
                    </a>
                  </p>
                </div>
              )}

              {config.horario && config.horario.length > 0 && (
                <div className="bg-superficie-2 rounded-2xl border border-borde p-5 space-y-3 md:col-span-2 lg:col-span-2">
                  <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                    Horario de atención
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    {config.horario.map((item) => (
                      <div
                        key={item.dia}
                        className="flex items-center justify-between py-1.5 border-b border-borde/60 last:border-b-0"
                      >
                        <dt className="font-semibold text-texto">{item.dia}</dt>
                        <dd className="text-texto-suave font-etiqueta tracking-wide text-base">
                          {item.texto}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {config.redes && config.redes.length > 0 && (
                <div className="bg-superficie-2 rounded-2xl border border-borde p-5 space-y-3">
                  <h3 className="font-etiqueta uppercase tracking-wider text-sm font-bold text-acento">
                    Redes sociales
                  </h3>
                  <ul className="flex flex-wrap gap-2">
                    {config.redes.map((red) => (
                      <li key={`${red.nombre}-${red.valor}`}>
                        {red.url ? (
                          <a
                            href={red.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-11 px-3.5 py-2 rounded-xl bg-superficie border border-borde hover:border-acento text-sm font-etiqueta uppercase tracking-wider font-bold text-texto inline-flex items-center gap-1.5 transition-colors"
                          >
                            <span>{red.nombre}</span>
                          </a>
                        ) : (
                          <span className="min-h-11 px-3.5 py-2 rounded-xl bg-superficie border border-borde text-sm font-cuerpo text-texto inline-flex items-center gap-1.5">
                            <strong className="font-etiqueta uppercase tracking-wider text-acento">
                              {red.nombre}:
                            </strong>{' '}
                            <span>{red.valor}</span>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-texto-suave">
              Consulta en el local nuestros horarios y canales de atención.
            </p>
          )}
        </section>

        {/* f) Llamado final */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
          <div className="rounded-3xl bg-gradient-to-r from-superficie-2 via-superficie to-superficie-2 border border-borde p-6 sm:p-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <h2 className="font-titulo text-3xl sm:text-4xl uppercase tracking-wider text-texto leading-none">
                ¿Ya estás en el restaurante? Escanea el QR de tu mesa para pedir.
              </h2>
              <p className="text-sm sm:text-base text-acento font-semibold">
                También puedes pedirle al mesero.
              </p>
            </div>
            <Link
              to="/"
              className="min-h-12 px-6 py-3 rounded-xl bg-primario hover:bg-primario-hover text-white font-etiqueta uppercase tracking-wider text-lg font-bold inline-flex items-center justify-center shrink-0 transition-colors"
            >
              Ir al inicio de mesa
            </Link>
          </div>
        </section>
      </main>

      {/* g) Pie de página */}
      <footer className="border-t border-borde bg-superficie py-10 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1.5">
            <p className="font-titulo text-2xl tracking-wider uppercase text-texto">
              {nombreRestaurante}
            </p>
            {(config.direccion || config.telefono || config.correo) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-texto-suave">
                {config.direccion && <span>{config.direccion}</span>}
                {config.telefono && <span>Tel: {config.telefono}</span>}
                {config.correo && <span>{config.correo}</span>}
              </div>
            )}
          </div>

          <nav
            aria-label="Enlaces del pie de página"
            className="flex flex-wrap items-center gap-3"
          >
            {ENLACES_SECCIONES.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="min-h-11 px-2 inline-flex items-center font-etiqueta uppercase tracking-wider text-sm font-bold text-texto-suave hover:text-acento transition-colors"
              >
                {item.etiqueta}
              </a>
            ))}
          </nav>

          <p className="text-xs text-texto-tenue font-cuerpo">
            © {anioActual} SmartDining
          </p>
        </div>
      </footer>

      {/* Modal de detalle en solo lectura */}
      <PlatoDetalleModal
        key={platoSeleccionado?.id ?? 'cerrado'}
        plato={platoSeleccionado}
        abierto={Boolean(platoSeleccionado)}
        onCerrar={() => setPlatoSeleccionado(null)}
        soloLectura
      />
    </div>
  );
}

export default Carta;
