import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  recargarMenu,
  tieneMarcasAgotadoLocal,
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
import Card from '../components/ui/Card';
import Imagen from '../components/ui/Imagen';
import Button from '../components/ui/Button';
import { useCarrito } from '../context/CarritoContext';
import { useMesaSocket } from '../context/MesaSocketContext';
import { obtenerApodo } from '../utils/apodo';
import { generarIdLinea } from '../utils/id';
import { formatearPrecio } from '../utils/formato';
import { urlImagen } from '../utils/imagenes';

function Menu() {
  const navigate = useNavigate();
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [platosArmables, setPlatosArmables] = useState([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null);
  const [idPlatoSeleccionado, setIdPlatoSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorMenu, setErrorMenu] = useState(null);
  const [toastMensaje, setToastMensaje] = useState(null);
  const toastTimeoutRef = useRef(null);

  const { agregarLinea } = useCarrito();
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

  // Carga inicial al montar el componente (si había marcas locales de 409, recarga GET /menu)
  useEffect(() => {
    let activo = true;
    if (tieneMarcasAgotadoLocal()) {
      recargarMenu();
    }
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
      <div className="space-y-4 pb-6 animate-pulse" aria-label="Cargando menú">
        {/* Hero esqueleto */}
        <div className="-mx-4 -mt-4 mb-4 h-56 bg-superficie-2 rounded-b-3xl" />

        {/* Arma tu plato esqueleto */}
        <div className="space-y-2.5">
          <div className="h-6 bg-superficie-2 rounded w-36" />
          <div className="flex gap-3 overflow-x-auto pb-2">
            {[1, 2, 3].map((item) => (
              <Card key={item} className="w-64 shrink-0 space-y-3 bg-superficie border border-borde">
                <div className="w-full aspect-4/3 rounded-xl bg-superficie-2" />
                <div className="h-4 bg-superficie-2 rounded w-3/4" />
                <div className="h-3 bg-superficie-2 rounded w-full" />
                <div className="h-10 bg-superficie-2 rounded-xl w-full" />
              </Card>
            ))}
          </div>
        </div>

        {/* Categorías esqueleto */}
        <div className="flex gap-2 overflow-x-auto py-1">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-9 w-24 bg-superficie-2 rounded-full shrink-0"
            />
          ))}
        </div>

        {/* Platos normales esqueleto */}
        <div className="grid grid-cols-1 gap-3">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="bg-superficie rounded-2xl border border-borde flex gap-3 p-3"
            >
              <div className="w-24 h-24 shrink-0 rounded-xl bg-superficie-2" />
              <div className="flex flex-col justify-between flex-1 py-1 space-y-2">
                <div className="h-4 bg-superficie-2 rounded w-2/3" />
                <div className="h-3 bg-superficie-2 rounded w-full" />
                <div className="h-4 bg-superficie-2 rounded w-1/4" />
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
        className="bg-superficie rounded-2xl border border-borde p-8 text-center space-y-4 my-8"
      >
        <div
          aria-hidden="true"
          className="w-12 h-12 bg-primario/15 text-primario rounded-full flex items-center justify-center mx-auto text-xl font-bold"
        >
          !
        </div>
        <div>
          <h1 className="font-etiqueta text-xl font-bold uppercase tracking-wider text-texto">
            No pudimos cargar el menú
          </h1>
          <p className="text-sm text-texto-suave mt-1">{errorMenu}</p>
        </div>
        <Button
          variante="primario"
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
    <div className="space-y-5 pb-6">
      {/* Portada Hero del Menú */}
      <div className="-mx-4 -mt-4 mb-2 relative h-56 sm:h-64 overflow-hidden rounded-b-3xl bg-superficie">
        <img
          src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800&q=75&auto=format"
          alt="Comida fresca de SmartDining"
          width={800}
          height={533}
          fetchPriority="high"
          decoding="async"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-fondo via-fondo/75 to-fondo/20" />
        <div className="absolute bottom-0 inset-x-0 p-4">
          <p className="text-xs font-etiqueta font-semibold uppercase tracking-widest text-primario-texto mb-1">
            Experiencia SmartDining
          </p>
          <h1 className="font-titulo text-5xl sm:text-6xl text-primario tracking-wider leading-none uppercase">
            NUESTRO MENÚ
          </h1>
          <p className="text-xs sm:text-sm text-texto-suave mt-1">
            Elige tus platos favoritos o ármalos a tu gusto.
          </p>
        </div>
      </div>

      {/* Sección Arma tu plato */}
      {platosArmables.length > 0 && (
        <section aria-labelledby="titulo-arma-tu-plato" className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2
              id="titulo-arma-tu-plato"
              className="font-etiqueta text-xl font-bold uppercase tracking-wider text-texto"
            >
              Arma tu plato
            </h2>
            <span className="text-xs text-texto-suave">Paso a paso a tu gusto</span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-none">
            {platosArmables.map((plato) => (
              <Card
                key={plato.id_plato}
                className={`w-64 shrink-0 snap-start flex flex-col justify-between gap-3 bg-superficie border border-borde rounded-2xl p-3 transition-all ${
                  plato.disponible === false ? 'opacity-40 grayscale-[25%]' : ''
                }`}
              >
                <div className="space-y-2">
                  <div className="relative">
                    <Imagen
                      src={urlImagen(plato.url_imagen)}
                      alt={plato.nombre}
                      aspecto="4/3"
                      className="w-full rounded-xl"
                    />
                    {plato.disponible === false && (
                      <span className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex items-center justify-center text-primario-texto text-xs font-etiqueta font-bold uppercase tracking-wider text-center px-1 rounded-xl">
                        AGOTADO
                      </span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-etiqueta text-base font-bold uppercase tracking-wide text-texto leading-snug">
                      {plato.nombre}
                    </h3>
                    {plato.descripcion && (
                      <p className="text-xs text-texto-suave mt-1 line-clamp-2 leading-relaxed">
                        {plato.descripcion}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5 pt-2 border-t border-borde">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold font-etiqueta text-sm text-white">
                      Desde {formatearPrecio(plato.precio)}
                    </span>
                    {plato.calorias != null && (
                      <span className="text-texto-suave font-medium">
                        ≈ {plato.calorias} kcal
                      </span>
                    )}
                  </div>
                  <Button
                    variante="primario"
                    className="w-full"
                    disabled={plato.disponible === false}
                    onClick={() => {
                      if (plato.disponible !== false) {
                        navigate(`/armar/${plato.id_plato}`);
                      }
                    }}
                  >
                    {plato.disponible === false ? 'Agotado' : 'Armar mi plato'}
                  </Button>
                </div>
              </Card>
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
      {platosFiltrados.length === 0 ? (
        <div className="bg-superficie rounded-2xl border border-borde p-8 text-center space-y-2">
          <div className="w-12 h-12 bg-superficie-2 text-texto-suave rounded-full flex items-center justify-center mx-auto text-xl">
            🍽️
          </div>
          <p className="text-texto font-etiqueta uppercase font-bold text-base">
            No hay platos en esta categoría
          </p>
          <p className="text-texto-suave text-xs mt-1">
            Prueba seleccionando otra categoría o la opción &ldquo;Todas&rdquo;.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {platosFiltrados.map((plato) => (
            <PlatoCard
              key={plato.id}
              plato={plato}
              onSeleccionar={(p) => setIdPlatoSeleccionado(p.id)}
            />
          ))}
        </div>
      )}

      {/* Modal de detalle del plato */}
      <PlatoDetalleModal
        key={idPlatoSeleccionado ?? 'ninguno'}
        plato={platoSeleccionado}
        abierto={idPlatoSeleccionado !== null && platoSeleccionado !== null}
        onCerrar={() => setIdPlatoSeleccionado(null)}
        onAgregar={manejarAgregar}
      />

      {/* Feedback visual accesible (toast temporal) */}
      {toastMensaje && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-exito text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 max-w-[90vw]"
        >
          <span className="text-white font-bold" aria-hidden="true">
            ✓
          </span>
          <span className="truncate">{toastMensaje}</span>
        </div>
      )}
    </div>
  );
}

export default Menu;
