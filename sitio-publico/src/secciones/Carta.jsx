import { useEffect, useMemo, useRef, useState } from 'react';
import CategoriaFiltro from '../components/menu/CategoriaFiltro.jsx';
import PlatoCard from '../components/menu/PlatoCard.jsx';
import Button from '../components/ui/Button.jsx';
import { formatearPrecio } from '../utils/formato.js';
import {
  describirReglaPaso,
  leerPreferenciasVideoNavegador,
  debeCargarVideo,
} from '../utils/sitioPublico.js';
import restaurante from '../datos/restaurante.js';

export function TarjetaPlatoArmablePublico({ plato, onSeleccionar }) {
  const pasos = Array.isArray(plato.pasos) ? plato.pasos : [];
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const videoInfo = restaurante.videosPlatos?.[plato.nombre];
  const [desactivarVideo, setDesactivarVideo] = useState(false);

  useEffect(() => {
    if (!videoInfo) return undefined;
    const prefs = leerPreferenciasVideoNavegador();
    if (!debeCargarVideo(prefs)) {
      setDesactivarVideo(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!videoRef.current) return;
          if (entry.isIntersecting) {
            videoRef.current.play().catch(() => {});
          } else {
            videoRef.current.pause();
          }
        });
      },
      { threshold: 0.4 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [videoInfo]);

  const mostrarVideo = Boolean(videoInfo && !desactivarVideo);

  return (
    <article className="bg-superficie rounded-3xl border border-borde overflow-hidden flex flex-col justify-between shadow-lg">
      <div>
        <div
          ref={containerRef}
          className="relative w-full aspect-[16/9] bg-superficie-2 border-b border-borde overflow-hidden"
        >
          {mostrarVideo ? (
            <video
              ref={videoRef}
              src={videoInfo.archivo}
              poster={videoInfo.poster}
              muted
              loop
              playsInline
              preload="none"
              aria-hidden="true"
              tabIndex={-1}
              className="w-full h-full object-cover"
            />
          ) : videoInfo ? (
            <img
              src={videoInfo.poster}
              alt={`Plato personalizable ${plato.nombre}`}
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : plato.url_imagen ? (
            <img
              src={plato.url_imagen}
              alt={`Plato personalizable ${plato.nombre}`}
              width={640}
              height={360}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-superficie-2" />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-superficie via-superficie/30 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-acento text-fondo font-etiqueta font-bold text-xs uppercase tracking-wider mb-1">
                Personalizable
              </span>
              <h3 className="font-titulo text-3xl sm:text-4xl text-texto uppercase tracking-wide leading-none">
                {plato.nombre}
              </h3>
            </div>
            <span className="shrink-0 font-etiqueta font-bold text-xl sm:text-2xl text-acento bg-fondo/85 backdrop-blur-sm px-3 py-1 rounded-xl border border-borde">
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
                              {agotado && (
                                <span className="ml-1 text-[10px] text-primario-texto font-bold uppercase not-italic">
                                  Agotado
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

      <div className="px-5 py-3.5 bg-superficie-2 border-t border-borde flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-xs sm:text-sm text-acento font-semibold">
          <span className="w-2 h-2 rounded-full bg-acento shrink-0" />
          <p>Este plato lo armas a tu gusto en la mesa</p>
        </div>
        <Button
          type="button"
          variante="secundario"
          onClick={() => onSeleccionar?.(plato)}
          className="text-xs sm:text-sm"
        >
          Ver ingredientes
        </Button>
      </div>
    </article>
  );
}

function CartaSeccion({
  menu = null,
  cargando = false,
  error = false,
  onReintentar,
  onSeleccionarPlato,
}) {
  const [categoriaActiva, setCategoriaActiva] = useState(null);
  const [anuncioLive, setAnuncioLive] = useState('');
  const prevDispRef = useRef(null);

  const categorias = useMemo(() => menu?.categorias ?? [], [menu]);
  const platos = useMemo(() => menu?.platos ?? [], [menu]);
  const armables = useMemo(() => menu?.armables ?? [], [menu]);
  const origen = menu?.origen ?? 'fija';

  // Anunciar actualización de disponibilidad en la región aria-live
  useEffect(() => {
    if (!menu) return undefined;
    const mapaDisp = (menu.platos || []).map((p) => `${p.id}:${p.disponible}`).join(',');
    if (prevDispRef.current !== null && prevDispRef.current !== mapaDisp) {
      setAnuncioLive('Carta actualizada');
      const timer = setTimeout(() => setAnuncioLive(''), 4000);
      return () => clearTimeout(timer);
    }
    prevDispRef.current = mapaDisp;
    return undefined;
  }, [menu]);

  const platosFiltrados = useMemo(() => {
    if (!categoriaActiva || categoriaActiva === 'todos' || categoriaActiva === 'todas') {
      return platos;
    }
    return platos.filter((p) => {
      const cId = p.categoriaId ?? p.categoria_id ?? p.id_categoria;
      return cId === categoriaActiva;
    });
  }, [platos, categoriaActiva]);

  return (
    <section
      id="carta"
      aria-labelledby="titulo-carta"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 scroll-mt-16 space-y-12"
    >
      {/* Región accesible aria-live para cambios de disponibilidad */}
      <div
        aria-live="polite"
        role="status"
        aria-atomic="true"
        className="sr-only"
      >
        {anuncioLive}
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
            Nuestra selección
          </span>
          <h2
            id="titulo-carta"
            className="font-titulo text-4xl sm:text-5xl uppercase tracking-wider text-texto leading-none mt-1"
          >
            Carta
          </h2>
          {origen === 'fija' && (
            <p className="text-sm text-acento font-semibold mt-2">
              Carta de referencia: precios y disponibilidad pueden cambiar.
            </p>
          )}
        </div>
        <p className="text-sm text-texto-suave max-w-md">
          Toca cualquier plato para ver su descripción detallada, ingredientes y alérgenos.
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
            onClick={onReintentar}
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <CategoriaFiltro
            categorias={categorias}
            categoriaSeleccionada={categoriaActiva}
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
                  onSeleccionar={onSeleccionarPlato}
                  soloLectura
                />
              ))}
            </div>
          )}

          {/* Subsección Arma tu plato */}
          {armables.length > 0 && (
            <div id="subseccion-arma-tu-plato" className="pt-8 space-y-6">
              <div className="space-y-2">
                <span className="font-etiqueta uppercase tracking-widest text-xs font-bold text-acento">
                  Experiencia interactiva en mesa
                </span>
                <h3 className="font-titulo text-3xl sm:text-4xl uppercase tracking-wider text-texto leading-none">
                  Arma tu plato
                </h3>
                <p className="text-sm sm:text-base text-texto-suave font-cuerpo">
                  Explora nuestras bases, proteínas, acompañamientos y salsas. Este plato lo armas a tu gusto en la mesa.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {armables.map((plato) => (
                  <TarjetaPlatoArmablePublico
                    key={plato.id_plato}
                    plato={plato}
                    onSeleccionar={onSeleccionarPlato}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default CartaSeccion;
