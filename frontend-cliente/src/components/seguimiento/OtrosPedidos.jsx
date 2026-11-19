import { infoEstado, haceCuanto } from '../../utils/seguimiento';

function obtenerIniciales(nombre) {
  if (!nombre || typeof nombre !== 'string') return 'M';
  const partes = nombre.trim().split(/\s+/);
  if (partes.length >= 2) {
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }
  return nombre.slice(0, 2).toUpperCase();
}

/**
 * Sección para listar otros pedidos de la mesa al estilo comanda (J-07).
 *
 * Recuadro crema translúcido con borde punteado carbón e iniciales del comensal.
 */
export default function OtrosPedidos({ pedidos = [] }) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    return null;
  }

  const cantComensales = pedidos.length;

  return (
    <section className="mt-6 border-[3px] border-dashed border-carbon rounded-[18px] p-4 bg-papel/65 anim-sube">
      <div className="flex justify-between items-center mb-3">
        <h2 className="m-0 font-titulo text-xl tracking-[0.08em] text-carbon uppercase">
          OTROS PEDIDOS DE LA MESA
        </h2>
        <small className="font-cuerpo font-bold text-xs text-[#5B4A46] uppercase">
          {cantComensales} {cantComensales === 1 ? 'COMENSAL' : 'COMENSALES'}
        </small>
      </div>

      <div className="flex flex-col gap-2.5">
        {pedidos.map((pedido, idx) => {
          const info = infoEstado(pedido.estado);
          const comensal =
            pedido.detalles?.find((d) => d.comensal)?.comensal ||
            pedido.comensal ||
            'Mesa';

          const resumenItems =
            pedido.detalles && pedido.detalles.length > 0
              ? pedido.detalles
                  .map((d) => `${d.cantidad} × ${d.plato_nombre || d.nombre}`)
                  .join(', ')
              : 'Pedido';

          const codigoRaw =
            pedido.codigo_pedido ||
            (pedido.id_pedido ? `PED-${pedido.id_pedido}` : '');
          const codigo = codigoRaw
            ? codigoRaw.startsWith('#')
              ? codigoRaw
              : `#${codigoRaw}`
            : '';
          const tiempo = haceCuanto(pedido.creado_en);
          const iniciales = obtenerIniciales(comensal);

          return (
            <div
              key={pedido.id_pedido ?? idx}
              className="flex items-center justify-between gap-3 bg-papel p-3 rounded-xl shadow-sm border border-[#E6D6C4]"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="w-9 h-9 rounded-full bg-carbon text-ambar flex items-center justify-center font-bold text-sm shrink-0"
                  aria-hidden="true"
                >
                  {iniciales}
                </span>
                <div className="min-w-0">
                  <b className="block text-sm text-carbon font-bold truncate">
                    {comensal}
                  </b>
                  <div className="text-xs text-[#5B4A46] truncate">
                    {resumenItems} · {codigo}
                    {tiempo ? ` · ${tiempo}` : ''}
                  </div>
                </div>
              </div>

              <span
                className="font-titulo text-base tracking-[0.08em] shrink-0 uppercase"
                style={{ color: info.color }}
              >
                {info.pill}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
