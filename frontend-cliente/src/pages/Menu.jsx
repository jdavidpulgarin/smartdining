import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  obtenerCategorias,
  obtenerPlatos,
  obtenerPlatosArmables,
  recargarMenu,
} from '../services/menuService';
import CategoriaFiltro from '../components/menu/CategoriaFiltro';
import PlatoCard from '../components/menu/PlatoCard';
import PlatoDetalleModal from '../components/menu/PlatoDetalleModal';
import Card from '../components/ui/Card';
import Imagen from '../components/ui/Imagen';
import Button from '../components/ui/Button';
import { useCarrito } from '../context/CarritoContext';
import { obtenerApodo } from '../utils/apodo';
import { generarIdLinea } from '../utils/id';
import { formatearPrecio } from '../utils/formato';

function Menu() {
  const navigate = useNavigate();
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [platosArmables, setPlatosArmables] = useState([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null);
  const [platoSeleccionado, setPlatoSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorMenu, setErrorMenu] = useState(null);
  const [toastMensaje, setToastMensaje] = useState(null);
  const toastTimeoutRef = useRef(null);

  const { agregarLinea } = useCarrito();

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

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

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
    setPlatoSeleccionado(null);

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
        {/* Arma tu plato esqueleto */}
        <div className="space-y-2.5">
          <div className="h-6 bg-gray-200 rounded w-36" />
          <div className="flex gap-3 overflow-x-auto pb-2">
            {[1, 2, 3].map((item) => (
              <Card key={item} className="w-64 shrink-0 space-y-3">
                <div className="w-full aspect-4/3 rounded-xl bg-gray-200" />
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-10 bg-gray-200 rounded-xl w-full" />
              </Card>
            ))}
          </div>
        </div>

        {/* Categorías esqueleto */}
        <div className="flex gap-2 overflow-x-auto py-1">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-9 w-24 bg-gray-200 rounded-full shrink-0"
            />
          ))}
        </div>

        {/* Platos normales esqueleto */}
        <div className="grid grid-cols-1 gap-3">
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="bg-white rounded-xl shadow-sm border border-gray-100 flex gap-3 p-3"
            >
              <div className="w-24 h-24 shrink-0 rounded-lg bg-gray-200" />
              <div className="flex flex-col justify-between flex-1 py-1 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-2/3" />
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-4 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (errorMenu) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm space-y-4 my-8">
        <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto text-xl font-bold">
          !
        </div>
        <div>
          <h2 className="font-titulo text-lg font-bold text-cafe">
            No pudimos cargar el menú
          </h2>
          <p className="text-sm text-gray-600 mt-1">{errorMenu}</p>
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
    <div className="space-y-4 pb-6">
      {/* Sección Arma tu plato */}
      {platosArmables.length > 0 && (
        <section aria-labelledby="titulo-arma-tu-plato" className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h2
              id="titulo-arma-tu-plato"
              className="font-titulo text-xl font-bold text-cafe tracking-tight"
            >
              Arma tu plato
            </h2>
            <span className="text-xs text-gray-600">Paso a paso a tu gusto</span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory">
            {platosArmables.map((plato) => (
              <Card
                key={plato.id_plato}
                className="w-64 shrink-0 snap-start flex flex-col justify-between gap-3"
              >
                <div className="space-y-2">
                  <Imagen
                    src={plato.url_imagen}
                    alt={plato.nombre}
                    aspecto="4/3"
                    className="w-full rounded-xl"
                  />
                  <div>
                    <h3 className="font-titulo text-base font-bold text-cafe leading-snug">
                      {plato.nombre}
                    </h3>
                    {plato.descripcion && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2 leading-relaxed">
                        {plato.descripcion}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2.5 pt-1 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-primary text-sm">
                      Desde {formatearPrecio(plato.precio)}
                    </span>
                    {plato.calorias != null && (
                      <span className="text-gray-600 font-medium">
                        ≈ {plato.calorias} kcal
                      </span>
                    )}
                  </div>
                  <Button
                    variante="primario"
                    className="w-full"
                    onClick={() => navigate(`/armar/${plato.id_plato}`)}
                  >
                    Armar mi plato
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
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-gray-100 text-gray-600 rounded-full flex items-center justify-center mx-auto text-xl">
            🍽️
          </div>
          <p className="text-cafe font-medium text-sm">
            No hay platos en esta categoría
          </p>
          <p className="text-gray-600 text-xs mt-1">
            Prueba seleccionando otra categoría o la opción "Todas".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {platosFiltrados.map((plato) => (
            <PlatoCard
              key={plato.id}
              plato={plato}
              onSeleccionar={setPlatoSeleccionado}
            />
          ))}
        </div>
      )}

      {/* Modal de detalle del plato */}
      <PlatoDetalleModal
        key={platoSeleccionado?.id ?? 'ninguno'}
        plato={platoSeleccionado}
        abierto={platoSeleccionado !== null}
        onCerrar={() => setPlatoSeleccionado(null)}
        onAgregar={manejarAgregar}
      />

      {/* Feedback visual accesible (toast temporal) */}
      {toastMensaje && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-verde text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 max-w-[90vw]"
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
