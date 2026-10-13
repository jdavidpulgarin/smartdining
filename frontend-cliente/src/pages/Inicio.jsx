import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';
import { validarNombre } from '../utils/sesion';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

function Inicio() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
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
  const [cuentaRegresiva, setCuentaRegresiva] = useState(() =>
    error?.status === 429 ? (error.retryAfter || 60) : 0
  );

  const validacion = validarNombre(nombre);
  const esErrorQr401 = error?.status === 401;
  const esErrorRateLimit429 = error?.status === 429 || cuentaRegresiva > 0;
  const esErrorAlias409 =
    error?.status === 409 || error?.motivo === 'alias_en_uso';
  const esErrorCampo400 = error?.status === 400;
  const esErrorServicio503 =
    error?.status === 503 || error?.status === 0 || error?.motivo === 'sin_conexion';

  useEffect(() => {
    if (cuentaRegresiva <= 0) return;
    const timer = setInterval(() => {
      setCuentaRegresiva((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cuentaRegresiva]);

  useEffect(() => {
    if (esErrorAlias409 && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [esErrorAlias409, error]);

  const manejarSubmit = async (e) => {
    e.preventDefault();
    setTocado(true);
    if (!validacion.valido || enviando || cuentaRegresiva > 0) return;
    const res = await unirse(nombre);
    if (res && !res.ok && res.error?.status === 429) {
      setCuentaRegresiva(res.error.retryAfter || 60);
    }
  };

  const manejarReintentar = async () => {
    if (!validacion.valido || enviando || cuentaRegresiva > 0) return;
    const res = await unirse(nombre);
    if (res && !res.ok && res.error?.status === 429) {
      setCuentaRegresiva(res.error.retryAfter || 60);
    }
  };

  return (
    <div className="min-h-screen bg-crema text-cafe flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center shadow-xl">
        {estado === 'cargando' && (
          <div className="py-8" role="status" aria-live="polite">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-primary border-t-transparent mb-4" />
            <p className="text-xl font-medium text-cafe">Verificando mesa...</p>
          </div>
        )}

        {estado === 'pide_nombre' && esErrorQr401 && (
          <div role="alert" aria-live="polite" className="space-y-6">
            <div
              aria-hidden="true"
              className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto text-3xl font-bold"
            >
              ✕
            </div>
            <div className="space-y-2">
              <h1 className="font-titulo text-2xl font-bold text-cafe">
                Este QR ya no es válido
              </h1>
              <p className="text-sm font-semibold text-primary">
                {error.mensaje}
              </p>
              <p className="text-sm text-cafe">
                Pídele al mesero el QR actual de la mesa
              </p>
            </div>
          </div>
        )}

        {estado === 'pide_nombre' && !esErrorQr401 && (
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
                ref={inputRef}
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
                aria-invalid={
                  Boolean((tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409)
                }
                className={`w-full min-h-12 text-base text-cafe placeholder:text-gray-500 border rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors ${
                  (tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-300 bg-white'
                }`}
              />

              {tocado && !validacion.valido && !error && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-primary mt-1"
                >
                  {validacion.error}
                </p>
              )}

              {esErrorCampo400 && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mt-1.5 space-y-0.5 text-primary"
                >
                  <p className="text-xs font-bold">{error.mensaje}</p>
                  <p className="text-xs text-cafe">
                    Usa entre 2 y 40 caracteres (letras, números y espacios).
                  </p>
                </div>
              )}

              {esErrorAlias409 && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mt-2 rounded-xl bg-primary/10 border border-primary/25 p-3 space-y-1"
                >
                  <p className="text-xs font-bold text-primary">
                    {error.mensaje}
                  </p>
                  <p className="text-xs text-cafe">
                    Prueba con otro nombre o agrega una inicial
                  </p>
                </div>
              )}
            </div>

            {esErrorServicio503 && !esErrorRateLimit429 && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-xl bg-primary/10 border border-primary/25 p-4 text-left space-y-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-bold text-primary">
                    {error.mensaje}
                  </p>
                  <p className="text-xs text-cafe">
                    Verifica tu conexión o intenta de nuevo en unos segundos.
                  </p>
                </div>
                <Button
                  type="button"
                  variante="secundario"
                  disabled={!validacion.valido || enviando}
                  onClick={manejarReintentar}
                  className="w-full"
                >
                  Reintentar
                </Button>
              </div>
            )}

            {esErrorRateLimit429 && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-xl bg-primary/10 border border-primary/25 p-4 text-left space-y-2"
              >
                <div className="flex items-center gap-2 text-primary font-bold text-sm">
                  <span>⏱️</span>
                  <span>Demasiados intentos</span>
                </div>
                <p className="text-xs text-cafe">
                  {error.mensaje || 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.'}
                </p>
                {cuentaRegresiva > 0 && (
                  <p className="text-xs font-semibold text-primary">
                    Podrás volver a intentar en {cuentaRegresiva} segundos.
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              variante="primario"
              disabled={!validacion.valido || enviando || cuentaRegresiva > 0}
              className="w-full py-3 px-6 text-base shadow-md"
            >
              {enviando
                ? 'Entrando...'
                : cuentaRegresiva > 0
                  ? `Espera ${cuentaRegresiva}s para reintentar`
                  : 'Entrar a la mesa'}
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
