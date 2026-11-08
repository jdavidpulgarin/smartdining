import { formatearPrecio } from '../../utils/formato';
import Imagen from './Imagen';

/**
 * Tarjeta interactiva para seleccionar un ingrediente en el constructor de platos (tema oscuro).
 *
 * Props:
 * - nombre: nombre del ingrediente
 * - imagen: URL de la foto del ingrediente
 * - precioExtra: valor adicional en COP al elegir porción Extra (0 si está incluido)
 * - calorias: cantidad de calorías (kcal)
 * - seleccionado: booleano que indica si el ingrediente está activo
 * - disabled: booleano que indica si la tarjeta está deshabilitada
 * - agotado: booleano opcional que muestra la insignia "Agotado" (por defecto igual a disabled)
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
  agotado = disabled,
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
      className={`relative flex items-center gap-3.5 p-3 rounded-xl border bg-superficie transition-all select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primario-texto focus-visible:ring-offset-2 focus-visible:ring-offset-fondo ${
        disabled
          ? 'border-borde opacity-40 cursor-not-allowed'
          : seleccionado
            ? 'border-2 border-primario cursor-pointer'
            : 'border-borde hover:border-primario/60 cursor-pointer'
      } ${className}`.trim()}
    >
      {/* Foto circular 56px */}
      <Imagen
        src={imagen}
        alt={nombre || 'Ingrediente'}
        aspecto="1/1"
        className={`w-14 h-14 rounded-full shrink-0 border border-borde ${
          disabled ? 'grayscale' : ''
        }`.trim()}
      />

      {/* Información del ingrediente */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-etiqueta font-semibold text-texto uppercase tracking-wide truncate">
            {nombre}
          </h3>
          {agotado && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-etiqueta font-bold uppercase tracking-wider bg-primario/20 text-primario-texto border border-primario/30">
              AGOTADO
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-texto-suave flex-wrap font-cuerpo">
          {precioExtra > 0 ? (
            <span className="font-semibold text-primario-texto">
              Extra +{formatearPrecio(precioExtra)}
            </span>
          ) : (
            <span>Incluido</span>
          )}
          {calorias !== undefined && calorias !== null && (
            <>
              <span aria-hidden="true" className="text-texto-tenue">·</span>
              <span>{calorias} kcal</span>
            </>
          )}
        </div>
      </div>

      {/* Indicador visual de selección (Check SVG) */}
      <div
        aria-hidden="true"
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          seleccionado && !disabled
            ? 'bg-primario text-white'
            : 'border-2 border-borde bg-transparent text-transparent'
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
