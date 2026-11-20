import { AlertCircle, Check, Loader2, PackageX, X } from 'lucide-react'
import { motivoAgotado, rotuloDisponibilidad } from '../lib/agotados'

/**
 * Una fila de la seccion de PLATOS del panel de agotados (D-14).
 *
 * Gemela de FilaIngrediente y por las mismas razones: un <button> de verdad
 * (Enter y Espacio gratis, aria-pressed anuncia el estado), TODA la fila como
 * area tactil de 56 px porque esto se toca con guantes, y el estado nunca dicho
 * solo con color.
 *
 * Es una fila aparte y no la misma: lo que pasa al tocarla es otra ruta
 * (`PATCH /platos/:id/disponible`), agotar un plato entero es mas grave que
 * agotar un ingrediente, y aqui cabe la etiqueta del motivo. Compartirlas a la
 * fuerza acabaria en un componente con banderas.
 */
export default function FilaPlato({ plato, enVuelo, error, onConmutar, onDescartarError }) {
  const { id_plato: id, nombre, disponible } = plato
  const rotulo = rotuloDisponibilidad(disponible)

  // El motivo: 'stock' cuando lo agoto el inventario con el interruptor
  // encendido, null si lo apago la cocina (ver motivoAgotado en lib/agotados).
  const motivo = motivoAgotado(plato)

  // ISSUE #137: el boton conmuta SOLO el interruptor MANUAL, nunca el stock.
  // `disponible` es el efectivo (manual Y stock), asi que usarlo aqui mandaria
  // el valor equivocado en un plato encendido a mano y sin inventario: pediria
  // `true` cuando ya estaba en `true`, y el agotado no se podria reportar.
  const manual = plato.disponible_manual ?? disponible

  return (
    <li>
      <button
        type="button"
        onClick={() => onConmutar(id, !manual)}
        disabled={enVuelo}
        aria-pressed={!disponible}
        aria-label={`${nombre}: ${rotulo}${motivo === 'stock' ? ' por falta de inventario' : ''}. Toca para marcar como ${
          manual ? 'agotado' : 'disponible'
        }`}
        // Agotado o no sale de `disponible`, igual que antes: la clase
        // es-agotado pinta nombre, rotulo e interruptor (tema-cocina.css).
        className={disponible ? 'tc-fila' : 'tc-fila es-agotado'}
      >
        <span className="flex min-w-0 flex-col">
          <span className="tc-fila-nombre truncate">{nombre}</span>

          {/* El motivo del agotado, cuando el backend lo mande. Va debajo del
              nombre y no sustituye al rotulo: "Agotado" sigue siendo lo que hay
              que leer de un golpe, y el motivo es el detalle. */}
          {motivo === 'stock' && (
            <span className="tc-fila-motivo">
              <PackageX size={14} aria-hidden="true" />
              Agotado por stock
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span className="tc-fila-rotulo">{rotulo}</span>

          {/* aria-hidden: el estado ya lo dice aria-pressed del boton. */}
          <span aria-hidden="true" className="tc-fila-interruptor">
            {enVuelo ? (
              <Loader2 size={20} className="animate-spin motion-reduce:animate-none" />
            ) : disponible ? (
              <Check size={20} />
            ) : (
              <X size={20} />
            )}
          </span>
        </span>
      </button>

      {/* El error va DEBAJO DE SU FILA, con el texto que manda el backend. */}
      {error && (
        <p
          role="status"
          className="tc-fila-error"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => onDescartarError(id)}
            className="shrink-0 font-bold underline"
            aria-label={`Descartar el error de ${nombre}`}
          >
            Ok
          </button>
        </p>
      )}
    </li>
  )
}
