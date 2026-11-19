import { formatearPrecio } from '../../utils/formato';

/**
 * Barra inferior fija con resumen de precio total, calorías y slot para botones de acción (estilo comanda).
 *
 * Props:
 * - precioTotal: monto total en COP
 * - calorias: total de calorías acumuladas (kcal)
 * - etiquetaPrecio: texto descriptivo sobre el precio
 * - children: slot para los botones de acción
 * - className: clases adicionales de Tailwind CSS
 */
function BottomBar({
  precioTotal = 0,
  calorias,
  etiquetaPrecio,
  children,
  className = '',
}) {
  const textoCalorias =
    etiquetaPrecio ||
    (calorias !== undefined && calorias !== null ? `${calorias} kcal aprox.` : null);

  return (
    <div
      className={`fixed bottom-0 inset-x-0 z-40 bg-carbon text-ambar shadow-2xl border-t-2 border-carbon/80 pb-[env(safe-area-inset-bottom)] ${className}`.trim()}
    >
      <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          {textoCalorias && (
            <p className="text-xs text-ambar/75 font-cuerpo leading-tight truncate">
              {textoCalorias}
            </p>
          )}
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-3xl sm:text-4xl font-titulo text-ambar tracking-wide leading-none">
              {formatearPrecio(precioTotal)}
            </span>
          </div>
        </div>

        {children && <div className="shrink-0 flex items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

export default BottomBar;
