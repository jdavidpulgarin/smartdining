/**
 * Ilustraciones vectoriales animadas para los estados del pedido (J-07).
 *
 * Implementa los 5 estados requeridos:
 * - recibido: Comanda que cae, se balancea, imprime líneas y se sella en verde.
 * - en_preparacion: Sartén con fuego, ingredientes saltando y vapor.
 * - listo: Campana con ondas, tapa saltando y resplandor rojo pulsante.
 * - entregado / pagado: Plato con comida que entra con pop, vapor y chispas.
 * - cancelado: Plato base con una X roja (#E3242B) que aparece una sola vez con pop.
 *
 * Cumple con accesibilidad: todas las ilustraciones llevan aria-hidden="true".
 * Las animaciones se definen en src/styles/seguimiento.css y respetan prefers-reduced-motion.
 */

export default function IlustracionEstado({ estado, numeroMesa = null }) {
  const norm = String(estado || '').trim().toLowerCase();

  const textoMesa = numeroMesa ? `MESA ${numeroMesa}` : 'ORDEN';

  if (norm === 'en_preparacion') {
    return (
      <svg
        className="ilu"
        width="250"
        height="210"
        viewBox="0 0 240 200"
        aria-hidden="true"
      >
        <ellipse cx="116" cy="184" rx="82" ry="6" fill="#000000" opacity="0.55" />
        <rect x="56" y="170" width="120" height="7" rx="3" fill="#3A3A3A" />
        <path
          className="llama"
          d="M76 170 C70 160 76 152 80 146 C84 152 90 160 84 170 Z"
          fill="#F2B705"
        />
        <path
          className="llama f2"
          d="M96 170 C90 158 96 148 100 142 C104 148 110 158 104 170 Z"
          fill="#E3242B"
        />
        <path
          className="llama f3"
          d="M116 170 C110 160 116 152 120 146 C124 152 130 160 124 170 Z"
          fill="#F2B705"
        />
        <path
          className="llama f4"
          d="M136 170 C130 158 136 148 140 142 C144 148 150 158 144 170 Z"
          fill="#E3242B"
        />
        <path
          className="llama f5"
          d="M156 170 C150 160 156 152 160 146 C164 152 170 160 164 170 Z"
          fill="#F2B705"
        />
        <g className="sacude">
          <rect x="168" y="124" width="62" height="10" rx="5" fill="#2A2A2A" />
          <ellipse cx="112" cy="134" rx="64" ry="18" fill="#1F1F1F" />
          <ellipse cx="112" cy="128" rx="64" ry="14" fill="#2A2A2A" />
          <ellipse cx="112" cy="128" rx="54" ry="10" fill="#111111" />
        </g>
        <circle
          className="salta d1"
          cx="92"
          cy="122"
          r="7"
          fill="#2FA35A"
          style={{ '--dx': '-10px' }}
        />
        <rect
          className="salta d2"
          x="104"
          y="114"
          width="14"
          height="10"
          rx="2"
          fill="#9A5B2A"
          style={{ '--dx': '6px' }}
        />
        <circle
          className="salta d3"
          cx="130"
          cy="120"
          r="6"
          fill="#F2B705"
          style={{ '--dx': '12px' }}
        />
        <circle
          className="salta d4"
          cx="116"
          cy="124"
          r="5"
          fill="#E3242B"
          style={{ '--dx': '-4px' }}
        />
        <path
          className="salta d5"
          d="M140 124 q6 -10 12 0"
          fill="none"
          stroke="#EDEDED"
          strokeWidth="4"
          strokeLinecap="round"
          style={{ '--dx': '8px' }}
        />
        <path
          className="vapor"
          d="M96 96 q-6 -10 0 -20 q6 -10 0 -20"
          fill="none"
          stroke="#6B6B6B"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="vapor v2"
          d="M120 92 q-6 -10 0 -20 q6 -10 0 -20"
          fill="none"
          stroke="#6B6B6B"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="vapor v3"
          d="M144 96 q-6 -10 0 -20 q6 -10 0 -20"
          fill="none"
          stroke="#6B6B6B"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (norm === 'listo') {
    return (
      <svg
        className="ilu"
        width="250"
        height="210"
        viewBox="0 0 240 200"
        aria-hidden="true"
      >
        <ellipse
          className="brillo"
          cx="120"
          cy="128"
          rx="88"
          ry="60"
          fill="#E3242B"
          opacity="0.4"
          style={{ filter: 'blur(18px)' }}
        />
        <ellipse cx="120" cy="184" rx="82" ry="6" fill="#000000" opacity="0.55" />
        <ellipse cx="120" cy="166" rx="76" ry="13" fill="#3A3A3A" />
        <g className="tapa">
          <path d="M62 160 A58 58 0 0 1 178 160 Z" fill="#D4D4D4" />
          <path
            d="M84 122 A40 40 0 0 1 112 104"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="6"
            strokeLinecap="round"
            opacity="0.7"
          />
          <rect x="54" y="156" width="132" height="8" rx="4" fill="#A3A3A3" />
          <circle cx="120" cy="98" r="8" fill="#A3A3A3" />
        </g>
        <g className="campana">
          <rect x="104" y="58" width="32" height="6" rx="2" fill="#6B4B2B" />
          <path d="M108 58 A12 12 0 0 1 132 58 Z" fill="#F2B705" />
          <circle cx="120" cy="43" r="3" fill="#F2B705" />
        </g>
        <g className="ondas">
          <path
            d="M94 40 q-8 10 0 20"
            fill="none"
            stroke="#F2B705"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M146 40 q8 10 0 20"
            fill="none"
            stroke="#F2B705"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  if (norm === 'entregado' || norm === 'pagado') {
    return (
      <svg
        className="ilu"
        width="250"
        height="210"
        viewBox="0 0 240 200"
        aria-hidden="true"
      >
        <ellipse cx="120" cy="184" rx="84" ry="6" fill="#000000" opacity="0.55" />
        <g className="plato-pop">
          <ellipse cx="120" cy="160" rx="82" ry="18" fill="#E8E8E8" />
          <ellipse cx="120" cy="158" rx="62" ry="12" fill="#D2D2D2" />
          <ellipse cx="96" cy="146" rx="30" ry="11" fill="#2FA35A" />
          <ellipse cx="146" cy="148" rx="30" ry="10" fill="#27894B" />
          <rect x="98" y="128" width="20" height="15" rx="3" fill="#9A5B2A" />
          <rect x="124" y="126" width="20" height="15" rx="3" fill="#9A5B2A" />
          <circle cx="84" cy="138" r="9" fill="#FFFFFF" />
          <circle cx="84" cy="138" r="4" fill="#F2B705" />
          <circle cx="156" cy="136" r="9" fill="#FFFFFF" />
          <circle cx="156" cy="136" r="4" fill="#F2B705" />
          <circle cx="110" cy="152" r="3" fill="#F2B705" />
          <circle cx="120" cy="150" r="3" fill="#F2B705" />
          <circle cx="132" cy="153" r="3" fill="#F2B705" />
        </g>
        <path
          className="vapor"
          d="M100 116 q-6 -10 0 -20 q6 -10 0 -20"
          fill="none"
          stroke="#6B6B6B"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="vapor v2"
          d="M122 112 q-6 -10 0 -20 q6 -10 0 -20"
          fill="none"
          stroke="#6B6B6B"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="vapor v3"
          d="M144 116 q-6 -10 0 -20 q6 -10 0 -20"
          fill="none"
          stroke="#6B6B6B"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          className="chispa"
          d="M44 70 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 Z"
          fill="#F2B705"
        />
        <path
          className="chispa c2"
          d="M196 60 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z"
          fill="#2FA35A"
        />
        <path
          className="chispa c3"
          d="M184 112 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z"
          fill="#F2B705"
        />
        <path
          className="chispa c4"
          d="M56 120 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z"
          fill="#FF5A5F"
        />
      </svg>
    );
  }

  if (norm === 'cancelado') {
    return (
      <svg
        className="ilu"
        width="250"
        height="210"
        viewBox="0 0 240 200"
        aria-hidden="true"
      >
        <ellipse cx="120" cy="182" rx="82" ry="7" fill="#000000" opacity="0.55" />
        <ellipse cx="120" cy="164" rx="74" ry="15" fill="#2A2A2A" />
        <ellipse cx="120" cy="162" rx="52" ry="9" fill="#1F1F1F" />
        <g className="cancel-pop">
          <circle cx="120" cy="100" r="32" fill="#2A2A2A" stroke="#E3242B" strokeWidth="3" />
          <line
            x1="108"
            y1="88"
            x2="132"
            y2="112"
            stroke="#E3242B"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <line
            x1="132"
            y1="88"
            x2="108"
            y2="112"
            stroke="#E3242B"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  // Estado por defecto: recibido
  return (
    <svg
      className="ilu"
      width="250"
      height="210"
      viewBox="0 0 240 200"
      aria-hidden="true"
    >
      <ellipse cx="120" cy="182" rx="82" ry="7" fill="#000000" opacity="0.55" />
      <ellipse cx="120" cy="164" rx="74" ry="15" fill="#2A2A2A" />
      <ellipse cx="120" cy="162" rx="52" ry="9" fill="#1F1F1F" />
      <rect className="riel" x="34" y="16" width="172" height="6" rx="3" fill="#3A3A3A" />
      <g className="drop">
        <g className="sway">
          <rect x="94" y="22" width="52" height="82" rx="2" fill="#F4F1EA" />
          <rect x="94" y="22" width="52" height="16" fill="#E3242B" />
          <text
            x="120"
            y="34"
            textAnchor="middle"
            fontFamily="Barlow Condensed, sans-serif"
            fontWeight="700"
            fontSize="10"
            fill="#FFFFFF"
          >
            {textoMesa}
          </text>
          <rect className="linea l1" x="102" y="48" width="36" height="4" rx="2" fill="#BDBDBD" />
          <rect className="linea l2" x="102" y="58" width="30" height="4" rx="2" fill="#BDBDBD" />
          <rect className="linea l3" x="102" y="68" width="34" height="4" rx="2" fill="#BDBDBD" />
          <rect className="linea l4" x="102" y="78" width="22" height="4" rx="2" fill="#BDBDBD" />
          <path
            d="M94 104 L100 110 L106 104 L112 110 L118 104 L124 110 L130 104 L136 110 L142 104 L146 108 L146 104 Z"
            fill="#F4F1EA"
          />
          <g className="sello">
            <circle cx="140" cy="94" r="11" fill="#2FA35A" />
            <path
              d="M135 94 l4 4 l7 -8"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}

