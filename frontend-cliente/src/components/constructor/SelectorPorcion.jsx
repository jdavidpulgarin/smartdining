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
      className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-superficie-2 border border-borde"
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
            className={`min-h-10 px-2 py-1.5 rounded-lg text-xs font-etiqueta uppercase tracking-wider font-bold flex flex-col items-center justify-center transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primario ${
              activa
                ? 'bg-primario text-white shadow-sm'
                : 'bg-transparent text-texto-suave hover:text-texto hover:bg-superficie'
            }`}
          >
            <span>{opcion.etiqueta}</span>
            {mostrarExtra && (
              <span
                className={`text-[11px] font-bold leading-tight ${
                  activa ? 'text-white/95' : 'text-primario-texto'
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
