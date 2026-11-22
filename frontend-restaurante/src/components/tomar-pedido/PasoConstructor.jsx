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
    <section aria-labelledby={`paso-titulo-${paso.id_paso}`} className="cm-paso">
      <div className="cm-paso-cabeza">
        <div>
          <h3
            id={`paso-titulo-${paso.id_paso}`}
            className="cm-paso-titulo"
          >
            {paso.nombre}
          </h3>
          <p className="cm-paso-regla">
            {obtenerTextoRegla(paso)}
          </p>
          {maxAlcanzado && (
            <p className="cm-paso-maximo">
              Máximo alcanzado: desmarca una opción para cambiarla
            </p>
          )}
        </div>

        <span
          className={esObligatorio ? 'cm-obligatorio cm-obligatorio-si' : 'cm-obligatorio'}
        >
          {esObligatorio ? 'Obligatorio' : 'Opcional'}
        </span>
      </div>

      <div className="cm-ingredientes">
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
              className={`cm-ingrediente${seleccionado ? ' cm-ingrediente-elegido' : ''}${deshabilitado ? ' cm-ingrediente-bloqueado' : ''}`}
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
                className={deshabilitado ? 'cm-ingrediente-fila cm-ingrediente-fila-bloqueada' : 'cm-ingrediente-fila'}
              >
                <div className="cm-ingrediente-izq">
                  <div
                    className={seleccionado ? 'cm-casilla cm-casilla-marcada' : 'cm-casilla'}
                  >
                    {seleccionado && <Check size={14} />}
                  </div>

                  <div>
                    <strong className="cm-ingrediente-nombre">
                      {ingrediente.nombre}
                    </strong>
                    {agotado && (
                      <span className="cm-ingrediente-agotado">
                        (Agotado)
                      </span>
                    )}
                  </div>
                </div>

                {Number(ingrediente.precio_extra) > 0 && (
                  <span className="cm-ingrediente-extra">
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
