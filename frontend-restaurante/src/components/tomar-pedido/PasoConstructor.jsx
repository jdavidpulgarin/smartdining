// Copiado desde frontend-cliente/src/components/constructor/PasoConstructor.jsx
// Adaptado para frontend-restaurante en J-16

import { SelectorPorcion } from './SelectorPorcion'
import { Check } from 'lucide-react'

function obtenerTextoRegla(paso) {
  const min = Number(paso.min_sel) || 0
  const max = Number(paso.max_sel) || 0

  if (min > 0) {
    if (min === max) {
      return `Elige ${min}`
    }
    if (max > min) {
      return `Elige de ${min} a ${max}`
    }
    return `Elige al menos ${min}`
  }

  if (max > 0) {
    return `Opcional, hasta ${max}`
  }

  return 'Opcional'
}

export function PasoConstructor({ paso, seleccionesDelPaso = {}, despachador }) {
  if (!paso) return null

  const idsElegidos = Object.keys(seleccionesDelPaso)
  const cantidadElegida = idsElegidos.length
  const esUnica = Number(paso.max_sel) === 1
  const maxAlcanzado =
    !esUnica && Number(paso.max_sel) > 0 && cantidadElegida >= Number(paso.max_sel)
  const esObligatorio = Boolean(paso.obligatorio || Number(paso.min_sel) > 0)

  return (
    <section aria-labelledby={`paso-titulo-${paso.id_paso}`} style={{ marginBottom: '20px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '8px',
          marginBottom: '12px',
        }}
      >
        <div>
          <h3
            id={`paso-titulo-${paso.id_paso}`}
            style={{
              margin: '0 0 4px',
              fontSize: '1rem',
              color: 'var(--sd-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {paso.nombre}
          </h3>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--sd-text-muted)' }}>
            {obtenerTextoRegla(paso)}
          </p>
          {maxAlcanzado && (
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--sd-gold)' }}>
              Máximo alcanzado: desmarca una opción para cambiarla
            </p>
          )}
        </div>

        <span
          style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '4px',
            background: esObligatorio ? 'rgba(238, 28, 37, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: esObligatorio ? 'var(--sd-red)' : 'var(--sd-text-muted)',
            fontWeight: 600,
          }}
        >
          {esObligatorio ? 'Obligatorio' : 'Opcional'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(paso.ingredientes || []).map((ingrediente) => {
          const idIng = ingrediente.id_ingrediente
          const seleccionado = Object.prototype.hasOwnProperty.call(
            seleccionesDelPaso,
            idIng
          )
          const porcionElegida = seleccionesDelPaso[idIng] || 'normal'
          const agotado = ingrediente.disponible === false
          const deshabilitado = agotado || (maxAlcanzado && !seleccionado)

          return (
            <div
              key={idIng}
              style={{
                borderRadius: '8px',
                border: seleccionado
                  ? '1px solid var(--sd-red)'
                  : '1px solid var(--sd-border)',
                background: seleccionado
                  ? 'rgba(238, 28, 37, 0.08)'
                  : 'var(--sd-surface-2)',
                padding: '10px 12px',
                opacity: deshabilitado ? 0.45 : 1,
                transition: 'all 0.15s ease',
              }}
            >
              <div
                role="checkbox"
                aria-checked={seleccionado}
                aria-disabled={deshabilitado}
                tabIndex={deshabilitado ? -1 : 0}
                onClick={() => {
                  if (deshabilitado) return
                  despachador({
                    type: 'ALTERNAR_INGREDIENTE',
                    paso,
                    ingrediente,
                  })
                }}
                onKeyDown={(e) => {
                  if (deshabilitado) return
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault()
                    despachador({
                      type: 'ALTERNAR_INGREDIENTE',
                      paso,
                      ingrediente,
                    })
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: deshabilitado ? 'not-allowed' : 'pointer',
                  minHeight: '44px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      border: seleccionado ? '1px solid var(--sd-red)' : '1px solid var(--sd-border)',
                      background: seleccionado ? 'var(--sd-red)' : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                    }}
                  >
                    {seleccionado && <Check size={14} />}
                  </div>

                  <div>
                    <strong style={{ color: 'var(--sd-text)', fontSize: '0.9rem' }}>
                      {ingrediente.nombre}
                    </strong>
                    {agotado && (
                      <span
                        style={{
                          marginLeft: '8px',
                          color: 'var(--sd-red)',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        (Agotado)
                      </span>
                    )}
                  </div>
                </div>

                {Number(ingrediente.precio_extra) > 0 && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--sd-gold)' }}>
                    +${Number(ingrediente.precio_extra).toLocaleString('es-CO')}
                  </span>
                )}
              </div>

              {seleccionado && (
                <SelectorPorcion
                  nombreIngrediente={ingrediente.nombre}
                  porcionActual={porcionElegida}
                  precioExtra={ingrediente.precio_extra}
                  onCambiar={(nuevaPorcion) =>
                    despachador({
                      type: 'CAMBIAR_PORCION',
                      id_paso: paso.id_paso,
                      id_ingrediente: idIng,
                      porcion: nuevaPorcion,
                    })
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
