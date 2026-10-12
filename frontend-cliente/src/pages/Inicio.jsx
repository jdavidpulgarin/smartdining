import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';
import { validarNombre } from '../utils/sesion';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

function Inicio() {
  const navigate = useNavigate();
  const {
    sesion,
    estado,
    error,
    enviando,
    recienUnido,
    unirse,
    limpiarError,
  } = useSesion();
  const [nombre, setNombre] = useState('');
  const [tocado, setTocado] = useState(false);

  const validacion = validarNombre(nombre);

  const manejarSubmit = async (e) => {
    e.preventDefault();
    setTocado(true);
    if (!validacion.valido || enviando) return;
    await unirse(nombre);
  };

  return (
    <div className="min-h-screen bg-crema text-cafe flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center shadow-xl">
        {estado === 'cargando' && (
          <div className="py-8">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent mb-4" />
            <p className="text-xl font-medium text-cafe">Verificando mesa...</p>
          </div>
        )}

        {estado === 'pide_nombre' && (
          <form onSubmit={manejarSubmit} className="space-y-6" noValidate>
            <div>
              <h1 className="font-titulo text-2xl font-bold text-cafe">
                ¡Bienvenido!
              </h1>
              <p className="text-sm text-cafe mt-2">
                Escribe tu nombre para que la cocina sepa de quién es cada plato
              </p>
            </div>

            <div className="text-left space-y-1.5">
              <label
                htmlFor="nombre-comensal"
                className="block text-sm font-bold text-cafe"
              >
                ¿Cómo te llamas?
              </label>
              <input
                id="nombre-comensal"
                type="text"
                value={nombre}
                onChange={(e) => {
                  setNombre(e.target.value);
                  if (error) limpiarError();
                }}
                onBlur={() => setTocado(true)}
                maxLength={40}
                autoComplete="nickname"
                placeholder="Ej: Ana, David..."
                className="w-full min-h-12 text-base text-cafe placeholder:text-gray-500 border border-gray-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors"
              />
              {tocado && !validacion.valido && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-primary mt-1"
                >
                  {validacion.error}
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-primary mt-1"
                >
                  {error.mensaje}
                </p>
              )}
            </div>

            <Button
              type="submit"
              variante="primario"
              disabled={!validacion.valido || enviando}
              className="w-full py-3 px-6 text-base shadow-md"
            >
              {enviando ? 'Entrando...' : 'Entrar a la mesa'}
            </Button>
          </form>
        )}

        {estado === 'activa' && sesion && recienUnido && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-verde text-white rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✓
            </div>
            <div>
              <h1 className="font-titulo text-2xl font-bold text-cafe">
                Mesa {sesion.numeroMesa} · ¡Bienvenido, {sesion.comensal}!
              </h1>
              <p className="text-sm text-cafe mt-2">
                Tu sesión está activa. Ya puedes revisar el menú y armar tu
                pedido.
              </p>
            </div>
            <Button
              variante="primario"
              onClick={() => navigate('/menu')}
              className="w-full py-3 px-6 text-base shadow-md"
            >
              Ver el menú
            </Button>
          </div>
        )}

        {estado === 'activa' && sesion && !recienUnido && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-verde text-white rounded-full flex items-center justify-center mx-auto text-3xl font-bold">
              ✓
            </div>
            <div>
              <h1 className="font-titulo text-2xl font-bold text-cafe">
                Ya estás en la Mesa {sesion.numeroMesa} como {sesion.comensal}
              </h1>
              <p className="text-sm text-cafe mt-2">
                Continúa eligiendo tus platos o revisando el pedido de la mesa.
              </p>
            </div>
            <Button
              variante="primario"
              onClick={() => navigate('/menu')}
              className="w-full py-3 px-6 text-base shadow-md"
            >
              Ver el menú
            </Button>
          </div>
        )}

        {estado === 'sin_sesion' && (
          <div className="space-y-6">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
              QR
            </div>
            <div>
              <h1 className="font-titulo text-2xl font-bold text-cafe">
                Escanea el código QR de tu mesa para empezar
              </h1>
              <p className="text-sm text-gray-600 mt-2">
                Usa la cámara de tu celular para escanear el código ubicado en tu
                mesa y unirte al pedido.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export default Inicio;
