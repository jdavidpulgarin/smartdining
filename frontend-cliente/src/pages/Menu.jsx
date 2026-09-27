import { useState, useEffect, useRef } from 'react';
import { obtenerCategorias, obtenerPlatos } from '../services/menuService';
import CategoriaFiltro from '../components/menu/CategoriaFiltro';
import PlatoCard from '../components/menu/PlatoCard';
import PlatoDetalleModal from '../components/menu/PlatoDetalleModal';
import { useCarrito } from '../context/CarritoContext';
import { obtenerApodo } from '../utils/apodo';
import { generarIdLinea } from '../utils/id';

function Menu() {
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null);
  const [platoSeleccionado, setPlatoSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(true);
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

  useEffect(() => {
    async function cargarDatos() {
      try {
        const [cats, plats] = await Promise.all([
          obtenerCategorias(),
          obtenerPlatos(),
        ]);
        setCategorias(cats);
        setPlatos(plats);
      } catch (error) {
        console.error('Error al cargar datos del menú:', error);
      } finally {
        setCargando(false);
      }
    }

    cargarDatos();
  }, []);

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
      <div className="flex flex-col items-center justify-center py-16">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-3"></div>
        <p className="text-gray-500 text-sm font-medium">Cargando menú...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      {/* Filtro horizontal de categorías */}
      <CategoriaFiltro
        categorias={categorias}
        categoriaSeleccionada={categoriaSeleccionada}
        onSeleccionar={setCategoriaSeleccionada}
      />

      {/* Grid de platos o mensaje de estado vacío */}
      {platosFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-3 text-xl">
            🍽️
          </div>
          <p className="text-gray-600 font-medium text-sm">
            No hay platos en esta categoría
          </p>
          <p className="text-gray-400 text-xs mt-1">
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
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 max-w-[90vw]"
        >
          <span className="text-green-400 font-bold" aria-hidden="true">
            ✓
          </span>
          <span className="truncate">{toastMensaje}</span>
        </div>
      )}
    </div>
  );
}

export default Menu;
