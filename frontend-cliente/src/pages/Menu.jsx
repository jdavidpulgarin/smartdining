import { useState, useEffect } from 'react';
import { obtenerCategorias, obtenerPlatos } from '../services/menuService';
import CategoriaFiltro from '../components/menu/CategoriaFiltro';
import PlatoCard from '../components/menu/PlatoCard';

function Menu() {
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState(null);
  const [cargando, setCargando] = useState(true);

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
            <PlatoCard key={plato.id} plato={plato} />
          ))}
        </div>
      )}
    </div>
  );
}

export default Menu;
