import { infoEstado } from '../../utils/seguimiento';

const PASOS = [
  { clave: 'recibido', label: 'RECIBIDO' },
  { clave: 'en_preparacion', label: 'EN PREPARACIÓN' },
  { clave: 'listo', label: 'LISTO' },
  { clave: 'entregado', label: 'EN TU MESA' },
];

/**
 * Línea de tiempo horizontal de 4 pasos para el seguimiento del pedido (J-07).
 *
 * Se oculta automáticamente para estados sin línea temporal (como 'cancelado').
 *
 * @param {object} props
 * @param {string} props.estado - Estado del pedido
 * @param {object} [props.info] - Metadatos opcionales de infoEstado
 */
export default function LineaTiempo({ estado, info: infoProp }) {
  const info = infoProp || infoEstado(estado);

  if (!info.conTimeline) return null;

  const idx = info.indicePaso; // 0: recibido, 1: en_preparacion, 2: listo, 3: entregado/pagado
  const anchoProgreso = `${(Math.max(0, Math.min(3, idx)) / 3) * 75}%`;

  return (
    <section className="bg-superficie border border-borde rounded-2xl p-4">
      <h2 className="m-0 mb-4 font-etiqueta font-bold text-[15px] tracking-wider text-white uppercase">
        Seguimiento del pedido
      </h2>
      <div className="relative">
        {/* Barra de fondo gris */}
        <div className="absolute left-[12.5%] right-[12.5%] top-[13px] h-[3px] bg-[#2A2A2A] rounded-full" />

        {/* Barra de progreso coloreada */}
        <div
          className="absolute left-[12.5%] top-[13px] h-[3px] rounded-full transition-[width] duration-700 ease-in-out"
          style={{
            backgroundColor: info.color,
            width: anchoProgreso,
          }}
        />

        {/* Pasos */}
        <ol className="list-none m-0 p-0 relative grid grid-cols-4 gap-0">
          {PASOS.map((paso, i) => {
            const hecho = i < idx || (i === idx && idx === 3);
            const enCurso = i === idx && idx !== 3;

            const fondo = hecho ? info.color : '#161616';
            const borde = hecho || enCurso ? info.color : '#3A3A3A';
            const texto = hecho || enCurso ? info.color : '#6B6B6B';

            return (
              <li key={paso.clave} className="flex flex-col items-center gap-2">
                <span
                  className="w-7 h-7 box-border rounded-full flex items-center justify-center transition-all duration-400"
                  style={{
                    backgroundColor: fondo,
                    border: `2px solid ${borde}`,
                  }}
                >
                  {hecho && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0B0B0B"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                  {enCurso && (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: borde }}
                    />
                  )}
                </span>
                <span
                  className="font-etiqueta font-semibold text-xs tracking-wider text-center"
                  style={{ color: texto }}
                >
                  {paso.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
