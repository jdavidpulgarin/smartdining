import TituloSeccion from '../componentes/TituloSeccion.jsx';

/**
 * Sección 'Próximamente' al estilo póster de restaurante.
 * Tarjetas con animación de entrada (prox-entra), ilustraciones SVG animadas decorativas
 * (bolsa sacudiéndose y repartidor en moto), etiquetas 'Muy pronto' giradas y
 * mensaje de invitación al pedido digital.
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
          {/* Para llevar */}
          <li className="prox-entra border-2 border-dashed border-papel/30 rounded-2xl p-6 sm:p-8 bg-[#161010] flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <svg
              viewBox="0 0 140 120"
              aria-hidden="true"
              focusable="false"
              className="w-28 sm:w-36 h-auto shrink-0 aspect-[140/120] overflow-visible"
            >
              <ellipse cx="70" cy="106" rx="34" ry="5" fill="#000" opacity="0.45" />
              <g className="prox-chispa">
                <path d="M14 40l12 7" stroke="var(--color-ambar)" strokeWidth="4" strokeLinecap="round" />
              </g>
              <g className="prox-chispa prox-chispa-2">
                <path d="M126 38l-11 7" stroke="var(--color-ambar)" strokeWidth="4" strokeLinecap="round" />
              </g>
              <g className="prox-chispa prox-chispa-3">
                <path d="M128 64h-11" stroke="var(--color-ambar)" strokeWidth="4" strokeLinecap="round" />
              </g>
              <g className="prox-sacude">
                <path
                  d="M50 54V38a20 20 0 0 1 40 0v16"
                  fill="none"
                  stroke="var(--color-papel)"
                  strokeWidth="7"
                  strokeLinecap="round"
                />
                <rect x="34" y="50" width="72" height="54" rx="9" fill="var(--color-papel)" />
                <rect x="34" y="60" width="72" height="12" fill="var(--color-primario-oscuro)" />
                <g className="prox-visto">
                  <circle cx="70" cy="86" r="11" fill="var(--color-ambar)" />
                  <path
                    d="M64 86l5 5 9-10"
                    fill="none"
                    stroke="var(--color-primario-oscuro)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </g>
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

          {/* Domicilios */}
          <li className="prox-entra prox-entra-retraso border-2 border-dashed border-papel/30 rounded-2xl p-6 sm:p-8 bg-[#161010] flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <svg
              viewBox="0 -12 210 142"
              aria-hidden="true"
              focusable="false"
              className="w-36 sm:w-44 h-auto shrink-0 aspect-[210/142] overflow-visible"
            >
              {/* carretera */}
              <line
                className="prox-camino"
                x1="4"
                y1="121"
                x2="206"
                y2="121"
                stroke="#4a3f3d"
                strokeWidth="4"
                strokeLinecap="round"
              />
              {/* humo */}
              <g>
                <circle className="prox-humo" cx="22" cy="98" r="5" />
                <circle className="prox-humo prox-humo-2" cx="22" cy="98" r="5" />
                <circle className="prox-humo prox-humo-3" cx="22" cy="98" r="5" />
                <circle className="prox-humo prox-humo-4" cx="22" cy="98" r="5" />
              </g>
              {/* viento */}
              <g stroke="var(--color-ambar)" strokeWidth="4" strokeLinecap="round">
                <path className="prox-viento" d="M186 34h14" />
                <path className="prox-viento prox-viento-2" d="M192 48h12" />
                <path className="prox-viento prox-viento-3" d="M182 22h9" />
              </g>
              <ellipse cx="100" cy="123" rx="78" ry="4" fill="#000" opacity="0.4" />

              <g className="prox-bota">
                {/* escape */}
                <path d="M32 100h-10" stroke="#cfc4bd" strokeWidth="5" strokeLinecap="round" />
                {/* brazo trasero + chasis */}
                <path d="M52 102L92 88" stroke="var(--color-papel)" strokeWidth="5" strokeLinecap="round" />
                <path d="M152 102L142 58" stroke="var(--color-papel)" strokeWidth="5" strokeLinecap="round" />

                {/* caja de domicilio */}
                <rect x="12" y="34" width="54" height="36" rx="7" fill="var(--color-ambar)" />
                <rect x="12" y="34" width="54" height="9" rx="4" fill="#e69a00" />
                <circle cx="39" cy="56" r="10" fill="var(--color-primario)" />
                <text
                  x="39"
                  y="60"
                  textAnchor="middle"
                  fill="var(--color-papel)"
                  className="font-titulo text-[12px]"
                  letterSpacing=".5"
                >
                  SD
                </text>
                <rect x="24" y="70" width="30" height="5" rx="2.5" fill="var(--color-papel)" />

                {/* motor */}
                <rect
                  x="88"
                  y="78"
                  width="36"
                  height="20"
                  rx="6"
                  fill="var(--color-primario-oscuro)"
                  stroke="var(--color-papel)"
                  strokeWidth="2.5"
                />
                <circle cx="106" cy="88" r="5" fill="none" stroke="var(--color-ambar)" strokeWidth="2.5" />
                {/* tanque / carrocería */}
                <path d="M84 62Q98 46 126 54L140 56L134 78H90Q80 74 84 62Z" fill="var(--color-primario)" />
                <path
                  d="M92 62Q104 53 124 59"
                  fill="none"
                  stroke="#ff6b6b"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.8"
                />
                {/* asiento */}
                <path d="M62 62Q64 54 74 54H96Q100 58 96 64H66Q62 64 62 62Z" fill="var(--color-papel)" />
                {/* escudo frontal */}
                <path d="M132 50Q146 38 158 48L162 66Q148 72 140 66Z" fill="var(--color-primario)" />
                <circle cx="158" cy="54" r="5" fill="var(--color-ambar)" />
                <path
                  d="M163 54h6M162 49l6-4M162 59l6 4"
                  stroke="var(--color-ambar)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity="0.7"
                />
                {/* guardabarros delantero */}
                <path
                  d="M130 92A23 23 0 0 1 174 90"
                  fill="none"
                  stroke="var(--color-primario)"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                {/* manubrio */}
                <path
                  d="M140 52L136 42h14"
                  fill="none"
                  stroke="var(--color-papel)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* ruedas */}
                <g>
                  <circle cx="52" cy="102" r="20" fill="var(--color-fondo)" stroke="var(--color-papel)" strokeWidth="4" />
                  <circle cx="52" cy="102" r="11" fill="none" stroke="var(--color-ambar)" strokeWidth="2.5" />
                  <g className="prox-rueda">
                    <path
                      d="M52 91v22M41 102h22M44 94l16 16M60 94L44 110"
                      stroke="var(--color-papel)"
                      strokeWidth="2"
                      opacity="0.7"
                    />
                    <circle cx="52" cy="102" r="4.5" fill="var(--color-primario)" />
                    <circle cx="52" cy="92.5" r="2.4" fill="var(--color-ambar)" />
                  </g>
                </g>
                <g>
                  <circle cx="152" cy="102" r="20" fill="var(--color-fondo)" stroke="var(--color-papel)" strokeWidth="4" />
                  <circle cx="152" cy="102" r="11" fill="none" stroke="var(--color-ambar)" strokeWidth="2.5" />
                  <g className="prox-rueda">
                    <path
                      d="M152 91v22M141 102h22M144 94l16 16M160 94l-16 16"
                      stroke="var(--color-papel)"
                      strokeWidth="2"
                      opacity="0.7"
                    />
                    <circle cx="152" cy="102" r="4.5" fill="var(--color-primario)" />
                    <circle cx="152" cy="92.5" r="2.4" fill="var(--color-ambar)" />
                  </g>
                </g>

                {/* repartidor: mascota chef */}
                <g className="prox-piloto">
                  {/* pierna */}
                  <path d="M82 58L108 76" stroke="var(--color-papel)" strokeWidth="8" strokeLinecap="round" />
                  <rect x="104" y="73" width="16" height="8" rx="4" fill="var(--color-primario)" />
                  {/* torso */}
                  <rect x="70" y="30" width="26" height="30" rx="9" fill="var(--color-papel)" />
                  <rect x="77" y="46" width="12" height="8" rx="3" fill="var(--color-primario)" />
                  {/* brazo */}
                  <path d="M92 40L134 44" stroke="var(--color-papel)" strokeWidth="7" strokeLinecap="round" />
                  <circle cx="138" cy="44" r="5" fill="var(--color-primario)" />
                  {/* cabeza */}
                  <rect x="68" y="8" width="32" height="26" rx="10" fill="var(--color-papel)" />
                  <rect x="73" y="14" width="23" height="13" rx="6" fill="var(--color-fondo)" />
                  <path
                    d="M78 19q3-3 6 0M86 19q3-3 6 0"
                    fill="none"
                    stroke="var(--color-ambar)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M80 23q5 4 10 0"
                    fill="none"
                    stroke="var(--color-ambar)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <circle cx="75" cy="25" r="2" fill="var(--color-primario)" />
                  <circle cx="94" cy="25" r="2" fill="var(--color-primario)" />
                  {/* gorro de chef */}
                  <circle cx="76" cy="3" r="7" fill="var(--color-papel)" />
                  <circle cx="85" cy="-2" r="8" fill="var(--color-papel)" />
                  <circle cx="94" cy="3" r="7" fill="var(--color-papel)" />
                  <rect x="72" y="2" width="26" height="9" rx="3" fill="var(--color-papel)" />
                </g>
              </g>
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
