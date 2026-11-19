import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  recargarMenu,
  refrescarMenu,
  actualizarDisponibilidadPlatoEnCache,
  actualizarDisponibilidadEnCache,
  suscribirCambiosMenu,
  adaptarCategorias,
  adaptarPlatos,
  adaptarPlatosArmables,
  aplicarDisponibilidadEnListaPlatos,
  aplicarDisponibilidadIngredienteEnArmables,
} from '../services/menuService';
import CategoriaFiltro from '../components/menu/CategoriaFiltro';
import PlatoCard from '../components/menu/PlatoCard';
import PlatoDetalleModal from '../components/menu/PlatoDetalleModal';
import Imagen from '../components/ui/Imagen';
import Button from '../components/ui/Button';
import { useCarrito } from '../context/CarritoContext';
import { useMesaSocket } from '../context/MesaSocketContext';
import { obtenerApodo } from '../utils/apodo';
import { generarIdLinea } from '../utils/id';
import { formatearPrecio } from '../utils/formato';
import { urlImagen } from '../utils/imagenes';

function Menu({
  cargandoInicial = true,
  platosArmablesInicial = [],
  categoriasInicial = [],
  platosInicial = [],
} = {}) {
  const navigate = useNavigate();
  const [categorias, setCategorias] = useState(categoriasInicial);
  const [platos, setPlatos] = useState(platosInicial);
  const [platosArmables, setPlatosArmables] = useState(platosArmablesInicial);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null);
  const [idPlatoSeleccionado, setIdPlatoSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(cargandoInicial);
  const [errorMenu, setErrorMenu] = useState(null);
  const [errorHero, setErrorHero] = useState(false);
  const [toastMensaje, setToastMensaje] = useState(null);
  const toastTimeoutRef = useRef(null);

  const { agregarLinea, totalUnidades, total } = useCarrito();
  const { on: socketOn, estado: estadoSocket } = useMesaSocket();

  const platoSeleccionado = useMemo(
    () =>
      idPlatoSeleccionado
        ? platos.find((p) => p.id === idPlatoSeleccionado) || null
        : null,
    [idPlatoSeleccionado, platos]
  );

  // Escuchar eventos de disponibilidad en vivo (platos e ingredientes)
  useEffect(() => {
    if (!socketOn) return undefined;

    const bajaPlato = socketOn('plato:disponibilidad', (data) => {
      const idPlato = Number(data?.id_plato ?? data?.idPlato);
      const disponible = Boolean(data?.disponible);
      if (!idPlato) return;

      actualizarDisponibilidadPlatoEnCache(idPlato, disponible);

      setPlatos((prev) =>
        aplicarDisponibilidadEnListaPlatos(prev, idPlato, disponible)
      );
      setPlatosArmables((prev) =>
        aplicarDisponibilidadEnListaPlatos(prev, idPlato, disponible)
      );
    });

    const bajaIng = socketOn('ingrediente:disponibilidad', (data) => {
      const idIng = Number(data?.id_ingrediente ?? data?.idIngrediente);
      const disponible = Boolean(data?.disponible);
      if (!idIng) return;

      actualizarDisponibilidadEnCache(idIng, disponible);

      setPlatosArmables((prev) =>
        aplicarDisponibilidadIngredienteEnArmables(prev, idIng, disponible)
      );
    });

    return () => {
      bajaPlato?.();
      bajaIng?.();
    };
  }, [socketOn]);

  // Suscribirse a cambios del menú (para pintar cambios que llegaron mientras no estaba montada)
  useEffect(() => {
    const bajaSuscripcion = suscribirCambiosMenu((nuevoMenu) => {
      if (!nuevoMenu) return;
      setCategorias(adaptarCategorias(nuevoMenu));
      setPlatos(adaptarPlatos(nuevoMenu));
      setPlatosArmables(adaptarPlatosArmables(nuevoMenu));
    });
    return bajaSuscripcion;
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setErrorMenu(null);
    try {
      const [cats, plats, armables] = await Promise.all([
        obtenerCategorias(),
        obtenerPlatos(),
        obtenerPlatosArmables(),
      ]);
      setCategorias(cats);
      setPlatos(plats);
      setPlatosArmables(Array.isArray(armables) ? armables : []);
    } catch (error) {
      console.error('Error al cargar datos del menú:', error);
      setErrorMenu(error?.mensaje || 'No se pudo cargar el menú. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  }, []);

  // Carga inicial al montar: SIEMPRE vuelve a pedir GET /menu. Es la red de
  // seguridad de menu:actualizado (EVENTS.md §5.8): si el aviso no llegó (socket
  // caído, celular dormido), volver al Menú trae la carta vigente. Antes solo
  // recargaba con marcas locales de un 409 y, si no, pintaba la copia en memoria.
  useEffect(() => {
    let activo = true;
    refrescarMenu().catch(() => {});
    (async () => {
      try {
        const [cats, plats, armables] = await Promise.all([
          obtenerCategorias(),
          obtenerPlatos(),
          obtenerPlatosArmables(),
        ]);
        if (!activo) return;
        setErrorMenu(null);
        setCategorias(cats);
        setPlatos(plats);
        setPlatosArmables(Array.isArray(armables) ? armables : []);
      } catch (error) {
        console.error('Error al cargar datos del menú:', error);
        if (activo) {
          setErrorMenu(error?.mensaje || 'No se pudo cargar el menú. Intenta de nuevo.');
        }
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, []);

  const estadoAnteriorSocketRef = useRef(estadoSocket);
  useEffect(() => {
    if (
      estadoAnteriorSocketRef.current === 'reconectando' &&
      estadoSocket === 'conectado'
    ) {
      recargarMenu();
      setCargando(true);
      cargarDatos();
    }
    estadoAnteriorSocketRef.current = estadoSocket;
  }, [estadoSocket, cargarDatos]);

  const platosFiltrados = categoriaSeleccionada
    ? platos.filter((p) => p.categoriaId === categoriaSeleccionada)
    : platos;

  const manejarAgregar = (item) => {
    const apodo = obtenerApodo();
    const linea = {
      id_linea: generarIdLinea(),
      comensal: apodo,
      id_plato: item.plato.id,
      cantidad: item.cantidad,
      notas: item.notasCocina,
      nombre: item.plato.nombre,
      precioUnitario: item.precioUnitario,
      selecciones: item.selecciones,
      notasCliente: item.notasCliente,
    };

    agregarLinea(linea);
    setIdPlatoSeleccionado(null);

    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMensaje(`${item.plato.nombre} añadido al carrito`);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMensaje(null);
    }, 2000);
  };

  if (cargando) {
    return (
      <div className="space-y-6 pb-24 animate-pulse pt-2 px-4" aria-label="Cargando menú">
        {/* Hero esqueleto */}
        <div className="bg-papel rounded-2xl p-2.5 shadow-md -rotate-1 mx-1">
          <div className="h-40 bg-papel-linea/40 rounded-xl" />
        </div>
        <div className="space-y-2 px-1">
          <div className="h-6 bg-carbon/10 rounded w-48" />
          <div className="h-14 bg-carbon/15 rounded w-3/4" />
        </div>

        {/* Arma tu plato esqueleto */}
        <div className="space-y-3 px-1">
          <div className="flex justify-between items-center">
            <div className="h-7 bg-carbon/15 rounded w-36" />
            <div className="h-6 bg-granate/20 rounded w-28" />
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="w-[260px] shrink-0 bg-papel rounded-t-2xl p-3 space-y-3 shadow-md"
              >
                <div className="w-full h-36 rounded-xl bg-papel-linea/40" />
                <div className="h-5 bg-carbon/15 rounded w-3/4" />
                <div className="h-4 bg-carbon/10 rounded w-full" />
                <div className="h-10 bg-carbon/20 rounded-xl w-full" />
              </div>
            ))}
          </div>
        </div>

        {/* Categorías esqueleto */}
        <div className="flex gap-2.5 overflow-x-auto px-1 py-1">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-10 w-24 bg-papel border-2 border-carbon rounded-full shrink-0 opacity-60"
            />
          ))}
        </div>

        {/* Platos normales esqueleto */}
        <div className="grid grid-cols-1 gap-4 px-1">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="bg-papel rounded-2xl p-3 flex gap-3.5 shadow-md"
            >
              <div className="w-[104px] h-[104px] shrink-0 rounded-xl bg-papel-linea/40" />
              <div className="flex flex-col justify-between flex-1 py-1 space-y-2">
                <div className="h-5 bg-carbon/15 rounded w-2/3" />
                <div className="h-4 bg-carbon/10 rounded w-full" />
                <div className="h-6 bg-brasa/20 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (errorMenu) {
    return (
      <div
        role="alert"
        className="ticket-comanda bg-papel text-tinta rounded-t-2xl shadow-2xl p-6 sm:p-8 text-center space-y-4 my-8 mx-4 max-w-md"
      >
        <div className="banda-comanda -mx-6 sm:-mx-8 -mt-6 sm:-mt-8 rounded-t-2xl py-2 mb-4">
          AVISO
        </div>
        <div
          aria-hidden="true"
          className="w-14 h-14 bg-brasa/10 text-brasa border-2 border-brasa rounded-full flex items-center justify-center mx-auto text-2xl font-bold"
        >
          !
        </div>
        <div>
          <h1 className="font-titulo text-2xl font-bold uppercase tracking-wider text-carbon">
            No pudimos cargar el menú
          </h1>
          <p className="text-sm text-papel-suave mt-1.5 font-cuerpo">{errorMenu}</p>
        </div>
        <div className="corte-comanda -mx-6 sm:-mx-8 my-4" />
        <Button
          variante="primario"
          className="btn-comanda w-full cursor-pointer"
          onClick={() => {
            recargarMenu();
            cargarDatos();
          }}
        >
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden space-y-6 pb-28">
      {/* Portada Hero del Menú */}
      <section className="pt-6 pb-2 px-4 overflow-hidden">
        <div className="relative bg-papel p-2.5 rounded-2xl -rotate-2 shadow-[0_20px_30px_-16px_rgba(0,0,0,0.6)]">
          {!errorHero ? (
            <img
              src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=75&auto=format"
              alt=""
              width={800}
              height={533}
              fetchPriority="high"
              decoding="async"
              onError={() => setErrorHero(true)}
              className="w-full h-38 sm:h-44 object-cover rounded-lg block"
            />
          ) : (
            <div
              className="w-full h-38 sm:h-44 rounded-lg bg-gradient-to-br from-carbon via-[#2A1D1B] to-carbon"
              aria-hidden="true"
            />
          )}
          <img
            src="/img/mascota-chef.webp"
            alt=""
            aria-hidden="true"
            className="absolute -right-2 -top-10 w-20 rotate-10 drop-shadow-[0_8px_8px_rgba(0,0,0,0.35)] pointer-events-none animate-flotar"
          />
        </div>

        <p className="mt-7 font-titulo text-lg tracking-[0.3em] uppercase text-carbon">
          EXPERIENCIA SMARTDINING
        </p>
        <h1
          className="font-titulo text-6xl sm:text-7xl uppercase text-carbon leading-[0.88] mt-1 mb-3"
          style={{ textShadow: '5px 5px 0 #E5212E' }}
        >
          NUESTRO MENÚ
        </h1>
        <p className="text-base sm:text-lg text-tinta font-medium leading-relaxed max-w-[30ch]">
          Elige tus platos favoritos o ármalos a tu gusto.
        </p>
      </section>

      {/* Sección Arma tu plato */}
      {platosArmables.length > 0 && (
        <section aria-labelledby="titulo-arma-tu-plato" className="space-y-3 pt-2">
          <div className="flex items-baseline justify-between gap-2 px-4">
            <h2
              id="titulo-arma-tu-plato"
              className="font-titulo text-3xl font-bold uppercase tracking-wide text-carbon leading-none"
            >
              ARMA TU PLATO
            </h2>
            <span className="font-manuscrita text-2xl font-bold text-granate">
              Paso a paso a tu gusto
            </span>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory scrollbar-none px-4">
            {platosArmables.map((plato) => (
              <article
                key={plato.id_plato}
                className={`ticket-comanda flex-none w-[min(80%,300px)] snap-start bg-papel rounded-t-2xl shadow-xl flex flex-col justify-between transition-all ${
                  plato.disponible === false ? 'opacity-50 grayscale-[30%]' : ''
                }`}
              >
                <div>
                  <div className="p-2.5 pb-0 relative">
                    <Imagen
                      src={urlImagen(plato.url_imagen)}
                      alt={plato.nombre}
                      aspecto="4/3"
                      className="w-full h-42 object-cover rounded-xl"
                    />
                    {plato.disponible === false && (
                      <span className="absolute inset-2.5 bg-black/75 backdrop-blur-[1px] flex items-center justify-center text-ambar text-sm font-titulo font-bold uppercase tracking-wider text-center rounded-xl">
                        AGOTADO
                      </span>
                    )}
                  </div>
                  <div className="p-3.5 pt-3 pb-2">
                    <h3 className="font-titulo text-2xl font-bold uppercase tracking-wide text-carbon leading-tight">
                      {plato.nombre}
                    </h3>
                    {plato.descripcion && (
                      <p className="mt-1 text-xs text-papel-suave leading-relaxed line-clamp-2 font-cuerpo">
                        {plato.descripcion}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <div className="corte-comanda my-0" />
                  <div className="p-3.5 pt-3 pb-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-papel-suave font-cuerpo">
                          Desde
                        </span>
                        <b className="font-titulo text-2xl text-brasa leading-none">
                          {formatearPrecio(plato.precio)}
                        </b>
                      </div>
                      {plato.calorias != null && (
                        <span className="text-xs font-bold font-cuerpo bg-carbon text-ambar px-2.5 py-0.5 rounded-full">
                          ≈ {plato.calorias} kcal
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={plato.disponible === false}
                      onClick={() => {
                        if (plato.disponible !== false) {
                          navigate(`/armar/${plato.id_plato}`);
                        }
                      }}
                      className="btn-comanda w-full h-13 text-xl py-2 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span>{plato.disponible === false ? 'Agotado' : 'Armar mi plato'}</span>
                      {plato.disponible !== false && (
                        <svg
                          className="w-5 h-5 shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Filtro horizontal de categorías */}
      <CategoriaFiltro
        categorias={categorias}
        categoriaSeleccionada={categoriaSeleccionada}
        onSeleccionar={setCategoriaSeleccionada}
      />

      {/* Grid de platos o mensaje de estado vacío */}
      <section className="px-4">
        {platosFiltrados.length === 0 ? (
          <div className="ticket-comanda bg-papel rounded-t-2xl shadow-xl p-8 text-center space-y-2 my-4">
            <div className="w-12 h-12 bg-carbon/5 text-carbon rounded-full flex items-center justify-center mx-auto text-2xl">
              🍽️
            </div>
            <p className="text-carbon font-titulo uppercase font-bold text-xl">
              No hay platos en esta categoría
            </p>
            <p className="text-papel-suave text-xs mt-1 font-cuerpo">
              Prueba seleccionando otra categoría o la opción &ldquo;Todas&rdquo;.
            </p>
            <div className="pt-2 font-manuscrita text-2xl text-granate font-bold">
              Pronto habrá más platos aquí
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 pt-1">
            {platosFiltrados.map((plato) => (
              <PlatoCard
                key={plato.id}
                plato={plato}
                onSeleccionar={(p) => setIdPlatoSeleccionado(p.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Modal de detalle del plato */}
      <PlatoDetalleModal
        key={idPlatoSeleccionado ?? 'ninguno'}
        plato={platoSeleccionado}
        abierto={idPlatoSeleccionado !== null && platoSeleccionado !== null}
        onCerrar={() => setIdPlatoSeleccionado(null)}
        onAgregar={manejarAgregar}
      />

      {/* Barra de pedido flotante cuando hay unidades en el carrito */}
      {totalUnidades > 0 && (
        <Link
          to="/carrito"
          aria-label="Ver mi pedido"
          className="fixed left-1/2 bottom-[max(14px,env(safe-area-inset-bottom))] -translate-x-1/2 w-[min(440px,calc(100%-28px))] z-30 flex items-center justify-between gap-3 bg-carbon text-ambar rounded-2xl p-3 pl-5 shadow-2xl transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] border-2 border-carbon"
        >
          <div>
            <b className="block font-titulo text-2xl tracking-wide uppercase leading-tight">
              {totalUnidades} {totalUnidades === 1 ? 'PLATO' : 'PLATOS'}
            </b>
            <small className="block font-semibold text-xs text-[#E9C98A]">
              Ver mi pedido · {formatearPrecio(total)}
            </small>
          </div>
          <i
            aria-hidden="true"
            className="not-italic grid place-items-center w-11 h-11 rounded-xl bg-ambar text-carbon shrink-0 font-bold"
          >
            <svg
              className="w-6 h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </i>
        </Link>
      )}

      {/* Feedback visual accesible (toast temporal) */}
      {toastMensaje && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-carbon text-ambar border-2 border-ambar text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 max-w-[90vw]"
        >
          <span className="text-brasa font-bold" aria-hidden="true">
            ✓
          </span>
          <span className="truncate">{toastMensaje}</span>
        </div>
      )}
    </div>
  );
}

export default Menu;
