import { useLocation, useNavigate } from 'react-router-dom';
import { useSesion } from '../context/SesionContext';

function Despedida() {
  const location = useLocation();
  const navigate = useNavigate();
  const { motivoCierre, ultimaMesa, sesion } = useSesion();
  const motivo = location.state?.motivo ?? motivoCierre;
  const numeroMesa = location.state?.numeroMesa ?? ultimaMesa ?? null;
  const nombreComensal = location.state?.comensal ?? sesion?.comensal ?? null;

  const textoMesa = numeroMesa
    ? `La cuenta de la mesa ${numeroMesa} quedó pagada.`
    : 'La cuenta de la mesa quedó pagada.';

  return (
    <main className="min-h-screen fondo-comanda-rojo text-tinta flex flex-col justify-between p-4 sm:p-6 relative overflow-hidden">
      {/* Confeti suave decorativo */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <i className="absolute top-0 left-[8%] w-2.5 h-3.5 rounded-xs bg-[#E5212E] anim-cae" />
        <i className="absolute top-0 left-[22%] w-2.5 h-3.5 rounded-xs bg-[#FFB02E] anim-cae [animation-delay:0.8s]" />
        <i className="absolute top-0 left-[48%] w-2.5 h-3.5 rounded-xs bg-[#1FA65A] anim-cae [animation-delay:1.5s]" />
        <i className="absolute top-0 left-[72%] w-2.5 h-3.5 rounded-xs bg-[#FFF4E6] anim-cae [animation-delay:0.4s]" />
        <i className="absolute top-0 left-[88%] w-2.5 h-3.5 rounded-xs bg-[#FFB02E] anim-cae [animation-delay:1.2s]" />
      </div>

      <div className="w-full max-w-md mx-auto flex flex-col flex-1 relative z-10">
        {/* Encabezado píldora SD */}
        <header className="self-start inline-flex items-center gap-2.5 bg-papel px-4 py-1.5 rounded-full shadow-md anim-sube">
          <div
            className="w-7 h-7 rounded-full bg-carbon text-ambar grid place-items-center font-titulo text-base shrink-0"
            aria-hidden="true"
          >
            SD
          </div>
          <b className="font-titulo text-xl tracking-[0.16em] text-carbon">
            SMARTDINING
          </b>
        </header>

        {/* Escena disco crema con la mascota chef y corazón */}
        <section className="flex-1 flex items-center justify-center py-6 anim-sube anim-sube-d1" aria-hidden="true">
          <div className="relative w-[206px] h-[206px] rounded-full bg-papel shadow-[0_22px_30px_-16px_rgba(0,0,0,0.6)] flex items-center justify-center">
            {/* Anillo punteado rotatorio */}
            <div className="absolute -inset-3 rounded-full border-[3px] border-dashed border-papel opacity-75 seg-gira pointer-events-none" />

            {/* Mascota chef saludando */}
            <img
              src="/img/mascota-chef.webp"
              alt=""
              aria-hidden="true"
              className="w-[160px] seg-chao pointer-events-none"
            />

            {/* Corazón latiendo */}
            <svg
              className="absolute -right-2 -bottom-1 w-[72px] h-[72px] drop-shadow-md seg-late"
              viewBox="0 0 76 76"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M38 66C15 48 6 36 6 22 6 12 14 6 24 6c7 0 11 4 14 8 3-4 7-8 14-8 10 0 18 6 18 16 0 14-9 26-32 44z"
                fill="#E5212E"
              />
              <path
                d="M22 14c-4 2-6 6-6 10"
                stroke="#FFF"
                strokeWidth="3.5"
                strokeLinecap="round"
                opacity="0.6"
              />
            </svg>
          </div>
        </section>

        {/* Ticket comanda con datos de cierre */}
        {motivo === 'pagada' ? (
          <section className="ticket-comanda anim-sube anim-sube-d2">
            <div className="banda-comanda">
              CUENTA PAGADA
            </div>

            <div className="relative p-6 text-left">
              {/* Sello verde PAGADO */}
              <div
                className="absolute right-4 top-4 border-4 border-double border-verde text-verde rounded-lg px-3 py-1 font-titulo text-2xl tracking-[0.12em] -rotate-10 seg-sello pointer-events-none shadow-xs"
                aria-hidden="true"
              >
                PAGADO
              </div>

              <h1 className="m-0 font-titulo text-4xl sm:text-5xl leading-none text-carbon uppercase max-w-[9ch]">
                ¡GRACIAS POR VENIR!
              </h1>

              {nombreComensal && (
                <div className="font-manuscrita text-3xl sm:text-4xl text-rojo-tinta font-bold mt-1 mb-2">
                  {nombreComensal}
                </div>
              )}

              <div className="flex gap-2 flex-wrap my-3">
                {numeroMesa && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-titulo text-sm tracking-wider bg-carbon text-ambar">
                    MESA {numeroMesa}
                  </span>
                )}
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 font-titulo text-sm tracking-wider border-2 border-carbon text-carbon">
                  <i className="w-2 h-2 rounded-full bg-verde" aria-hidden="true" />
                  CUENTA SALDADA
                </span>
              </div>

              <p className="text-sm sm:text-base leading-relaxed text-[#5B4A46] m-0">
                {textoMesa}
              </p>
              <p className="text-xs sm:text-sm text-[#5B4A46] mt-2 mb-0">
                Para volver a pedir, escanea el QR de la mesa otra vez.
              </p>
            </div>

            <div className="corte-comanda my-1" />

            <div className="p-5 flex flex-col gap-3 text-center">
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                className="btn-despedida-inicio btn-comanda no-underline"
              >
                Volver al inicio
              </button>
              <div className="font-manuscrita text-xl text-[#5B4A46]">
                Hasta la próxima · SmartDining
              </div>
            </div>
          </section>
        ) : (
          <section className="ticket-comanda p-6 text-center space-y-4 anim-sube anim-sube-d2">
            <div className="w-16 h-16 bg-verde text-white rounded-full flex items-center justify-center mx-auto text-3xl font-bold shadow-md" aria-hidden="true">
              ✓
            </div>

            <div className="space-y-1">
              <h1 className="font-titulo text-3xl sm:text-4xl font-bold text-carbon uppercase tracking-wider m-0">
                ¡Gracias por tu visita!
              </h1>
              <p className="text-sm text-[#5B4A46] leading-relaxed m-0">
                La mesa se cerró. Si quieres pedir de nuevo, escanea el QR de la mesa.
              </p>
            </div>

            <div className="corte-comanda my-2" />

            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="btn-despedida-inicio btn-comanda no-underline"
            >
              Volver al inicio
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

export default Despedida;
