import { useState, useEffect } from 'react';
import { obtenerCategorias, obtenerPlatos } from '../services/menuService';

function Menu() {
  const [categorias, setCategorias] = useState([]);
  const [platos, setPlatos] = useState([]);
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
      <h1 className="text-xl font-bold text-gray-900">Menú Digital</h1>
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm space-y-2">
        <p className="text-sm text-gray-700">
          <strong className="text-gray-900">Categorías cargadas:</strong> {categorias.length}
        </p>
        <p className="text-sm text-gray-700">
          <strong className="text-gray-900">Platos cargados:</strong> {platos.length}
        </p>
      </div>
      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Lista de platos (texto):</h2>
        <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
          {platos.map((p) => (
            <li key={p.id}>
              {p.nombre} - ${p.precio.toLocaleString('es-CO')}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default Menu;
