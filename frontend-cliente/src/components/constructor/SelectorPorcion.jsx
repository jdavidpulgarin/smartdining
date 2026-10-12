import { formatearPrecio } from '../../utils/formato';

const OPCIONES_PORCION = [
  { valor: 'ligera', etiqueta: 'Ligera' },
  { valor: 'normal', etiqueta: 'Normal' },
  { valor: 'extra', etiqueta: 'Extra' },
];

function SelectorPorcion({
  nombreIngrediente = 'ingrediente',
  porcionActual = 'normal',
  precioExtra = 0,
  onCambiar,
}) {
  const extraNum = Number(precioExtra) || 0;

  return (
    <div
      role="radiogroup"
      aria-label={`Porción de ${nombreIngrediente}`}
      className="grid grid-cols-3 gap-1.5 p-1.5 rounded-xl bg-crema border border-cafe/15"
    >
      {OPCIONES_PORCION.map((opcion) => {
        const activa = porcionActual === opcion.valor;
        const mostrarExtra = opcion.valor === 'extra' && extraNum > 0;

        return (
          <button
            key={opcion.valor}
            type="button"
            role="radio"
            aria-checked={activa}
            onClick={() => onCambiar && onCambiar(opcion.valor)}
            className={`min-h-11 px-2 py-1.5 rounded-lg text-xs font-semibold flex flex-col items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
              activa
                ? 'bg-primary text-white shadow-sm'
                : 'bg-white text-cafe hover:bg-primary/10'
            }`}
          >
            <span>{opcion.etiqueta}</span>
            {mostrarExtra && (
              <span
                className={`text-[11px] font-bold leading-tight ${
                  activa ? 'text-white/95' : 'text-primary'
                }`}
              >
                +{formatearPrecio(extraNum)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SelectorPorcion;
