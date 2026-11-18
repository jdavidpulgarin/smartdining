import TituloSeccion from '../componentes/TituloSeccion.jsx';

/**
 * Sección 'Próximamente' al estilo póster de restaurante.
 * Tarjetas con borde punteado de comanda, ilustraciones SVG decorativas (aria-hidden),
 * etiquetas 'Muy pronto' giradas y mensaje de invitación al pedido digital.
 */
function Proximamente() {
  return (
    <section
      id="proximamente"
      aria-labelledby="titulo-proximamente"
      className="fondo-poster-brillo-br text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <TituloSeccion
          id="titulo-proximamente"
          linea1="Muy"
          linea2="pronto"
          descripcion="Estamos preparando dos formas más de disfrutar la sazón de SmartDining."
          className="mb-12 sm:mb-16"
        />

        <ul className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 list-none m-0 p-0">
          <li className="border-2 border-dashed border-papel/30 rounded-2xl p-6 sm:p-8 bg-[#161010] flex flex-col sm:flex-row items-start gap-6">
            <svg
              viewBox="0 0 120 100"
              aria-hidden="true"
              className="w-24 sm:w-28 h-auto shrink-0 aspect-[120/100] self-center sm:self-start"
            >
              <ellipse cx="60" cy="92" rx="42" ry="5" fill="#000000" opacity="0.45" />
              <path
                d="M44 34v-8a16 16 0 0 1 32 0v8"
                stroke="#FFF3E6"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <rect x="26" y="34" width="68" height="56" rx="7" fill="#FFF3E6" />
              <rect x="26" y="50" width="68" height="10" fill="#A3141C" />
              <circle cx="60" cy="74" r="10" fill="#FFB81C" />
              <path
                d="M55 74l4 4 7-8"
                stroke="#A3141C"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M16 30l-8-5M104 30l8-5M110 52h8"
                stroke="#FFB81C"
                strokeWidth="4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="m-0 font-titulo text-3xl sm:text-4xl uppercase tracking-wide text-papel">
                  Para llevar
                </h3>
                <span className="etiqueta-girada font-titulo text-base tracking-wider px-3 py-1">
                  Muy pronto
                </span>
              </div>
              <p className="m-0 text-sm sm:text-base font-cuerpo-poster text-papel/75 leading-relaxed">
                Pide tus platos preferidos antes de salir de casa o del trabajo y
                recógelos listos en el restaurante, sin filas ni demoras.
              </p>
            </div>
          </li>

          <li className="border-2 border-dashed border-papel/30 rounded-2xl p-6 sm:p-8 bg-[#161010] flex flex-col sm:flex-row items-start gap-6">
            <svg
              viewBox="0 0 120 100"
              aria-hidden="true"
              className="w-24 sm:w-28 h-auto shrink-0 aspect-[120/100] self-center sm:self-start"
            >
              <ellipse cx="60" cy="92" rx="48" ry="5" fill="#000000" opacity="0.45" />
              <rect x="6" y="30" width="38" height="32" rx="5" fill="#FFB81C" />
              <path
                d="M14 46h22M14 54h14"
                stroke="#E3202D"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <path
                d="M44 62h36l10-26h10M80 62l-6-8"
                stroke="#FFF3E6"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <rect x="48" y="48" width="30" height="12" rx="5" fill="#A3141C" />
              <circle cx="28" cy="76" r="13" fill="#0B0B0B" stroke="#FFF3E6" strokeWidth="5" />
              <circle cx="94" cy="76" r="13" fill="#0B0B0B" stroke="#FFF3E6" strokeWidth="5" />
              <circle cx="28" cy="76" r="3.5" fill="#E3202D" />
              <circle cx="94" cy="76" r="3.5" fill="#E3202D" />
              <path
                d="M104 20l7-6M112 34h8"
                stroke="#FFB81C"
                strokeWidth="4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="m-0 font-titulo text-3xl sm:text-4xl uppercase tracking-wide text-papel">
                  Domicilios
                </h3>
                <span className="etiqueta-girada font-titulo text-base tracking-wider px-3 py-1">
                  Muy pronto
                </span>
              </div>
              <p className="m-0 text-sm sm:text-base font-cuerpo-poster text-papel/75 leading-relaxed">
                Llevaremos la sazón vallenata y los ingredientes de nuestra
                tierra hasta la puerta de tu casa.
              </p>
            </div>
          </li>
        </ul>

        <p className="mt-10 sm:mt-12 text-base sm:text-lg font-cuerpo-poster text-papel/75">
          <b className="text-papel font-semibold">Mientras tanto,</b> escanea el
          QR de tu mesa y pide desde el celular.
        </p>
      </div>
    </section>
  );
}

export default Proximamente;
