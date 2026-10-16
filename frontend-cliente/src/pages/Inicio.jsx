import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';
import { validarNombre } from '../utils/sesion';
import { leerMesaDelQr } from '../utils/qr';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

const FOTO_PORTADA_INICIO =
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=1200&q=80&auto=format';

function Inicio() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const {
    sesion,
    estado,
    error,
    enviando,
    recienUnido,
    tokenQrPendiente,
    unirse,
    limpiarError,
  } = useSesion();
  const [nombre, setNombre] = useState('');
  const [tocado, setTocado] = useState(false);
  const [cuentaRegresiva, setCuentaRegresiva] = useState(() =>
    error?.status === 429 ? error.retryAfter || 60 : 0
  );

  const tokenUrl =
    tokenQrPendiente ||
    (typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('token')
      : null);
  const numeroMesaQr = leerMesaDelQr(tokenUrl);

  const validacion = validarNombre(nombre);
  const esErrorQr401 = error?.status === 401;
  const esErrorRateLimit429 = error?.status === 429 || cuentaRegresiva > 0;
  const esErrorAlias409 =
    error?.status === 409 || error?.motivo === 'alias_en_uso';
  const esErrorCampo400 = error?.status === 400;
  const esErrorServicio503 =
    error?.status === 503 ||
    error?.status === 0 ||
    error?.motivo === 'sin_conexion';

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
    <div className="relative min-h-screen bg-fondo text-texto flex flex-col justify-between overflow-hidden">
      {/* Imagen de fondo con degradado oscuro a #0B0B0B */}
      <div className="absolute inset-0 pointer-events-none z-0">
        <img
          src={FOTO_PORTADA_INICIO}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-fondo/60 via-fondo/80 to-fondo" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-auto p-4 flex flex-col min-h-screen justify-between">
        {/* Cabecera superior izquierda: logo SD + SMARTDINING */}
        <header className="pt-2">
          <div className="flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-lg bg-primario flex items-center justify-center text-white font-etiqueta font-bold text-lg tracking-wider shadow-md"
              aria-hidden="true"
            >
              SD
            </div>
            <span className="font-etiqueta font-bold text-lg text-white tracking-widest uppercase">
              SMARTDINING
            </span>
          </div>
        </header>

        {/* Centro de la pantalla: ESTÁS EN LA / MESA N o ¡BIENVENIDO! */}
        <div className="my-auto py-8 text-center select-none">
          {numeroMesaQr !== null ? (
            <div className="space-y-1">
              <p className="font-etiqueta uppercase text-sm sm:text-base font-bold text-white tracking-widest">
                ESTÁS EN LA
              </p>
              <h1 className="font-titulo text-6xl sm:text-7xl text-primario tracking-wider uppercase leading-none drop-shadow-md">
                MESA {numeroMesaQr}
              </h1>
            </div>
          ) : (
            <h1 className="font-titulo text-6xl sm:text-7xl text-primario tracking-wider uppercase leading-none drop-shadow-md">
              ¡BIENVENIDO!
            </h1>
          )}
        </div>

        {/* Tarjeta inferior con el formulario o estados */}
        <div className="pb-4">
          <Card className="w-full p-5 sm:p-6 shadow-2xl border border-borde bg-superficie rounded-2xl">
            {estado === 'cargando' && (
              <div className="py-8 text-center" role="status" aria-live="polite">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-primario border-t-transparent mb-3" />
                <p className="font-etiqueta uppercase tracking-wide text-base text-texto">
                  Verificando mesa...
                </p>
              </div>
            )}

            {estado === 'pide_nombre' && esErrorQr401 && (
              <div role="alert" aria-live="polite" className="text-center space-y-4 py-2">
                <div
                  aria-hidden="true"
                  className="w-14 h-14 bg-primario/15 text-primario-texto border border-primario/30 rounded-full flex items-center justify-center mx-auto text-2xl font-bold"
                >
                  ✕
                </div>
                <div className="space-y-1.5">
                  <h2 className="font-titulo text-3xl text-white uppercase tracking-wide">
                    Este QR ya no es válido
                  </h2>
                  <p className="text-sm font-semibold text-primario-texto">
                    {error.mensaje}
                  </p>
                  <p className="text-xs text-texto-suave">
                    Pídele al mesero el QR actual de la mesa
                  </p>
                </div>
              </div>
            )}

            {estado === 'pide_nombre' && !esErrorQr401 && (
              <form onSubmit={manejarSubmit} className="space-y-4" noValidate>
                <div className="space-y-1">
                  <h2 className="font-titulo text-3xl sm:text-4xl text-white tracking-wide uppercase leading-tight">
                    {numeroMesaQr !== null ? '¡BIENVENIDO!' : 'ÚNETE A LA MESA'}
                  </h2>
                  <p className="text-xs sm:text-sm text-texto-suave font-cuerpo leading-relaxed">
                    Escribe tu nombre para que la cocina sepa de quién es cada plato.
                  </p>
                </div>

                <div className="text-left space-y-1.5">
                  <label
                    htmlFor="nombre-comensal"
                    className="block text-xs font-etiqueta uppercase tracking-wider font-bold text-texto"
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
                    placeholder="Ej: Ana, David…"
                    aria-invalid={
                      Boolean((tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409)
                    }
                    className={`w-full min-h-12 text-base text-texto placeholder:text-texto-tenue bg-superficie-2 border rounded-xl px-4 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto ${
                      (tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409
                        ? 'border-primario-texto bg-primario/5'
                        : 'border-borde hover:border-borde/80'
                    }`}
                  />

                  {tocado && !validacion.valido && !error && (
                    <p
                      role="alert"
                      className="text-xs font-semibold text-primario-texto mt-1"
                    >
                      {validacion.error}
                    </p>
                  )}

                  {esErrorCampo400 && (
                    <div
                      role="alert"
                      aria-live="polite"
                      className="mt-1.5 space-y-0.5 text-primario-texto"
                    >
                      <p className="text-xs font-bold">{error.mensaje}</p>
                      <p className="text-xs text-texto-suave">
                        Usa entre 2 y 40 caracteres (letras, números y espacios).
                      </p>
                    </div>
                  )}

                  {esErrorAlias409 && (
                    <div
                      role="alert"
                      aria-live="polite"
                      className="mt-2 rounded-xl bg-primario/10 border border-primario/30 p-3 space-y-1"
                    >
                      <p className="text-xs font-bold text-primario-texto">
                        {error.mensaje}
                      </p>
                      <p className="text-xs text-texto-suave">
                        Prueba con otro nombre o agrega una inicial
                      </p>
                    </div>
                  )}
                </div>

                {esErrorServicio503 && !esErrorRateLimit429 && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-xl bg-primario/10 border border-primario/30 p-3.5 text-left space-y-2.5"
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-primario-texto">
                        {error.mensaje}
                      </p>
                      <p className="text-xs text-texto-suave">
                        Verifica tu conexión o intenta de nuevo en unos segundos.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variante="secundario"
                      disabled={!validacion.valido || enviando}
                      onClick={manejarReintentar}
                      className="w-full min-h-10 text-xs"
                    >
                      REINTENTAR
                    </Button>
                  </div>
                )}

                {esErrorRateLimit429 && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-xl bg-superficie-2 border border-borde p-3.5 text-left space-y-1.5"
                  >
                    <p className="text-xs font-etiqueta uppercase tracking-wider font-bold text-primario-texto">
                      Demasiados intentos
                    </p>
                    <p className="text-xs text-texto-suave">
                      {error.mensaje || 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.'}
                    </p>
                    {cuentaRegresiva > 0 && (
                      <p className="text-xs font-semibold text-primario-texto">
                        Podrás volver a intentar en {cuentaRegresiva} segundos.
                      </p>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  variante="primario"
                  disabled={!validacion.valido || enviando || cuentaRegresiva > 0}
                  className="w-full mt-2"
                >
                  {enviando
                    ? 'ENTRANDO...'
                    : cuentaRegresiva > 0
                      ? `ESPERA ${cuentaRegresiva}S`
                      : 'ENTRAR A LA MESA'}
                </Button>
              </form>
            )}

            {estado === 'activa' && sesion && (
              <div className="space-y-4 text-center py-2">
                <div
                  aria-hidden="true"
                  className="w-14 h-14 bg-texto text-fondo rounded-full flex items-center justify-center mx-auto text-2xl font-bold shadow-md"
                >
                  ✓
                </div>
                <div className="space-y-1">
                  <h2 className="font-titulo text-3xl text-white uppercase tracking-wide">
                    {recienUnido
                      ? `MESA ${sesion.numeroMesa} · ¡HOLA, ${sesion.comensal}!`
                      : `YA ESTÁS EN LA MESA ${sesion.numeroMesa}`}
                  </h2>
                  <p className="text-xs text-texto-suave">
                    {recienUnido
                      ? 'Tu sesión está activa. Ya puedes revisar el menú y armar tu pedido.'
                      : `Conectado como ${sesion.comensal}. Continúa eligiendo tus platos.`}
                  </p>
                </div>
                <Button
                  variante="primario"
                  onClick={() => navigate('/menu')}
                  className="w-full"
                >
                  VER EL MENÚ
                </Button>
              </div>
            )}

            {estado === 'sin_sesion' && (
              <div className="space-y-3 text-center py-2">
                <div
                  aria-hidden="true"
                  className="w-14 h-14 bg-superficie-2 text-primario-texto border border-borde rounded-full flex items-center justify-center mx-auto text-xl font-bold"
                >
                  QR
                </div>
                <div className="space-y-1">
                  <h2 className="font-titulo text-3xl text-white uppercase tracking-wide">
                    Escanea el código QR
                  </h2>
                  <p className="text-xs text-texto-suave">
                    Usa la cámara de tu celular para escanear el código ubicado en tu mesa y unirte al pedido.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default Inicio;
