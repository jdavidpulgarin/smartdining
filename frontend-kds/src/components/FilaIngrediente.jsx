import { AlertCircle, Check, Loader2, X } from 'lucide-react'
import { rotuloDisponibilidad } from '../lib/agotados'

/**
 * Una fila del panel de agotados: el ingrediente y su interruptor.
 *
 * Es un <button> de verdad, no un div con onClick: asi Enter y Espacio
 * funcionan solos, entra en el orden de tabulacion y los lectores de pantalla
 * anuncian el estado con aria-pressed, sin que haya que programar nada de eso.
 *
 * TODA la fila es el area tactil (min-h-14, 56 px) y no solo el icono: esto se
 * toca con guantes, de pie y con prisa.
 *
 * El estado nunca se dice SOLO con color: va el texto ("Disponible"/"Agotado")
 * y un icono. En el tema claro y bajo las luces de una cocina, el color por si
 * solo no basta, y hay gente que no lo distingue.
 */
export default function FilaIngrediente({ ingrediente, enVuelo, error, onConmutar, onDescartarError }) {
  const { id_ingrediente: id, nombre, disponible } = ingrediente
  const rotulo = rotuloDisponibilidad(disponible)

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
        <span
          className={[
            'text-lg font-semibold',
            disponible
              ? 'text-[color:var(--color-texto)]'
              : 'text-[color:var(--color-texto-suave)] line-through',
          ].join(' ')}
        >
          {nombre}
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

          {/* Pastilla de interruptor. aria-hidden porque el estado ya lo dice
              aria-pressed del boton: anunciarlo dos veces sobra. */}
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

      {/* El error va DEBAJO DE SU FILA, no en un aviso global: es donde el
          cocinero esta mirando cuando acaba de tocar. El texto es el del
          backend, que esta escrito para leerse. */}
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
