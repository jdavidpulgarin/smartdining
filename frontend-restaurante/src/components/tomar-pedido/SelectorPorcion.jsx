// Copiado desde frontend-cliente/src/components/constructor/SelectorPorcion.jsx
// Adaptado para frontend-restaurante en J-16

const OPCIONES_PORCION = [
  { valor: 'ligera', etiqueta: 'Ligera' },
  { valor: 'normal', etiqueta: 'Normal' },
  { valor: 'extra', etiqueta: 'Extra' },
]

export function SelectorPorcion({
  nombreIngrediente = 'ingrediente',
  porcionActual = 'normal',
  precioExtra = 0,
  onCambiar,
}) {
  const extraNum = Number(precioExtra) || 0

  return (
    <div
      role="radiogroup"
      aria-label={`Porción de ${nombreIngrediente}`}
      className="cm-porciones"
    >
      {OPCIONES_PORCION.map((opcion) => {
        const activa = porcionActual === opcion.valor
        const mostrarExtra = opcion.valor === 'extra' && extraNum > 0

        return (
          <button
            key={opcion.valor}
            type="button"
            role="radio"
            aria-checked={activa}
            onClick={() => onCambiar && onCambiar(opcion.valor)}
            className={activa ? 'cm-porcion cm-porcion-activa' : 'cm-porcion'}
          >
            <span>{opcion.etiqueta}</span>
            {mostrarExtra && (
              <span className="cm-porcion-extra">
                +${extraNum.toLocaleString('es-CO')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
