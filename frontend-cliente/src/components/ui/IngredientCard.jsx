import { formatearPrecio } from '../../utils/formato';
import Imagen from './Imagen';

/**
 * Tarjeta interactiva para seleccionar un ingrediente en el constructor de platos.
 *
 * Props:
 * - nombre: nombre del ingrediente
 * - imagen: URL de la foto del ingrediente
 * - precioExtra: valor adicional en COP (0 si está incluido)
 * - calorias: cantidad de calorías (kcal)
 * - seleccionado: booleano que indica si el ingrediente está activo
 * - disabled: booleano que indica si el ingrediente está agotado
 * - onToggle: función llamada al activar/desactivar el ingrediente
 * - onClick: alias opcional de onToggle
 * - className: clases adicionales de Tailwind CSS
 */
function IngredientCard({
  nombre,
  imagen,
  precioExtra = 0,
  calorias,
  seleccionado = false,
  disabled = false,
  onToggle,
  onClick,
  className = '',
}) {
  const manejarAccion = () => {
    if (disabled) return;
    if (onToggle) {
      onToggle(!seleccionado);
    } else if (onClick) {
      onClick(!seleccionado);
    }
  };

  const manejarTeclado = (e) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      manejarAccion();
    }
  };

  return (
    <div
      role="checkbox"
      aria-checked={seleccionado}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={manejarAccion}
      onKeyDown={manejarTeclado}
      className={`relative flex items-center gap-3.5 p-3 rounded-2xl border-2 bg-white transition-all select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
        disabled
          ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
          : seleccionado
            ? 'border-primary bg-primary/10 shadow-sm cursor-pointer'
            : 'border-gray-200 hover:border-primary/40 cursor-pointer'
      } ${className}`.trim()}
    >
      {/* Foto circular */}
      <Imagen
        src={imagen}
        alt={nombre || 'Ingrediente'}
        aspecto="1/1"
        className={`w-16 h-16 rounded-full shrink-0 border border-gray-200 ${
          disabled ? 'grayscale' : ''
        }`.trim()}
      />

      {/* Información del ingrediente */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-bold text-cafe truncate">{nombre}</h3>
          {disabled && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-200 text-gray-700">
              Agotado
            </span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs text-gray-600 flex-wrap">
          <span className="font-semibold text-cafe">
            {precioExtra > 0 ? `+${formatearPrecio(precioExtra)}` : 'Incluido'}
          </span>
          {calorias !== undefined && calorias !== null && (
            <>
              <span aria-hidden="true">•</span>
              <span>{calorias} kcal</span>
            </>
          )}
        </div>
      </div>

      {/* Indicador visual de selección (Check) */}
      <div
        aria-hidden="true"
        className={`w-6 h-6 rounded-full flex items-center justify-center border-2 shrink-0 transition-colors ${
          seleccionado && !disabled
            ? 'bg-primary border-primary text-white'
            : 'border-gray-300 bg-white text-transparent'
        }`}
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    </div>
  );
}

export default IngredientCard;
