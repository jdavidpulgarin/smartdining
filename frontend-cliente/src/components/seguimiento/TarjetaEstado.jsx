import IlustracionEstado from './IlustracionEstado';
import { infoEstado } from '../../utils/seguimiento';

/**
 * Formatea una fecha o timestamp a formato hh:mm a. m. / p. m.
 */
function formatearHora(fechaIso) {
  if (!fechaIso) return '';
  try {
    const fecha = new Date(fechaIso);
    if (Number.isNaN(fecha.getTime())) return '';
    return fecha.toLocaleTimeString('es-CO', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

/**
 * Tarjeta principal del estado del pedido (J-07).
 *
 * Muestra:
 * - Pill con el nombre del estado
 * - Código del pedido y hora de envío
 * - Ilustración vectorial animada con halo suave
 * - Título grande en Bebas Neue
 * - Burbuja "COCINA" con mensaje contextual
 */
export default function TarjetaEstado({ pedido, numeroMesa = null }) {
  if (!pedido) return null;

  const info = infoEstado(pedido.estado, numeroMesa);
  const hora = formatearHora(pedido.creado_en);

  const codigoRaw = pedido.codigo_pedido || (pedido.id_pedido ? `PED-${pedido.id_pedido}` : '');
  const codigo = codigoRaw ? (codigoRaw.startsWith('#') ? codigoRaw : `#${codigoRaw}`) : '';

  return (
    <section
      aria-live="polite"
      className="bg-superficie border border-borde rounded-3xl overflow-hidden"
    >
      <div className="flex items-center justify-between p-4 pb-0">
        <span
          className="font-etiqueta font-bold text-sm tracking-wider px-3 py-1.5 rounded-lg uppercase"
          style={{ backgroundColor: info.pillBg, color: info.pillTexto }}
        >
          {info.pill}
        </span>
        <span className="text-xs text-texto-suave">
          {codigo}
          {hora ? ` · Enviado ${hora}` : ''}
        </span>
      </div>

      <div
        className="h-[230px] flex items-center justify-center"
        style={{ background: info.halo }}
      >
        <IlustracionEstado estado={pedido.estado} numeroMesa={numeroMesa} />
      </div>

      <div className="px-5 pb-5 pt-1 flex flex-col items-center gap-3.5">
        <h1
          className="m-0 font-titulo font-normal text-5xl sm:text-[54px] leading-[0.95] tracking-wide text-center titulo-in"
          style={{ color: info.color }}
        >
          {info.titulo}
        </h1>

        <div className="w-full box-border flex items-center gap-3 bg-superficie-2 border border-borde rounded-2xl p-3 sm:p-3.5">
          <div className="w-10 h-10 shrink-0 rounded-full bg-primario flex items-center justify-center">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 14v5h10v-5" />
              <path d="M7 14a4 4 0 0 1-1.5-7.7A5 5 0 0 1 12 3a5 5 0 0 1 6.5 3.3A4 4 0 0 1 17 14" />
              <path d="M7 17h10" />
            </svg>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-etiqueta font-bold text-[13px] tracking-wider text-texto-suave">
              COCINA
            </span>
            <span className="text-[15px] text-white leading-snug">
              {info.mensaje}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
