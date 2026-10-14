import { formatearPrecio } from '../../utils/formato';

/**
 * Barra inferior fija con resumen de precio total, calorías y slot para botón de acción.
 *
 * Props:
 * - precioTotal: monto total en COP
 * - calorias: total de calorías acumuladas (kcal)
 * - etiquetaPrecio: texto descriptivo sobre el precio (por defecto 'Total estimado')
 * - children: slot para el botón de acción principal
 * - className: clases adicionales de Tailwind CSS
 */
function BottomBar({
  precioTotal = 0,
  calorias,
  etiquetaPrecio = 'Total estimado',
  children,
  className = '',
}) {
  return (
    <div
      className={`fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 shadow-lg pb-[env(safe-area-inset-bottom)] ${className}`.trim()}
    >
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-600">{etiquetaPrecio}</p>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold font-titulo text-cafe">
              {formatearPrecio(precioTotal)}
            </span>
            {calorias !== undefined && calorias !== null && (
              <span className="text-xs font-semibold text-gray-600">
                • {calorias} kcal
              </span>
            )}
          </div>
        </div>

        {children && <div className="shrink-0 flex items-center">{children}</div>}
      </div>
    </div>
  );
}

export default BottomBar;
