import { infoEstado } from '../../utils/seguimiento';

const PASOS = [
  { clave: 'recibido', label: 'RECIBIDO' },
  { clave: 'en_preparacion', label: 'EN PREPARACIÓN' },
  { clave: 'listo', label: 'LISTO' },
  { clave: 'entregado', label: 'EN TU MESA' },
];

/**
 * Línea de tiempo horizontal de 4 pasos estilo comanda (J-07).
 *
 * Se oculta automáticamente para estados sin línea temporal (como 'cancelado').
 */
export default function LineaTiempo({ estado, info: infoProp }) {
  const info = infoProp || infoEstado(estado);

  if (!info.conTimeline) return null;

  const idx = info.indicePaso; // 0: recibido, 1: en_preparacion, 2: listo, 3: entregado/pagado
  const pctRelleno = `${(Math.max(0, Math.min(3, idx)) / 3) * 75}%`;

  return (
    <section className="ticket-comanda mt-6 anim-sube anim-sube-d2">
      <div className="banda-comanda flex justify-between items-center px-5 py-3">
        <span>SEGUIMIENTO</span>
        <small className="font-cuerpo font-semibold text-xs tracking-normal text-[#E9C98A]">
          4 PASOS
        </small>
      </div>

      <div className="p-5">
        <div className="relative">
          {/* Riel base */}
          <div className="absolute left-[12.5%] right-[12.5%] top-[22px] h-1.5 bg-[#E6D6C4] rounded-full" />

          {/* Relleno brasa completado */}
          <div
            className="absolute left-[12.5%] top-[22px] h-1.5 bg-brasa rounded-full transition-[width] duration-700 ease-in-out"
            style={{ width: pctRelleno }}
          />

          {/* Pasos */}
          <ol className="list-none m-0 p-0 relative grid grid-cols-4 text-center">
            {PASOS.map((paso, i) => {
              const hecho = i < idx || (i === idx && idx === 3);
              const enCurso = i === idx && idx !== 3;

              return (
                <li
                  key={paso.clave}
                  className="flex flex-col items-center gap-2 relative z-10"
                  aria-current={enCurso ? 'step' : undefined}
                >
                  <span
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-300 ${
                      hecho
                        ? 'bg-brasa border-4 border-brasa text-white shadow-sm'
                        : enCurso
                          ? 'bg-ambar border-4 border-carbon text-carbon shadow-[0_0_0_6px_rgba(18,12,12,0.12)]'
                          : 'bg-papel border-4 border-[#D3BFA9] text-transparent'
                    }`}
                  >
                    {hecho ? (
                      <svg
                        className="w-5 h-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : enCurso ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-carbon" />
                    ) : null}
                  </span>
                  <span
                    className={`font-titulo text-[15px] sm:text-base tracking-[0.06em] leading-tight ${
                      hecho || enCurso ? 'text-carbon font-normal' : 'text-[#5B4A46]'
                    }`}
                  >
                    {paso.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
