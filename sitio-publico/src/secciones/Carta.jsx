import { useEffect, useMemo, useRef, useState } from 'react';
import TituloSeccion from '../componentes/TituloSeccion.jsx';
import CategoriaFiltro from '../components/menu/CategoriaFiltro.jsx';
import PlatoCard from '../components/menu/PlatoCard.jsx';
import DialogoSimuladorPlato from '../components/menu/DialogoSimuladorPlato.jsx';
import Button from '../components/ui/Button.jsx';
import { formatearPrecio } from '../utils/formato.js';
import {
  leerPreferenciasVideoNavegador,
  debeCargarVideo,
} from '../utils/sitioPublico.js';
import restauranteDefault from '../datos/restaurante.js';

function normalizar(texto = '') {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Tarjeta de plato armable / personalizable estilo póster de restaurante.
 * Incluye video o póster, etiqueta 'Personalizable', precio 'Desde $ ...' en etiqueta girada,
 * resumen de pasos en ámbar y botón 'Ver ingredientes' que abre el simulador.
 */
export function TarjetaPlatoArmablePublico({
  plato,
  onSeleccionar,
  onVerIngredientes,
  datosRestaurante = restauranteDefault,
}) {
  const pasos = Array.isArray(plato.pasos) ? plato.pasos : [];
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const videoInfo =
    datosRestaurante.videosPlatos?.[plato.nombre] ||
    restauranteDefault.videosPlatos?.[plato.nombre];
  const [desactivarVideo, setDesactivarVideo] = useState(false);
  const [errorImagen, setErrorImagen] = useState(false);

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
  const imagenUrl = plato.imagen || plato.url_imagen;
  const resumenPasos = pasos.map((p) => p.nombre).join(', ');

  const manejarAbrirIngredientes = () => {
    if (onVerIngredientes) {
      onVerIngredientes(plato);
    } else if (onSeleccionar) {
      onSeleccionar(plato);
    }
  };

  return (
    <article className="flex flex-col bg-[#161010] border border-papel/15 rounded-2xl overflow-hidden shadow-xl">
      {/* Contenedor multimedia */}
      <div
        ref={containerRef}
        className="relative aspect-[16/11] w-full overflow-hidden bg-gradient-to-br from-[#43201a] to-[#150c0c] shrink-0"
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
        ) : videoInfo?.poster && !errorImagen ? (
          <img
            src={videoInfo.poster}
            alt={`Plato personalizable ${plato.nombre}`}
            width={640}
            height={440}
            loading="lazy"
            decoding="async"
            onError={() => setErrorImagen(true)}
            className="w-full h-full object-cover"
          />
        ) : imagenUrl && !errorImagen ? (
          <img
            src={imagenUrl}
            alt={`Plato personalizable ${plato.nombre}`}
            width={640}
            height={440}
            loading="lazy"
            decoding="async"
            onError={() => setErrorImagen(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#43201a] to-[#150c0c]" />
        )}

        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-[#0c0707]/75 via-transparent to-transparent pointer-events-none"
        />

        {/* Badge Personalizable */}
        <span className="absolute left-4 top-4 z-10 bg-ambar text-tinta font-titulo tracking-wider text-sm px-3 py-1 rounded shadow-md">
          Personalizable
        </span>

        {/* Precio Desde en etiqueta ámbar girada */}
        <span className="absolute right-[-0.25rem] bottom-4 z-10 etiqueta-girada font-titulo text-xl sm:text-2xl tracking-wide px-3.5 py-1.5 shadow-xl rotate-[-3deg]">
          Desde {formatearPrecio(plato.precio)}
        </span>
      </div>

      {/* Cuerpo */}
      <div className="p-5 sm:p-6 flex flex-col gap-3 flex-1 justify-between">
        <div className="space-y-2">
          <h3 className="font-titulo text-3xl sm:text-4xl uppercase text-papel tracking-wide leading-tight m-0">
            {plato.nombre}
          </h3>

          {plato.descripcion && (
            <p className="font-cuerpo-poster text-sm sm:text-base text-papel/70 leading-relaxed m-0">
              {plato.descripcion}
            </p>
          )}

          {resumenPasos && (
            <p className="font-cuerpo-poster text-sm font-semibold text-ambar m-0 pt-1">
              {resumenPasos}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={manejarAbrirIngredientes}
          className="mt-4 min-h-12 px-6 rounded-lg border-2 border-papel text-papel hover:bg-papel hover:text-tinta font-titulo text-xl uppercase tracking-wider transition-colors cursor-pointer w-full flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto"
        >
          Ver ingredientes
        </button>
      </div>
    </article>
  );
}

function TarjetaPlatoDestacado({ plato, onSeleccionarPlato }) {
  const [errorImagen, setErrorImagen] = useState(false);
  const img = plato.imagen || plato.url_imagen;

  return (
    <button
      type="button"
      onClick={() => onSeleccionarPlato?.(plato)}
      className="group relative w-full aspect-[4/5] text-left p-0 border-0 rounded-xl overflow-hidden bg-gradient-to-br from-[#43201a] to-[#150c0c] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto shadow-xl"
    >
      {img && !errorImagen ? (
        <img
          src={img}
          alt=""
          width={640}
          height={800}
          loading="lazy"
          decoding="async"
          onError={() => setErrorImagen(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : null}

      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[#0c0707]/95 via-[#0c0707]/35 to-transparent pointer-events-none"
      />

      <span className="absolute top-4 -right-1 z-10 etiqueta-girada font-titulo text-2xl tracking-wide px-3.5 py-1.5 shadow-xl rotate-[3deg]">
        {formatearPrecio(plato.precio)}
      </span>

      <div className="absolute left-0 right-0 bottom-0 z-10 p-5 sm:p-6 space-y-1.5">
        <h3
          title={plato.nombre}
          className="font-titulo text-3xl sm:text-4xl text-papel uppercase tracking-wide leading-none line-clamp-2 m-0"
        >
          {plato.nombre}
        </h3>
        {plato.descripcion && (
          <p className="font-cuerpo-poster text-sm sm:text-base text-papel/75 line-clamp-2 leading-snug m-0">
            {plato.descripcion}
          </p>
        )}
      </div>
    </button>
  );
}

/**
 * Sección 'Carta' al estilo póster de restaurante.
 * - Título con dos líneas contorno + relleno.
 * - Filtros por pestañas horizontales.
 * - En "Todas": "Los más pedidos" con 3 destacados, luego "Toda la carta" sin duplicados ni adicionales.
 * - Categoría Adicionales presentada como lista de menú de 2 columnas con puntos guía.
 * - Subsección 'Arma tu plato' con videos, etiquetas y simulador interactivo.
 */
function CartaSeccion({
  menu = null,
  cargando = false,
  error = false,
  onReintentar,
  onSeleccionarPlato,
  datosRestaurante = restauranteDefault,
  categoriaInicial = null,
  categoriaSeleccionada = null,
}) {
  const [categoriaInterna, setCategoriaInterna] = useState(
    categoriaSeleccionada ?? categoriaInicial
  );
  const categoriaActiva = categoriaSeleccionada ?? categoriaInterna;
  const setCategoriaActiva = setCategoriaInterna;
  const [anuncioLive, setAnuncioLive] = useState('');
  const [platoSimulador, setPlatoSimulador] = useState(null);
  const prevDispRef = useRef(null);

  const categorias = useMemo(() => menu?.categorias ?? [], [menu]);
  const platos = useMemo(() => menu?.platos ?? [], [menu]);
  const armables = useMemo(() => menu?.armables ?? [], [menu]);
  const origen = menu?.origen ?? 'fija';

  // Anunciar cambios de disponibilidad
  useEffect(() => {
    if (!menu) return undefined;
    const mapaDisp = (menu.platos || [])
      .map((p) => `${p.id}:${p.disponible}`)
      .join(',');
    if (prevDispRef.current !== null && prevDispRef.current !== mapaDisp) {
      setAnuncioLive('Carta actualizada');
      const timer = setTimeout(() => setAnuncioLive(''), 4000);
      return () => clearTimeout(timer);
    }
    prevDispRef.current = mapaDisp;
    return undefined;
  }, [menu]);

  // Identificar la categoría de adicionales por nombre
  const catAdicionales = useMemo(() => {
    return categorias.find((c) => normalizar(c.nombre) === 'adicionales');
  }, [categorias]);

  const esAdicional = (plato) => {
    if (!catAdicionales) return false;
    const cId = plato.categoriaId ?? plato.categoria_id ?? plato.id_categoria;
    return cId === catAdicionales.id;
  };

  // Buscar destacados por nombre
  const nombresDestacados = useMemo(() => {
    const lista =
      datosRestaurante.platosDestacados ||
      restauranteDefault.platosDestacados ||
      [];
    return lista.map(normalizar);
  }, [datosRestaurante.platosDestacados]);

  const platosDestacados = useMemo(() => {
    if (nombresDestacados.length === 0) return [];
    return nombresDestacados
      .map((norm) => platos.find((p) => normalizar(p.nombre) === norm))
      .filter(Boolean);
  }, [platos, nombresDestacados]);

  const idsDestacados = useMemo(() => {
    return new Set(platosDestacados.map((p) => p.id));
  }, [platosDestacados]);

  // Platos en "Todas" excluyendo los destacados y los adicionales
  const demasPlatosTodas = useMemo(() => {
    return platos.filter((p) => !idsDestacados.has(p.id) && !esAdicional(p));
  }, [platos, idsDestacados, catAdicionales]);

  // Platos filtrados según categoría seleccionada
  const esVistaTodas =
    categoriaActiva === null ||
    categoriaActiva === 'todas' ||
    categoriaActiva === 'todos';

  const esVistaAdicionales =
    catAdicionales && categoriaActiva === catAdicionales.id;

  const platosFiltrados = useMemo(() => {
    if (esVistaTodas) {
      return demasPlatosTodas;
    }
    return platos.filter((p) => {
      const cId = p.categoriaId ?? p.categoria_id ?? p.id_categoria;
      return cId === categoriaActiva;
    });
  }, [platos, categoriaActiva, esVistaTodas, demasPlatosTodas]);

  return (
    <section
      id="carta"
      aria-labelledby="carta-titulo"
      className="fondo-poster-brillo-tr text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10"
    >
      {/* Región accesible aria-live */}
      <div
        aria-live="polite"
        role="status"
        aria-atomic="true"
        className="sr-only"
      >
        {anuncioLive}
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 space-y-10 sm:space-y-12">
        <div>
          <TituloSeccion
            id="carta-titulo"
            linea1="Nuestra"
            linea2="Carta"
            descripcion="Toca cualquier plato para ver su descripción, ingredientes y alérgenos."
          />
          {origen === 'fija' && (
            <p className="text-xs text-ambar font-semibold mt-3 font-cuerpo-poster">
              Carta de referencia: precios y disponibilidad pueden cambiar.
            </p>
          )}
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
            <Button type="button" variante="primario" onClick={onReintentar}>
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            {/* Pestañas de categoría */}
            <CategoriaFiltro
              categorias={categorias}
              categoriaSeleccionada={categoriaActiva}
              onSeleccionar={setCategoriaActiva}
            />

            {/* Vista 'Todas': Bloque de más pedidos + Toda la carta */}
            {esVistaTodas && (
              <div className="space-y-12">
                {platosDestacados.length > 0 && (
                  <div className="space-y-6">
                    <h3 className="font-titulo text-3xl sm:text-4xl uppercase tracking-wider text-papel m-0">
                      Los más pedidos
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {platosDestacados.map((plato) => (
                        <TarjetaPlatoDestacado
                          key={plato.id}
                          plato={plato}
                          onSeleccionarPlato={onSeleccionarPlato}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-6">
                  {platosDestacados.length > 0 && (
                    <h3 className="font-titulo text-3xl sm:text-4xl uppercase tracking-wider text-papel m-0">
                      Toda la carta
                    </h3>
                  )}
                  {demasPlatosTodas.length === 0 ? (
                    <p className="text-center text-papel/60 py-8 font-cuerpo-poster">
                      No hay platos en esta vista.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {demasPlatosTodas.map((plato) => (
                        <PlatoCard
                          key={plato.id}
                          plato={plato}
                          onSeleccionar={onSeleccionarPlato}
                          soloLectura
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Vista 'Adicionales': lista tipo menú en 2 columnas */}
            {!esVistaTodas && esVistaAdicionales && (
              <div className="space-y-6">
                <p className="font-cuerpo-poster text-base text-papel/75 m-0">
                  Pídelos junto a cualquiera de tus platos.
                </p>
                {platosFiltrados.length === 0 ? (
                  <p className="text-center text-papel/60 py-8 font-cuerpo-poster">
                    No hay adicionales disponibles por ahora.
                  </p>
                ) : (
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-2 list-none p-0 m-0">
                    {platosFiltrados.map((plato) => (
                      <li key={plato.id}>
                        <button
                          type="button"
                          onClick={() => onSeleccionarPlato?.(plato)}
                          className="group w-full py-4 text-left bg-transparent border-0 border-b border-dashed border-papel/20 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto block transition-colors"
                        >
                          <div className="flex items-baseline gap-3">
                            <h3
                              title={plato.nombre}
                              className="font-titulo text-2xl uppercase tracking-wide text-papel group-hover:text-ambar transition-colors m-0 line-clamp-1"
                            >
                              {plato.nombre}
                            </h3>
                            <span
                              aria-hidden="true"
                              className="flex-1 border-b-2 border-dotted border-papel/30 translate-y-[-4px]"
                            />
                            <span className="font-titulo text-2xl text-ambar tracking-wide shrink-0">
                              {formatearPrecio(plato.precio)}
                            </span>
                          </div>
                          {plato.descripcion && (
                            <p className="font-cuerpo-poster text-sm text-papel/70 line-clamp-2 mt-1 m-0">
                              {plato.descripcion}
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Vista de otra categoría específica */}
            {!esVistaTodas && !esVistaAdicionales && (
              <div>
                {platosFiltrados.length === 0 ? (
                  <p className="text-center text-papel/60 py-12 font-cuerpo-poster">
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
              </div>
            )}

            {/* Subsección 'Arma tu plato' */}
            {armables.length > 0 && (
              <div
                id="arma-tu-plato"
                className="pt-16 sm:pt-20 border-t border-papel/15 space-y-10"
              >
                <TituloSeccion
                  id="arma-titulo"
                  linea1="Arma"
                  linea2="tu plato"
                  descripcion="Bases, proteínas, acompañamientos y salsas a tu gusto. Mira las opciones y arma el plato en tu mesa."
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {armables.map((plato) => (
                    <TarjetaPlatoArmablePublico
                      key={plato.id_plato}
                      plato={plato}
                      onSeleccionar={onSeleccionarPlato}
                      onVerIngredientes={setPlatoSimulador}
                      datosRestaurante={datosRestaurante}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Diálogo interactivo del simulador */}
      <DialogoSimuladorPlato
        key={platoSimulador?.id_plato ?? 'cerrado'}
        plato={platoSimulador}
        abierto={Boolean(platoSimulador)}
        onCerrar={() => setPlatoSimulador(null)}
      />
    </section>
  );
}

export default CartaSeccion;
