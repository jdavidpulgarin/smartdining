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
        // Agotado o no sale de `disponible`, igual que antes: la clase
        // es-agotado pinta nombre, rotulo e interruptor (tema-cocina.css).
        className={disponible ? 'tc-fila' : 'tc-fila es-agotado'}
      >
        <span className="tc-fila-nombre">{nombre}</span>

        <span className="flex shrink-0 items-center gap-2">
          <span className="tc-fila-rotulo">{rotulo}</span>

          {/* Pastilla de interruptor. aria-hidden porque el estado ya lo dice
              aria-pressed del boton: anunciarlo dos veces sobra. */}
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

      {/* El error va DEBAJO DE SU FILA, no en un aviso global: es donde el
          cocinero esta mirando cuando acaba de tocar. El texto es el del
          backend, que esta escrito para leerse. */}
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
