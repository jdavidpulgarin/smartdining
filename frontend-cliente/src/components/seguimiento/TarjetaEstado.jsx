import IlustracionEstado from './IlustracionEstado';
import { infoEstado, mensajeEstadoTarjeta } from '../../utils/seguimiento';

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
 * Tarjeta principal del estado del pedido estilo comanda (J-07).
 *
 * Muestra:
 * - Pastilla carbón con texto ámbar y punto que late
 * - Código del pedido y hora de envío
 * - Disco crema con anillo punteado girando e ilustración vectorial animada
 * - Título grande en Bebas Neue con sombra brasa/carbón
 * - Ticket de papel crema "COCINA" con avatar de la mascota chef y mensaje en letra manuscrita
 */
export default function TarjetaEstado({ pedido, numeroMesa = null }) {
  if (!pedido) return null;

  const info = infoEstado(pedido.estado, numeroMesa);
  const mensajeTarjeta = mensajeEstadoTarjeta(pedido, numeroMesa);
  const hora = formatearHora(pedido.creado_en);

  const codigoRaw =
    pedido.codigo_pedido || (pedido.id_pedido ? `PED-${pedido.id_pedido}` : '');
  const codigo = codigoRaw
    ? codigoRaw.startsWith('#')
      ? codigoRaw
      : `#${codigoRaw}`
    : '';

  const normEstado = String(pedido.estado || '').toLowerCase();
  const esRojo = normEstado === 'en_preparacion' || normEstado === 'entregado';

  return (
    <section aria-live="polite" className="text-center pt-2">
      {/* Meta: chip carbón + código/hora */}
      <div className="flex items-center justify-center gap-3 flex-wrap mb-4">
        <span className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-titulo text-[19px] tracking-[0.12em] bg-carbon text-ambar shadow-sm">
          <i
            className="w-2.5 h-2.5 rounded-full bg-current seg-late"
            aria-hidden="true"
          />
          <span>{info.pill}</span>
        </span>
        <span
          className={`text-[13.5px] font-semibold transition-colors duration-500 ${
            esRojo ? 'text-papel' : 'text-carbon'
          }`}
        >
          {codigo}
          {hora ? ` · Enviado ${hora}` : ''}
        </span>
      </div>

      {/* Ilustración con disco crema y anillo rotatorio */}
      <IlustracionEstado estado={pedido.estado} esFondoRojo={esRojo} />

      {/* Título grande en Bebas Neue */}
      <h1
        className={`m-0 mt-6 font-titulo text-center text-[clamp(54px,16vw,84px)] leading-[0.88] uppercase tracking-wide anim-sube transition-all duration-500 ${
          esRojo
            ? 'text-papel [text-shadow:5px_5px_0_#120C0C]'
            : 'text-carbon [text-shadow:5px_5px_0_#E5212E]'
        }`}
      >
        {info.titulo}
      </h1>

      {/* Ticket de mensaje de cocina */}
      <div className="ticket-comanda mt-6 text-left anim-sube anim-sube-d1">
        <div className="banda-comanda flex justify-between items-center px-5 py-3">
          <span>COCINA</span>
          {hora && (
            <small className="font-cuerpo font-semibold text-xs tracking-normal text-[#E9C98A]">
              {hora}
            </small>
          )}
        </div>
        <div className="p-4 sm:p-5 flex items-center gap-4">
          <div className="w-[62px] h-[62px] rounded-full bg-brasa border-[3px] border-carbon grid place-items-center overflow-hidden shrink-0 shadow-inner">
            <img
              src="/img/mascota-chef.webp"
              alt=""
              aria-hidden="true"
              className="w-[58px] mt-2 pointer-events-none"
            />
          </div>
          <div className="flex-1 min-w-0">
            <small className="block font-titulo text-[17px] tracking-[0.18em] text-[#5B4A46] uppercase">
              COCINA
            </small>
            <p className="font-manuscrita text-2xl sm:text-[26px] leading-[1.12] text-carbon m-0 mt-0.5">
              {mensajeTarjeta}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
