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

  // Hoy siempre null: el backend todavia no dice POR QUE esta agotado. Cuando
  // lo diga, la etiqueta aparece aqui sola (ver motivoAgotado en lib/agotados).
  const motivo = motivoAgotado(plato)

  return (
    <li>
      <button
        type="button"
        onClick={() => onConmutar(id, !disponible)}
        disabled={enVuelo}
        aria-pressed={!disponible}
        aria-label={`${nombre}: ${rotulo}. Toca para marcar como ${
          disponible ? 'agotado' : 'disponible'
        }`}
        className={[
          'flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left',
          'border-[color:var(--color-borde)] bg-[color:var(--color-panel-alto)]',
          'transition-colors disabled:opacity-60',
          disponible ? '' : 'border-[color:var(--color-alerta)]',
        ].join(' ')}
      >
        <span className="flex min-w-0 flex-col">
          <span
            className={[
              'truncate text-lg font-semibold',
              disponible
                ? 'text-[color:var(--color-texto)]'
                : 'text-[color:var(--color-texto-suave)] line-through',
            ].join(' ')}
          >
            {nombre}
          </span>

          {/* El motivo del agotado, cuando el backend lo mande. Va debajo del
              nombre y no sustituye al rotulo: "Agotado" sigue siendo lo que hay
              que leer de un golpe, y el motivo es el detalle. */}
          {motivo === 'stock' && (
            <span className="mt-0.5 flex items-center gap-1 text-sm font-bold uppercase tracking-wide text-[color:var(--color-alerta)]">
              <PackageX size={14} aria-hidden="true" />
              Agotado por stock
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span
            className={[
              'text-sm font-bold uppercase tracking-wide',
              disponible
                ? 'text-[color:var(--color-texto-suave)]'
                : 'text-[color:var(--color-alerta)]',
            ].join(' ')}
          >
            {rotulo}
          </span>

          {/* aria-hidden: el estado ya lo dice aria-pressed del boton. */}
          <span
            aria-hidden="true"
            className={[
              'grid h-10 w-10 place-items-center rounded-lg border',
              disponible
                ? 'border-[color:var(--color-borde)] text-[color:var(--color-texto)]'
                : 'border-[color:var(--color-alerta)] text-[color:var(--color-alerta)]',
            ].join(' ')}
          >
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
          className="mt-1 flex items-start gap-2 rounded-lg bg-[color:var(--color-alerta)]/15 px-3 py-2 text-sm text-[color:var(--color-alerta)]"
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
