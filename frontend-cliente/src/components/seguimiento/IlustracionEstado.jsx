/**
 * Ilustraciones vectoriales animadas para los estados del pedido al estilo comanda.
 *
 * Estados:
 * - recibido: comanda que cae/se clava en el pincho con visto.
 * - en_preparacion: sartén al fuego con llamas que oscilan, ingredientes saltando y vapor.
 * - listo: campana que tintinea y cloche que se levanta un poco con vapor.
 * - entregado / pagado: plato servido con brillos/estrellas y vapor.
 * - cancelado: comanda quieta con tachado.
 *
 * Accesibilidad: todas las ilustraciones llevan aria-hidden="true".
 * Animaciones definidas en index.css dentro de prefers-reduced-motion: no-preference.
 */

function EscenaRecibido() {
  return (
    <svg className="w-[200px] h-[200px] overflow-visible" viewBox="0 0 200 200" aria-hidden="true">
      <ellipse cx="100" cy="168" rx="56" ry="8" fill="#000" opacity="0.18" />
      <rect x="56" y="150" width="88" height="14" rx="7" fill="#120C0C" />
      <rect x="97" y="44" width="6" height="110" rx="3" fill="#CFC4BD" />
      <g className="seg-tk">
        <g transform="rotate(-6 100 100)">
          <path
            d="M62 52h76v86l-7.6-6-7.6 6-7.6-6-7.6 6-7.6-6-7.6 6-7.6-6-7.6 6-7.6-6-7.6 6z"
            fill="#FFF4E6"
            stroke="#120C0C"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <rect x="62" y="52" width="76" height="16" fill="#120C0C" />
          <path d="M74 84h52M74 98h38M74 112h46" stroke="#B3121C" strokeWidth="5" strokeLinecap="round" />
          <circle cx="100" cy="76" r="4" fill="#CFC4BD" />
        </g>
      </g>
      <g className="seg-ck">
        <circle cx="140" cy="128" r="20" fill="#1FA65A" stroke="#120C0C" strokeWidth="4" />
        <path d="M131 128l6 6 12-13" fill="none" stroke="#FFF" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function EscenaPreparando() {
  return (
    <svg className="w-[200px] h-[200px] overflow-visible" viewBox="0 0 200 200" aria-hidden="true">
      <path className="seg-vapor" d="M78 70q-6-10 0-20t0-20" fill="none" stroke="#CFC4BD" strokeWidth="5" strokeLinecap="round" />
      <path className="seg-vapor seg-vapor-v2" d="M100 66q-6-10 0-20t0-20" fill="none" stroke="#CFC4BD" strokeWidth="5" strokeLinecap="round" />
      <path className="seg-vapor seg-vapor-v3" d="M122 70q-6-10 0-20t0-20" fill="none" stroke="#CFC4BD" strokeWidth="5" strokeLinecap="round" />
      <g className="seg-salta"><circle cx="82" cy="112" r="9" fill="#1FA65A" /></g>
      <g className="seg-salta seg-salta-b"><rect x="96" y="104" width="15" height="13" rx="3" fill="#8D0B14" transform="rotate(-18 103 110)" /></g>
      <g className="seg-salta seg-salta-c"><circle cx="122" cy="112" r="8" fill="#FFB02E" /></g>
      <g className="seg-salta seg-salta-d"><circle cx="104" cy="98" r="7" fill="#E5212E" /></g>
      <g className="seg-sarten">
        <ellipse cx="96" cy="126" rx="56" ry="13" fill="#120C0C" />
        <ellipse cx="96" cy="122" rx="48" ry="9" fill="#2B2120" />
        <rect x="148" y="116" width="44" height="10" rx="5" fill="#120C0C" />
      </g>
      <g>
        <path className="seg-llama" d="M62 168c-8-12 4-18 2-30 10 8 14 18 6 30z" fill="#FFB02E" />
        <path className="seg-llama seg-llama-b" d="M84 168c-9-14 5-22 2-36 12 10 16 22 8 36z" fill="#E5212E" />
        <path className="seg-llama seg-llama-c" d="M106 168c-9-14 5-22 2-36 12 10 16 22 8 36z" fill="#FFB02E" />
        <path className="seg-llama" d="M128 168c-8-12 4-18 2-30 10 8 14 18 6 30z" fill="#E5212E" />
      </g>
      <rect x="44" y="166" width="112" height="9" rx="4.5" fill="#120C0C" />
    </svg>
  );
}

function EscenaListo() {
  return (
    <svg className="w-[200px] h-[200px] overflow-visible" viewBox="0 0 200 200" aria-hidden="true">
      <ellipse cx="100" cy="166" rx="70" ry="8" fill="#000" opacity="0.18" />
      <g className="seg-ding">
        <path d="M146 26l8-8M156 42h11M140 14l2-10" stroke="#E5212E" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g className="seg-campana">
        <rect x="122" y="44" width="34" height="5" rx="2.5" fill="#8D0B14" />
        <path d="M125 44a14 14 0 0 1 28 0z" fill="#FFB02E" stroke="#120C0C" strokeWidth="2.5" />
        <circle cx="139" cy="27" r="3.5" fill="#120C0C" />
      </g>
      <path className="seg-vapor" d="M72 112q-5-8 0-16t0-16" fill="none" stroke="#CFC4BD" strokeWidth="4.5" strokeLinecap="round" />
      <path className="seg-vapor seg-vapor-v2" d="M128 112q-5-8 0-16t0-16" fill="none" stroke="#CFC4BD" strokeWidth="4.5" strokeLinecap="round" />
      <ellipse cx="100" cy="152" rx="76" ry="11" fill="#120C0C" />
      <ellipse cx="100" cy="148" rx="66" ry="8" fill="#E6D6C4" />
      <g className="seg-tapa">
        <path d="M38 146a62 62 0 0 1 124 0z" fill="#CFC4BD" stroke="#120C0C" strokeWidth="4" />
        <path d="M56 128a46 46 0 0 1 30-34" fill="none" stroke="#FFF" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
        <circle cx="100" cy="80" r="9" fill="#CFC4BD" stroke="#120C0C" strokeWidth="4" />
      </g>
    </svg>
  );
}

function EscenaEntregado() {
  return (
    <svg className="w-[200px] h-[200px] overflow-visible" viewBox="0 0 200 200" aria-hidden="true">
      <path className="seg-brillo" d="M40 56l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill="#FFB02E" />
      <path className="seg-brillo seg-brillo-b2" d="M160 48l3.5 9 9 3.5-9 3.5-3.5 9-3.5-9-9-3.5 9-3.5z" fill="#E5212E" />
      <path className="seg-brillo seg-brillo-b3" d="M164 104l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#FFB02E" />
      <path className="seg-vapor" d="M84 92q-5-8 0-16t0-16" fill="none" stroke="#CFC4BD" strokeWidth="4.5" strokeLinecap="round" />
      <path className="seg-vapor seg-vapor-v2" d="M112 88q-5-8 0-16t0-16" fill="none" stroke="#CFC4BD" strokeWidth="4.5" strokeLinecap="round" />
      <g className="seg-plato">
        <ellipse cx="100" cy="160" rx="72" ry="9" fill="#000" opacity="0.18" />
        <ellipse cx="100" cy="140" rx="74" ry="22" fill="#FFF4E6" stroke="#120C0C" strokeWidth="4" />
        <ellipse cx="100" cy="136" rx="52" ry="13" fill="#E6D6C4" />
        <ellipse cx="82" cy="126" rx="24" ry="10" fill="#1FA65A" />
        <ellipse cx="118" cy="126" rx="24" ry="10" fill="#1FA65A" />
        <rect x="86" y="110" width="16" height="14" rx="3" fill="#8D0B14" />
        <rect x="104" y="112" width="16" height="14" rx="3" fill="#8D0B14" />
        <circle cx="70" cy="122" r="8" fill="#FFF4E6" />
        <circle cx="70" cy="122" r="3.5" fill="#FFB02E" />
        <circle cx="130" cy="122" r="8" fill="#FFF4E6" />
        <circle cx="130" cy="122" r="3.5" fill="#FFB02E" />
      </g>
    </svg>
  );
}

function EscenaCancelado() {
  return (
    <svg className="w-[200px] h-[200px] overflow-visible" viewBox="0 0 200 200" aria-hidden="true">
      <ellipse cx="100" cy="168" rx="56" ry="8" fill="#000" opacity="0.18" />
      <rect x="56" y="150" width="88" height="14" rx="7" fill="#120C0C" />
      <rect x="97" y="44" width="6" height="110" rx="3" fill="#CFC4BD" />
      <g transform="rotate(-6 100 100)">
        <path
          d="M62 52h76v86l-7.6-6-7.6 6-7.6-6-7.6 6-7.6-6-7.6 6-7.6-6-7.6 6-7.6-6-7.6 6z"
          fill="#FFF4E6"
          stroke="#120C0C"
          strokeWidth="3.5"
          strokeLinejoin="round"
        />
        <rect x="62" y="52" width="76" height="16" fill="#8D0B14" />
        <path d="M74 84h52M74 98h38M74 112h46" stroke="#8D0B14" strokeWidth="5" strokeLinecap="round" strokeDasharray="4 4" />
        <circle cx="100" cy="76" r="4" fill="#CFC4BD" />
      </g>
      <g>
        <circle cx="140" cy="128" r="20" fill="#8D0B14" stroke="#120C0C" strokeWidth="4" />
        <path d="M130 118l20 20M150 118l-20 20" fill="none" stroke="#FFF" strokeWidth="4.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function IlustracionEstado({ estado, esFondoRojo = false }) {
  const norm = String(estado || '').trim().toLowerCase();

  let escena = <EscenaRecibido />;
  if (norm === 'en_preparacion' || norm === 'preparando') {
    escena = <EscenaPreparando />;
  } else if (norm === 'listo') {
    escena = <EscenaListo />;
  } else if (norm === 'entregado' || norm === 'pagado') {
    escena = <EscenaEntregado />;
  } else if (norm === 'cancelado') {
    escena = <EscenaCancelado />;
  }

  return (
    <div
      aria-hidden="true"
      className="relative w-[226px] h-[226px] mx-auto rounded-full bg-papel shadow-[0_22px_30px_-16px_rgba(0,0,0,0.6)] flex items-center justify-center"
    >
      <div
        className={`absolute -inset-3 rounded-full border-[3px] border-dashed ${
          esFondoRojo ? 'border-papel opacity-75' : 'border-carbon opacity-50'
        } seg-gira pointer-events-none`}
      />
      {escena}
    </div>
  );
}
