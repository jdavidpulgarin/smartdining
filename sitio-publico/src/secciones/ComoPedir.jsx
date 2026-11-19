import TituloSeccion from '../componentes/TituloSeccion.jsx';

/**
 * Sección '¿Cómo pedir?' animada al estilo póster de restaurante.
 * Implementa ilustraciones SVG en línea decorativas con animaciones
 * sincronizadas en ciclo de 12 s, conectores punteados y tarjeta activa
 * con foco ámbar secuencial.
 */
function ComoPedir() {
  return (
    <section
      id="como-pedir"
      aria-labelledby="titulo-como-pedir"
      className="fondo-poster-brillo-bl text-papel py-16 sm:py-24 scroll-mt-16 border-b border-papel/10"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <TituloSeccion
          id="titulo-como-pedir"
          linea1="¿Cómo"
          linea2="pedir?"
          descripcion="Sin filas ni esperas: todo se hace desde el celular, sentado en tu mesa."
          className="mb-12 sm:mb-16"
        />

        <ol className="pedir-pasos">
          {/* PASO 1 */}
          <li className="pedir-card pedir-card-1">
            <span className="etiqueta-girada font-titulo text-lg tracking-wider px-3.5 py-1 self-start mb-2">
              Paso 1
            </span>

            <svg
              className="pedir-ilus"
              viewBox="0 0 240 170"
              aria-hidden="true"
              focusable="false"
            >
              <ellipse cx="120" cy="152" rx="100" ry="6" fill="#000" opacity="0.5" />
              <g stroke="#ffb81f" strokeWidth="4" strokeLinecap="round">
                <path d="M92 44l-8 10" />
                <path d="M84 66h-12" />
                <path d="M104 30l-4 12" />
              </g>
              {/* QR */}
              <rect x="28" y="88" width="70" height="62" rx="9" fill="#fff1e3" />
              <g fill="#8d0b14">
                <rect x="38" y="98" width="18" height="18" rx="3" />
                <rect x="68" y="98" width="18" height="18" rx="3" />
                <rect x="38" y="122" width="18" height="18" rx="3" />
              </g>
              <g fill="#fff1e3">
                <rect x="42" y="102" width="10" height="10" rx="1" />
                <rect x="72" y="102" width="10" height="10" rx="1" />
                <rect x="42" y="126" width="10" height="10" rx="1" />
              </g>
              <g fill="#8d0b14">
                <rect x="45" y="105" width="4" height="4" />
                <rect x="75" y="105" width="4" height="4" />
                <rect x="45" y="129" width="4" height="4" />
                <rect x="64" y="126" width="6" height="6" />
                <rect x="74" y="122" width="6" height="6" />
                <rect x="82" y="132" width="6" height="6" />
                <rect x="68" y="136" width="6" height="6" />
                <rect x="60" y="138" width="5" height="5" />
              </g>
              <rect
                className="pedir-flash"
                x="28"
                y="88"
                width="70"
                height="62"
                rx="9"
                fill="#ffb81f"
                opacity="0"
              />
              {/* celular */}
              <g transform="rotate(12 170 84)">
                <g className="pedir-tel">
                  <rect x="128" y="14" width="84" height="140" rx="14" fill="#fff1e3" />
                  <rect x="135" y="28" width="70" height="112" rx="7" fill="#8d0b14" />
                  <rect x="158" y="19" width="24" height="4" rx="2" fill="#e5212e" />
                  <g
                    className="pedir-esq"
                    fill="none"
                    stroke="#ffb81f"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M147 56v-11h11" />
                    <path d="M182 45h11v11" />
                    <path d="M147 112v11h11" />
                    <path d="M193 112v11h-11" />
                  </g>
                  <rect
                    className="pedir-laser"
                    x="148"
                    y="52"
                    width="44"
                    height="3.5"
                    rx="1.75"
                    fill="#ffb81f"
                    opacity="0"
                  />
                  <g className="pedir-ok">
                    <circle cx="170" cy="84" r="19" fill="#ffb81f" />
                    <path
                      d="M161 84l7 7 13-14"
                      fill="none"
                      stroke="#120c0c"
                      strokeWidth="4.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </g>
                </g>
              </g>
            </svg>

            <h3 className="font-titulo text-2xl sm:text-3xl uppercase tracking-wide leading-tight min-h-[2.5em] flex items-end mb-2 text-papel">
              Escanea el QR de tu mesa
            </h3>

            <p className="font-cuerpo-poster text-sm sm:text-base text-papel/75 leading-relaxed m-0">
              Abre la cámara de tu celular y apunta al código que está en tu mesa.
            </p>
          </li>

          {/* PASO 2 */}
          <li className="pedir-card pedir-card-2">
            <span className="etiqueta-girada font-titulo text-lg tracking-wider px-3.5 py-1 self-start mb-2">
              Paso 2
            </span>

            <svg
              className="pedir-ilus"
              viewBox="0 0 240 170"
              aria-hidden="true"
              focusable="false"
            >
              <ellipse cx="120" cy="156" rx="100" ry="6" fill="#000" opacity="0.5" />
              <g stroke="#ffb81f" strokeWidth="4" strokeLinecap="round">
                <path d="M178 38l8-8" />
                <path d="M186 56h12" />
                <path d="M52 58l-9-7" />
                <path d="M46 78h-12" />
              </g>
              {/* ticket (sale desde atrás del celular) */}
              <g className="pedir-ticket">
                <g transform="rotate(-8 198 118)">
                  <rect x="176" y="92" width="44" height="54" rx="6" fill="#fff1e3" />
                  <path
                    d="M184 106h28M184 116h20M184 126h26"
                    stroke="#e5212e"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </g>
              </g>
              {/* celular */}
              <rect x="74" y="8" width="92" height="156" rx="16" fill="#fff1e3" />
              <rect x="81" y="24" width="78" height="124" rx="7" fill="#8d0b14" />
              <rect x="108" y="14" width="24" height="4" rx="2" fill="#e5212e" />
              {/* hamburguesa */}
              <g className="pedir-capa-0">
                <path d="M94 99h52c0 8-6 12-14 12h-24c-8 0-14-4-14-12z" fill="#ffb81f" />
              </g>
              <g className="pedir-capa-1">
                <path d="M92 86h56l-6 8h-8l-6-5-6 5h-8l-6-5-6 5h-6z" fill="#e5212e" />
              </g>
              <g className="pedir-capa-2">
                <rect x="92" y="73" width="56" height="9" rx="4.5" fill="#4a1f15" />
              </g>
              <g className="pedir-capa-3">
                <path
                  d="M92 68q7 8 14 0t14 0 14 0 14 0"
                  fill="none"
                  stroke="#7bd36b"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
              </g>
              <g className="pedir-capa-4">
                <path d="M94 63c0-14 12-22 26-22s26 8 26 22z" fill="#ffb81f" />
                <g fill="#fff1e3">
                  <circle cx="106" cy="54" r="1.8" />
                  <circle cx="120" cy="49" r="1.8" />
                  <circle cx="134" cy="55" r="1.8" />
                </g>
              </g>
              {/* botones */}
              <g>
                <circle cx="100" cy="130" r="8" fill="#e5212e" />
                <path d="M96 130h8" stroke="#fff1e3" strokeWidth="3" strokeLinecap="round" />
              </g>
              <rect
                x="112"
                y="124"
                width="16"
                height="12"
                rx="3"
                fill="none"
                stroke="#ffb81f"
                strokeWidth="2.5"
              />
              <circle
                className="pedir-onda"
                cx="140"
                cy="130"
                r="9"
                fill="none"
                stroke="#ffb81f"
                strokeWidth="3"
              />
              <g className="pedir-mas">
                <circle cx="140" cy="130" r="8" fill="#e5212e" />
                <path
                  d="M136 130h8M140 126v8"
                  stroke="#fff1e3"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </g>
            </svg>

            <h3 className="font-titulo text-2xl sm:text-3xl uppercase tracking-wide leading-tight min-h-[2.5em] flex items-end mb-2 text-papel">
              Arma tu pedido desde el celular
            </h3>

            <p className="font-cuerpo-poster text-sm sm:text-base text-papel/75 leading-relaxed m-0">
              Mira la carta completa, personaliza tus platos y envía la orden directo a cocina.
            </p>
          </li>

          {/* PASO 3 */}
          <li className="pedir-card pedir-card-3">
            <span className="etiqueta-girada font-titulo text-lg tracking-wider px-3.5 py-1 self-start mb-2">
              Paso 3
            </span>

            <svg
              className="pedir-ilus"
              viewBox="0 0 240 170"
              aria-hidden="true"
              focusable="false"
            >
              {/* billete */}
              <g className="pedir-bill">
                <g transform="rotate(10 182 54)">
                  <rect x="140" y="30" width="86" height="46" rx="7" fill="#ffb81f" />
                  <circle cx="183" cy="53" r="13" fill="none" stroke="#8d0b14" strokeWidth="4" />
                  <path
                    d="M183 46v14M179 49h7M179 57h7"
                    stroke="#8d0b14"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </g>
              </g>
              {/* tarjeta */}
              <g className="pedir-tarj">
                <g transform="rotate(-8 82 58)">
                  <rect x="22" y="18" width="120" height="76" rx="12" fill="#fff1e3" />
                  <rect x="22" y="36" width="120" height="14" fill="#8d0b14" />
                  <rect x="34" y="64" width="30" height="20" rx="4" fill="#ffb81f" />
                  <path d="M76 74h50" stroke="#e5212e" strokeWidth="5" strokeLinecap="round" />
                </g>
              </g>
              {/* en vivo */}
              <rect x="100" y="98" width="52" height="16" rx="8" fill="#fff1e3" />
              <circle className="pedir-vivo" cx="112" cy="106" r="3.8" fill="#e5212e" />
              <path
                d="M121 106h22"
                stroke="#e5212e"
                strokeWidth="3.6"
                strokeLinecap="round"
              />
              {/* progreso */}
              <rect x="26" y="124" width="188" height="9" rx="4.5" fill="#6e0d15" />
              <rect
                className="pedir-relleno"
                x="26"
                y="124"
                width="188"
                height="9"
                rx="4.5"
                fill="#ffb81f"
              />
              <g className="pedir-nodo-1">
                <circle cx="32" cy="128.5" r="12" fill="#fff1e3" />
                <path
                  d="M26 128.5l4.5 4.5 8.5-9"
                  fill="none"
                  stroke="#e5212e"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <g className="pedir-nodo-2">
                <circle cx="92" cy="128.5" r="12" fill="#fff1e3" />
                <path
                  d="M86 128.5l4.5 4.5 8.5-9"
                  fill="none"
                  stroke="#e5212e"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <g className="pedir-nodo-3">
                <circle cx="152" cy="128.5" r="12" fill="#fff1e3" />
                <path
                  d="M146 128.5l4.5 4.5 8.5-9"
                  fill="none"
                  stroke="#e5212e"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <g>
                <circle
                  cx="212"
                  cy="128.5"
                  r="12"
                  fill="#120c0c"
                  stroke="#fff1e3"
                  strokeWidth="3"
                />
                <path
                  d="M205.5 133h13M207.5 133v-5a4.5 4.5 0 0 1 9 0v5"
                  fill="none"
                  stroke="#fff1e3"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.9"
                />
              </g>
              <g className="pedir-nodo-4">
                <circle cx="212" cy="128.5" r="12.5" fill="#ffb81f" />
                <g className="pedir-campana">
                  <path
                    d="M205.5 133h13M207.5 133v-5a4.5 4.5 0 0 1 9 0v5M212 122.5v1.5"
                    fill="none"
                    stroke="#120c0c"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              </g>
            </svg>

            <h3 className="font-titulo text-2xl sm:text-3xl uppercase tracking-wide leading-tight min-h-[2.5em] flex items-end mb-2 text-papel">
              Paga y sigue tu pedido en vivo
            </h3>

            <p className="font-cuerpo-poster text-sm sm:text-base text-papel/75 leading-relaxed m-0">
              Paga con tu método preferido o pide la cuenta en efectivo, y mira cómo avanza tu comida.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}

export default ComoPedir;
