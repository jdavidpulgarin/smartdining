import { infoEstado, haceCuanto } from '../../utils/seguimiento';

/**
 * Sección compacta para listar otros pedidos realizados en la misma mesa (J-07).
 *
 * Muestra una fila por pedido con:
 * - Comensal e ítems resumidos (ej. "Ana · 1 × Alitas BBQ x8")
 * - Código y tiempo transcurrido (ej. "#PED-K3F9 · hace 6 min")
 * - Pill con el color y nombre del estado
 *
 * Si no hay otros pedidos, no se renderiza nada.
 *
 * @param {object} props
 * @param {Array<object>} props.pedidos - Lista de pedidos normalizados de otros comensales
 */
export default function OtrosPedidos({ pedidos = [] }) {
  if (!Array.isArray(pedidos) || pedidos.length === 0) {
    return null;
  }

  return (
    <section className="bg-superficie border border-borde rounded-2xl p-4 flex flex-col gap-3">
      <h2 className="m-0 font-etiqueta font-bold text-[15px] tracking-wider text-texto-suave uppercase">
        OTROS PEDIDOS DE LA MESA
      </h2>
      <div className="flex flex-col gap-3 divide-y divide-borde">
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

          return (
            <div
              key={pedido.id_pedido ?? idx}
              className="pt-3 first:pt-0 flex items-center justify-between gap-2.5"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] text-white truncate">
                  {comensal} · {resumenItems}
                </span>
                <span className="text-xs text-texto-tenue">
                  {codigo}
                  {tiempo ? ` · ${tiempo}` : ''}
                </span>
              </div>
              <span
                className="font-etiqueta font-bold text-xs tracking-wider px-2.5 py-1 rounded-lg shrink-0 whitespace-nowrap uppercase"
                style={{
                  backgroundColor: info.pillBg,
                  color: info.pillTexto,
                }}
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
