import { useState, useEffect } from 'react';
import { obtenerCategorias, obtenerPlatos } from '../services/menuService';
import CategoriaFiltro from '../components/menu/CategoriaFiltro';

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
      <div className="flex flex-col items-center justify-center py-12">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-3"></div>
        <p className="text-gray-500 text-sm">Cargando menú...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtro horizontal por categoría */}
      <CategoriaFiltro
        categorias={categorias}
        categoriaSeleccionada={categoriaSeleccionada}
        onSeleccionar={setCategoriaSeleccionada}
      />

      {/* Lista de platos filtrados (en texto plano) */}
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">
          Platos filtrados ({platosFiltrados.length}):
        </h2>
        {platosFiltrados.length === 0 ? (
          <p className="text-xs text-gray-500 italic">
            No hay platos en esta categoría.
          </p>
        ) : (
          <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
            {platosFiltrados.map((p) => (
              <li key={p.id}>
                {p.nombre} - ${p.precio.toLocaleString('es-CO')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default Menu;
