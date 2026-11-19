import { formatearPrecio } from '../../utils/formato';
import Imagen from './Imagen';

/**
 * Tarjeta interactiva para seleccionar un ingrediente en el constructor de platos (estilo comanda).
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
      className={`relative flex items-center gap-3.5 p-3 rounded-xl border-2 bg-papel text-tinta transition-all select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa focus-visible:ring-offset-2 ${
        disabled
          ? 'border-carbon/25 opacity-40 cursor-not-allowed bg-papel/60'
          : seleccionado
            ? 'border-brasa ring-2 ring-brasa/20 cursor-pointer shadow-sm'
            : 'border-carbon hover:border-brasa/80 cursor-pointer shadow-sm'
      } ${className}`.trim()}
    >
      {/* Foto circular 56px */}
      <Imagen
        src={imagen}
        alt={nombre || 'Ingrediente'}
        aspecto="1/1"
        className={`w-14 h-14 rounded-full shrink-0 border border-papel-linea object-cover ${
          disabled ? 'grayscale' : ''
        }`.trim()}
      />

      {/* Información del ingrediente */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-xl font-titulo font-bold text-carbon uppercase tracking-wide truncate leading-tight">
            {nombre}
          </h3>
          {agotado && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-titulo font-bold uppercase tracking-wider bg-brasa/15 text-rojo-tinta border border-brasa/30">
              AGOTADO
            </span>
          )}
        </div>

        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-papel-suave flex-wrap font-cuerpo">
          {precioExtra > 0 ? (
            <span className="font-bold text-rojo-tinta font-titulo text-sm tracking-wide">
              Extra +{formatearPrecio(precioExtra)}
            </span>
          ) : (
            <span className="font-medium text-papel-suave">Incluido</span>
          )}
          {calorias !== undefined && calorias !== null && (
            <>
              <span aria-hidden="true" className="text-papel-linea">·</span>
              <span className="text-papel-suave">{calorias} kcal</span>
            </>
          )}
        </div>
      </div>

      {/* Indicador visual de selección (Check SVG) */}
      <div
        aria-hidden="true"
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          seleccionado && !disabled
            ? 'bg-carbon text-ambar border-2 border-carbon'
            : 'border-2 border-carbon/40 bg-transparent text-transparent'
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
