import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMesaSession } from '../hooks/useMesaSession';
import { obtenerApodo, guardarApodo } from '../utils/apodo';

function Inicio() {
  const navigate = useNavigate();
  const { mesa, valida, cargando } = useMesaSession();
  const [apodo, setApodo] = useState(() => obtenerApodo());

  const manejarContinuar = () => {
    const apodoLimpio = guardarApodo(apodo);
    if (apodoLimpio) {
      navigate('/menu');
    }
  };

  return (
    <div className="min-h-screen bg-blue-500 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
        {cargando && (
          <div className="py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent mb-4"></div>
            <p className="text-xl font-medium text-gray-700">Verificando mesa...</p>
          </div>
        )}

        {!cargando && valida && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✓
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Bienvenido a la Mesa {mesa}
              </h1>
              <p className="text-gray-600 mt-2">
                Tu sesión ha sido verificada con éxito. Ya puedes consultar nuestro menú y ordenar.
              </p>
            </div>

            {/* Input de Apodo */}
            <div className="text-left space-y-1.5">
              <label
                htmlFor="apodo-comensal"
                className="block text-sm font-bold text-gray-900"
              >
                ¿Cómo te llamas?
              </label>
              <p className="text-xs text-gray-500">
                Así la cocina sabrá de quién es cada plato
              </p>
              <input
                id="apodo-comensal"
                type="text"
                value={apodo}
                onChange={(e) => setApodo(e.target.value)}
                maxLength={40}
                autoComplete="nickname"
                placeholder="Ej: David, Caro..."
                className="w-full text-base border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              />
            </div>

            <button
              onClick={manejarContinuar}
              disabled={!apodo.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors duration-200 shadow-md cursor-pointer disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed disabled:shadow-none"
            >
              Ver menú
            </button>
          </div>
        )}

        {!cargando && !valida && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✕
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Código QR no válido o expirado
              </h1>
              <p className="text-gray-600 mt-2">
                No pudimos autenticar la mesa. Por favor, escanea nuevamente el código QR ubicado en tu mesa o solicita asistencia a un mesero.
              </p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
              ¿Problemas con el código? Acércate al personal del restaurante para asignarte una mesa manualmente.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Inicio;
