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
      className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-papel border-2 border-dashed border-papel-linea"
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
            className={`min-h-11 min-w-11 px-2 py-1.5 rounded-lg text-sm font-titulo uppercase tracking-wider font-bold flex flex-col items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brasa ${
              activa
                ? 'bg-carbon text-ambar shadow-sm'
                : 'bg-transparent text-papel-suave hover:text-carbon hover:bg-carbon/5'
            }`}
          >
            <span>{opcion.etiqueta}</span>
            {mostrarExtra && (
              <span
                className={`text-xs font-bold leading-tight font-titulo ${
                  activa ? 'text-ambar' : 'text-rojo-tinta'
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
