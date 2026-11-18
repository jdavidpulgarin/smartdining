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
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '6px',
        padding: '4px',
        borderRadius: '8px',
        background: 'var(--sd-surface)',
        border: '1px solid var(--sd-border)',
        marginTop: '6px',
      }}
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
            style={{
              minHeight: '44px',
              padding: '6px 8px',
              borderRadius: '6px',
              fontSize: '0.78rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: activa ? '1px solid var(--sd-red)' : '1px solid transparent',
              background: activa ? 'var(--sd-red)' : 'transparent',
              color: activa ? '#fff' : 'var(--sd-text-muted)',
              transition: 'all 0.15s ease',
            }}
          >
            <span>{opcion.etiqueta}</span>
            {mostrarExtra && (
              <span style={{ fontSize: '0.7rem', fontWeight: 700, marginTop: '2px' }}>
                +${extraNum.toLocaleString('es-CO')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
