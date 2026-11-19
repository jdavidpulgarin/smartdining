import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';
import {
  validarNombre,
  decidirDestinoInicio,
  tienePedidosActivosGuardados,
  obtenerSesionCerrada,
  nombreSugerido,
} from '../utils/sesion';
import { leerMesaDelQr } from '../utils/qr';
import { aliasDelToken } from '../services/clienteMesa';

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
    cerrarSesion,
    limpiarError,
  } = useSesion();

  const jwtDevUrl =
    import.meta.env.DEV && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('jwt_dev')
      : null;
  const aliasDevUrl = jwtDevUrl ? aliasDelToken(jwtDevUrl) : null;

  const [nombre, setNombre] = useState(() => aliasDevUrl || '');
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

  const tienePedidos = useMemo(() => {
    if (!sesion?.token || !sesion?.idMesa) return false;
    return tienePedidosActivosGuardados(
      sesion.comensal,
      sesion.idMesa,
      sesion.token
    );
  }, [sesion]);

  const [sesionExistiaAlMontar] = useState(() => Boolean(sesion?.token && sesion?.idMesa));

  const destino = useMemo(
    () =>
      decidirDestinoInicio({
        tokenUrl,
        sesion,
        tienePedidosActivos: tienePedidos,
        recienUnido: Boolean(recienUnido || !sesionExistiaAlMontar),
      }),
    [tokenUrl, sesion, tienePedidos, recienUnido, sesionExistiaAlMontar]
  );

  useEffect(() => {
    if (destino.accion === 'redirigir' && destino.ruta) {
      navigate(destino.ruta, { replace: true });
    }
  }, [destino, navigate]);

  useEffect(() => {
    if (import.meta.env.DEV && aliasDevUrl && estado === 'pide_nombre' && !enviando) {
      unirse(aliasDevUrl);
    }
  }, [aliasDevUrl, estado, enviando, unirse]);

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

  const aliasSesionCerrada = useMemo(
    () => (esErrorAlias409 ? obtenerSesionCerrada() : null),
    [esErrorAlias409]
  );

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
    if (res && !res.ok) {
      if (res.error?.status === 429) {
        setCuentaRegresiva(res.error.retryAfter || 60);
      } else if (res.error?.status === 409 || res.error?.motivo === 'alias_en_uso') {
        const aliasCerrado = obtenerSesionCerrada();
        if (aliasCerrado) {
          setNombre(nombreSugerido(nombre || aliasCerrado));
        }
      }
    }
  };

  const manejarReintentar = async () => {
    if (!validacion.valido || enviando || cuentaRegresiva > 0) return;
    const res = await unirse(nombre);
    if (res && !res.ok) {
      if (res.error?.status === 429) {
        setCuentaRegresiva(res.error.retryAfter || 60);
      } else if (res.error?.status === 409 || res.error?.motivo === 'alias_en_uso') {
        const aliasCerrado = obtenerSesionCerrada();
        if (aliasCerrado) {
          setNombre(nombreSugerido(nombre || aliasCerrado));
        }
      }
    }
  };

  const esVistaActiva =
    (destino.accion !== 'redirigir' &&
      destino.accion !== 'confirmar_reutilizar' &&
      estado === 'activa' &&
      Boolean(sesion)) ||
    (destino.accion === 'confirmar_reutilizar' && Boolean(sesion));

  return (
    <div
      className={`relative min-h-screen min-h-svh w-full flex flex-col justify-between overflow-x-hidden ${
        esVistaActiva ? 'fondo-comanda-rojo' : 'fondo-comanda'
      }`}
    >
      <div className="relative z-10 w-full max-w-[480px] mx-auto px-5 pt-[max(18px,env(safe-area-inset-top))] pb-[max(22px,env(safe-area-inset-bottom))] flex flex-col min-h-screen min-h-svh justify-between">
        {/* ==================================================================
            ESTADO DE BIENVENIDA / SESIÓN ACTIVA (Fondo rojo estilo comanda)
            ================================================================== */}
        {esVistaActiva ? (
          <>
            {/* Confeti suave decorativo */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-ambar left-[6%]" style={{ animationDelay: '0s', animationDuration: '5.2s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-papel left-[16%]" style={{ animationDelay: '1.4s', animationDuration: '6s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-carbon left-[27%]" style={{ animationDelay: '0.6s', animationDuration: '5.6s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-ambar left-[38%]" style={{ animationDelay: '2.6s', animationDuration: '6.4s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-papel left-[49%]" style={{ animationDelay: '0.2s', animationDuration: '5.4s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-carbon left-[60%]" style={{ animationDelay: '1.9s', animationDuration: '6.2s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-ambar left-[71%]" style={{ animationDelay: '0.9s', animationDuration: '5.8s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-papel left-[82%]" style={{ animationDelay: '2.2s', animationDuration: '5.3s' }} />
              <i className="anim-cae absolute -top-4 w-2 h-3.5 rounded-sm bg-carbon left-[92%]" style={{ animationDelay: '0.4s', animationDuration: '6.1s' }} />
            </div>

            {/* Cabecera: pastilla crema con SD */}
            <header className="anim-sube self-start inline-flex items-center gap-2.5 bg-papel p-1.5 pr-4 rounded-full shadow-[0_8px_16px_-8px_rgba(0,0,0,0.5)]">
              <div className="w-9 h-9 rounded-full bg-carbon text-ambar grid place-items-center font-titulo text-xl tracking-[0.04em]">
                SD
              </div>
              <b className="font-titulo text-[23px] tracking-[0.16em] text-carbon">SMARTDINING</b>
            </header>

            {/* Centro: disco crema con la mascota chef, anillo punteado y visto ámbar */}
            <section className="anim-sube anim-sube-d1 flex-1 flex items-center justify-center py-4">
              <div className="relative w-48 h-48 rounded-full bg-papel shadow-[0_22px_30px_-16px_rgba(0,0,0,0.6)] flex items-center justify-center">
                <div
                  className="absolute -inset-3 rounded-full border-[3px] border-dashed border-carbon opacity-55 anim-gira"
                  aria-hidden="true"
                />
                <img
                  src="/img/mascota-chef.webp"
                  alt=""
                  aria-hidden="true"
                  width={168}
                  height={168}
                  className="w-40 anim-flota drop-shadow-md"
                />
                <div
                  className="absolute -right-1 bottom-1.5 w-14 h-14 rounded-full bg-ambar border-[5px] border-carbon grid place-items-center anim-pop shadow-md"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="#120c0c" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </div>
              </div>
            </section>

            {/* Comanda inferior */}
            {destino.accion === 'confirmar_reutilizar' ? (
              <section className="ticket-comanda anim-imprime relative mt-auto">
                <div className="banda-comanda">SESIÓN EXISTENTE</div>
                <div className="p-5 sm:p-6 text-center space-y-3">
                  <div className="space-y-1">
                    <h2 className="font-titulo text-3xl text-carbon uppercase tracking-wide">
                      {`YA ESTÁS EN LA MESA ${sesion.numeroMesa || sesion.idMesa}`}
                    </h2>
                    <p className="text-sm font-semibold text-carbon">
                      Conectado como <span className="font-manuscrita text-3xl font-bold text-rojo-tinta">{sesion.comensal}</span>
                    </p>
                    <p className="text-xs text-papel-suave">
                      ¿Deseas continuar con tu sesión o entrar con otro nombre?
                    </p>
                  </div>
                </div>
                <div className="corte-comanda" aria-hidden="true" />
                <div className="p-5 space-y-2">
                  <button
                    type="button"
                    onClick={() =>
                      navigate(tienePedidos ? '/seguimiento' : '/menu', {
                        replace: true,
                      })
                    }
                    className="btn-comanda"
                  >
                    CONTINUAR
                  </button>
                  <button
                    type="button"
                    onClick={() => cerrarSesion()}
                    className="btn-comanda btn-comanda-borde"
                  >
                    ENTRAR CON OTRO NOMBRE
                  </button>
                </div>
              </section>
            ) : (
              <section className="ticket-comanda anim-imprime relative mt-auto">
                <div className="banda-comanda">ORDEN ABIERTA</div>
                <div className="p-5 sm:p-6 text-left relative">
                  <div
                    className="stamp absolute right-4 top-4 border-4 border-double border-rojo-tinta text-rojo-tinta rounded-lg py-1 px-3 text-center font-titulo text-[24px] leading-none tracking-[0.1em] -rotate-9 anim-sello mix-blend-multiply select-none"
                    aria-hidden="true"
                  >
                    SESIÓN<br />ACTIVA
                  </div>
                  <div className="font-titulo text-4xl sm:text-5xl text-carbon leading-none tracking-[0.02em]">
                    ¡HOLA,
                  </div>
                  <div className="font-manuscrita font-bold text-[clamp(48px,16vw,72px)] leading-[0.95] text-rojo-tinta my-1 truncate">
                    {sesion.comensal}
                  </div>
                  <div className="flex gap-2 flex-wrap my-3.5">
                    <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-titulo text-[19px] tracking-[0.1em] bg-carbon text-ambar">
                      MESA {sesion.numeroMesa || sesion.idMesa}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-titulo text-[19px] tracking-[0.1em] border-2 border-carbon text-carbon">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#1FA65A]" aria-hidden="true" />
                      EN LÍNEA
                    </span>
                  </div>
                  <p className="text-base leading-relaxed text-papel-suave">
                    {recienUnido
                      ? 'Tu sesión está activa. Ya puedes revisar el menú y armar tu pedido.'
                      : `Conectado como ${sesion.comensal}. Continúa eligiendo tus platos.`}
                  </p>
                </div>
                <div className="corte-comanda" aria-hidden="true" />
                <div className="p-5">
                  <button
                    type="button"
                    onClick={() => navigate('/menu')}
                    className="btn-comanda"
                  >
                    <span>VER EL MENÚ</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </section>
            )}
          </>
        ) : (
          /* ==================================================================
             FORMULARIO DE NOMBRE Y OTROS ESTADOS (Fondo ámbar estilo comanda)
             ================================================================== */
          <>
            {/* Cabecera: Marca SMARTDINING con cuadrito SD */}
            <header className="anim-sube flex items-center gap-[11px]">
              <div className="w-[42px] h-[42px] rounded-[11px] bg-carbon text-ambar grid place-items-center font-titulo text-[23px] tracking-[0.04em]">
                SD
              </div>
              <b className="font-titulo text-[25px] tracking-[0.16em] text-carbon">
                SMARTDINING
              </b>
            </header>

            {/* Centro: ESTÁS EN LA / MESA N gigante */}
            <section className="anim-sube anim-sube-d1 flex-1 flex flex-col justify-center py-4 sm:py-8">
              {numeroMesaQr !== null ? (
                <>
                  <div className="font-titulo text-[22px] tracking-[0.36em] text-carbon">
                    ESTÁS EN LA
                  </div>
                  <h1
                    className="font-titulo text-[clamp(90px,26vw,140px)] text-carbon leading-[0.84] tracking-[0.01em]"
                    style={{ textShadow: '6px 6px 0 #E5212E' }}
                  >
                    MESA <span>{numeroMesaQr}</span>
                  </h1>
                </>
              ) : (
                <h1
                  className="font-titulo text-[clamp(60px,18vw,90px)] text-carbon leading-[0.84] tracking-[0.01em]"
                  style={{ textShadow: '5px 5px 0 #E5212E' }}
                >
                  ¡BIENVENIDO!
                </h1>
              )}
            </section>

            {/* Comanda inferior según el estado */}
            <main id="contenido-principal" className="w-full">
              {destino.accion === 'redirigir' && (
                <section className="ticket-comanda anim-imprime relative" role="status" aria-live="polite">
                  <div className="banda-comanda">SMARTDINING</div>
                  <div className="p-8 text-center space-y-3">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-carbon border-t-ambar" />
                    <p className="font-titulo text-2xl text-carbon tracking-wider uppercase">
                      Entrando a la mesa...
                    </p>
                  </div>
                </section>
              )}

              {destino.accion !== 'redirigir' && estado === 'cargando' && (
                <section className="ticket-comanda anim-imprime relative" role="status" aria-live="polite">
                  <div className="banda-comanda">SMARTDINING</div>
                  <div className="p-8 text-center space-y-3">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-carbon border-t-ambar" />
                    <p className="font-titulo text-2xl text-carbon tracking-wider uppercase">
                      Verificando mesa...
                    </p>
                  </div>
                </section>
              )}

              {destino.accion !== 'redirigir' && estado === 'pide_nombre' && esErrorQr401 && (
                <section className="ticket-comanda anim-imprime relative" role="alert" aria-live="polite">
                  <div className="banda-comanda">QR NO VÁLIDO</div>
                  <div className="p-6 text-center space-y-3">
                    <div
                      aria-hidden="true"
                      className="w-14 h-14 bg-brasa/15 text-rojo-tinta border border-brasa/30 rounded-full flex items-center justify-center mx-auto text-2xl font-bold"
                    >
                      ✕
                    </div>
                    <div className="space-y-1.5">
                      <h2 className="font-titulo text-3xl text-carbon uppercase tracking-wide">
                        Este QR ya no es válido
                      </h2>
                      <p className="text-sm font-semibold text-rojo-tinta">
                        {error?.mensaje}
                      </p>
                      <p className="text-xs text-papel-suave">
                        Pídele al mesero el QR actual de la mesa
                      </p>
                    </div>
                  </div>
                </section>
              )}

              {destino.accion !== 'redirigir' &&
                destino.accion !== 'confirmar_reutilizar' &&
                (estado === 'pide_nombre' || destino.accion === 'unirse_nueva_mesa') &&
                !esErrorQr401 && (
                <form
                  onSubmit={manejarSubmit}
                  className="ticket-comanda anim-imprime relative mt-12 sm:mt-16"
                  noValidate
                >
                  {/* Mascota flotando sobre la comanda */}
                  <img
                    src="/img/mascota-chef.webp"
                    alt=""
                    aria-hidden="true"
                    width={96}
                    height={96}
                    className="absolute w-24 -top-20 right-1 rotate-[8deg] drop-shadow-[0_12px_10px_rgba(0,0,0,0.35)] anim-flota pointer-events-none"
                  />
                  <div className="banda-comanda">COMANDA</div>

                  <div className="p-5 sm:p-6 text-left">
                    <h2 className="font-titulo text-[36px] sm:text-[40px] text-carbon leading-none tracking-[0.02em]">
                      {numeroMesaQr !== null ? '¡Bienvenido!' : 'Únete a la mesa'}
                    </h2>
                    <p className="my-2 text-[15px] leading-relaxed text-papel-suave">
                      Escribe tu nombre para que la cocina sepa de quién es cada plato.
                    </p>

                    <label
                      htmlFor="nombre-comensal"
                      className="flex justify-between items-baseline font-titulo text-[19px] tracking-[0.14em] text-carbon mt-4"
                    >
                      <span>¿CÓMO TE LLAMAS?</span>
                      <span className="font-cuerpo text-[13px] tracking-normal text-papel-suave font-medium">
                        {nombre.length}/40
                      </span>
                    </label>

                    <div
                      className={`relative border-b-[3px] transition-colors focus-within:border-brasa ${
                        (tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409
                          ? 'border-rojo-tinta'
                          : 'border-carbon'
                      }`}
                    >
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
                        aria-describedby={
                          (tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409
                            ? 'error-nombre'
                            : undefined
                        }
                        aria-invalid={Boolean(
                          (tocado && !validacion.valido) || esErrorCampo400 || esErrorAlias409
                        )}
                        className="w-full h-[62px] bg-transparent border-0 pr-10 pl-0.5 text-carbon font-manuscrita font-bold text-[38px] leading-tight focus:outline-none placeholder:text-[#A8978F] placeholder:font-bold"
                      />
                      <span
                        className={`absolute right-0.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-ambar grid place-items-center transition-transform duration-200 ${
                          validacion.valido && nombre.trim().length >= 2 ? 'scale-100' : 'scale-0'
                        }`}
                        aria-hidden="true"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="#120c0c" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      </span>
                    </div>

                    {tocado && !validacion.valido && !error && (
                      <div id="error-nombre" role="alert" className="flex items-center gap-2 mt-2.5 text-rojo-tinta text-[14.5px] font-semibold">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="w-[18px] h-[18px] shrink-0" aria-hidden="true">
                          <circle cx="12" cy="12" r="9.5" />
                          <path d="M12 7v6M12 16.5v.5" />
                        </svg>
                        <span>{validacion.error}</span>
                      </div>
                    )}

                    {esErrorCampo400 && (
                      <div id="error-nombre" role="alert" aria-live="polite" className="mt-2.5 text-rojo-tinta">
                        <p className="text-sm font-bold">{error?.mensaje}</p>
                        <p className="text-xs text-papel-suave">
                          Usa entre 2 y 40 caracteres (letras, números y espacios).
                        </p>
                      </div>
                    )}

                    {esErrorAlias409 && (
                      <div id="error-nombre" role="alert" aria-live="polite" className="mt-2.5 rounded-xl bg-brasa/10 border border-brasa/30 p-3 space-y-1">
                        {aliasSesionCerrada ? (
                          <p className="text-xs font-bold text-rojo-tinta">
                            {`Tu sesión anterior se cerró. Ese nombre sigue reservado en la mesa; elige otro (por ejemplo, ${nombreSugerido(nombre || aliasSesionCerrada)}).`}
                          </p>
                        ) : (
                          <>
                            <p className="text-xs font-bold text-rojo-tinta">{error?.mensaje}</p>
                            <p className="text-xs text-papel-suave">
                              Prueba con otro nombre o agrega una inicial
                            </p>
                          </>
                        )}
                      </div>
                    )}

                    {esErrorServicio503 && !esErrorRateLimit429 && (
                      <div
                        role="alert"
                        aria-live="polite"
                        className="mt-3 rounded-xl bg-brasa/10 border border-brasa/30 p-3 text-left space-y-2"
                      >
                        <p className="text-xs font-bold text-rojo-tinta">{error?.mensaje}</p>
                        <p className="text-xs text-papel-suave">
                          Verifica tu conexión o intenta de nuevo en unos segundos.
                        </p>
                        <button
                          type="button"
                          disabled={!validacion.valido || enviando}
                          onClick={manejarReintentar}
                          className="btn-comanda btn-comanda-claro h-11 text-lg border border-carbon"
                        >
                          REINTENTAR
                        </button>
                      </div>
                    )}

                    {esErrorRateLimit429 && (
                      <div
                        role="alert"
                        aria-live="polite"
                        className="mt-3 rounded-xl bg-carbon/5 border border-carbon/20 p-3 text-left space-y-1"
                      >
                        <p className="font-titulo text-base text-rojo-tinta tracking-wide uppercase">
                          Demasiados intentos
                        </p>
                        <p className="text-xs text-papel-suave">
                          {error?.mensaje || 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.'}
                        </p>
                        {cuentaRegresiva > 0 && (
                          <p className="text-xs font-semibold text-rojo-tinta">
                            Podrás volver a intentar en {cuentaRegresiva} segundos.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="corte-comanda" aria-hidden="true" />

                  <div className="p-5">
                    <button
                      type="submit"
                      disabled={!validacion.valido || enviando || cuentaRegresiva > 0}
                      className="btn-comanda"
                    >
                      <span>
                        {enviando
                          ? 'ENTRANDO...'
                          : cuentaRegresiva > 0
                            ? `ESPERA ${cuentaRegresiva}S`
                            : 'ENTRAR A LA MESA'}
                      </span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </form>
              )}

              {destino.accion !== 'redirigir' &&
                destino.accion !== 'confirmar_reutilizar' &&
                estado === 'sin_sesion' && (
                <section className="ticket-comanda anim-imprime relative">
                  <div className="banda-comanda">ESCANEAR CÓDIGO</div>
                  <div className="p-6 text-center space-y-3">
                    <div
                      aria-hidden="true"
                      className="w-14 h-14 bg-carbon text-ambar rounded-full flex items-center justify-center mx-auto text-xl font-bold font-titulo"
                    >
                      QR
                    </div>
                    <div className="space-y-1">
                      <h2 className="font-titulo text-3xl text-carbon uppercase tracking-wide">
                        Escanea el código QR
                      </h2>
                      <p className="text-xs text-papel-suave">
                        Usa la cámara de tu celular para escanear el código ubicado en tu mesa y unirte al pedido.
                      </p>
                    </div>
                  </div>
                </section>
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

export default Inicio;
