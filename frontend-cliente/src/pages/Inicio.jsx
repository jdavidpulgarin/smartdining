import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMesaSession } from '../hooks/useMesaSession';
import { obtenerApodo, guardarApodo } from '../utils/apodo';
import Button from '../components/ui/Button';

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
    <div className="min-h-screen bg-crema text-cafe flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
        {cargando && (
          <div className="py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent mb-4"></div>
            <p className="text-xl font-medium text-cafe">Verificando mesa...</p>
          </div>
        )}

        {!cargando && valida && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-verde text-white rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✓
            </div>
            <div>
              <h1 className="text-2xl font-bold text-cafe">
                Bienvenido a la Mesa {mesa}
              </h1>
              <p className="text-cafe mt-2">
                Tu sesión ha sido verificada con éxito. Ya puedes consultar nuestro menú y ordenar.
              </p>
            </div>

            {/* Input de Apodo */}
            <div className="text-left space-y-1.5">
              <label
                htmlFor="apodo-comensal"
                className="block text-sm font-bold text-cafe"
              >
                ¿Cómo te llamas?
              </label>
              <p className="text-xs text-gray-600">
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
                className="w-full min-h-12 text-base text-cafe placeholder:text-gray-600 border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
              />
            </div>

            <Button
              variante="primario"
              onClick={manejarContinuar}
              disabled={!apodo.trim()}
              className="w-full py-3 px-6 text-base shadow-md"
            >
              Ver menú
            </Button>
          </div>
        )}

        {!cargando && !valida && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✕
            </div>
            <div>
              <h1 className="text-2xl font-bold text-cafe">
                Código QR no válido o expirado
              </h1>
              <p className="text-cafe mt-2">
                No pudimos autenticar la mesa. Por favor, escanea nuevamente el código QR ubicado en tu mesa o solicita asistencia a un mesero.
              </p>
            </div>
            <div className="bg-crema border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
              ¿Problemas con el código? Acércate al personal del restaurante para asignarte una mesa manualmente.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Inicio;
