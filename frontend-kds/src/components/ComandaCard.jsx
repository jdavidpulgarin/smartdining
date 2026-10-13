import { Clock, Hash, StickyNote, User } from 'lucide-react'
import { ingredientesPorPaso, minutosDeEspera } from '../lib/comandas'

/**
 * Tarjeta de una comanda.
 *
 * Sin botones todavia: mover de estado es D-09. Aqui solo se lee, y se lee de
 * lejos, asi que el plato y la cantidad son lo mas grande de la tarjeta.
 *
 * Tolera los dos origenes de datos: la API (mesa_numero, minutos) y el socket
 * (solo id_mesa). Y tolera que los items NO traigan comensal ni ingredientes,
 * que es como responde el backend hasta que entre el PR #32.
 */

/** La porcion solo se marca cuando no es la normal: es la que no sorprende. */
const ESTILO_PORCION = {
  extra: 'bg-[color:var(--color-preparacion)]/20 text-[color:var(--color-preparacion)]',
  ligera: 'bg-[color:var(--color-nuevas)]/20 text-[color:var(--color-nuevas)]',
  normal: 'text-[color:var(--color-texto-suave)]',
}

function Ingredientes({ item }) {
  const grupos = ingredientesPorPaso(item)
  if (grupos.length === 0) return null

  return (
    <ul className="mt-2 space-y-1 border-l-2 border-[color:var(--color-borde)] pl-3">
      {grupos.map((grupo) => (
        <li key={grupo.paso} className="text-base leading-snug">
          <span className="text-[color:var(--color-texto-suave)]">{grupo.paso}: </span>
          {grupo.ingredientes.map((ing, indice) => (
            <span key={ing.id_ingrediente ?? `${grupo.paso}-${indice}`}>
              {indice > 0 && <span className="text-[color:var(--color-texto-suave)]"> · </span>}
              <span>{ing.nombre}</span>
              {ing.porcion && ing.porcion !== 'normal' && (
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 text-sm font-semibold uppercase ${
                    ESTILO_PORCION[ing.porcion] || ESTILO_PORCION.normal
                  }`}
                >
                  {ing.porcion}
                </span>
              )}
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}

export default function ComandaCard({ comanda, ahora }) {
  const minutos = minutosDeEspera(comanda, ahora)
  // El socket no manda el numero de mesa: se cae al id, que al menos identifica.
  const mesa = comanda.mesa_numero ?? comanda.id_mesa ?? '—'

  return (
    <article className="rounded-xl border border-[color:var(--color-borde)] bg-[color:var(--color-panel-alto)] p-4 shadow-lg">
      <header className="flex items-start justify-between gap-3 border-b border-[color:var(--color-borde)] pb-3">
        <div>
          <p className="text-3xl font-bold leading-none">Mesa {mesa}</p>
          {comanda.codigo_pedido && (
            <p className="mt-1 flex items-center gap-1 text-sm text-[color:var(--color-texto-suave)]">
              <Hash size={14} aria-hidden="true" />
              {comanda.codigo_pedido}
            </p>
          )}
        </div>
        <p
          className="flex shrink-0 items-center gap-1 text-2xl font-semibold tabular-nums"
          title="Minutos desde que entró la comanda"
        >
          <Clock size={20} aria-hidden="true" />
          {minutos} min
        </p>
      </header>

      {comanda.notas_generales && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-[color:var(--color-alerta)]/15 p-2 text-base text-[color:var(--color-texto)]">
          <StickyNote size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{comanda.notas_generales}</span>
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {comanda.items.map((item, indice) => (
          <li key={item.id_detalle ?? `${comanda.id_pedido}-${indice}`}>
            <div className="flex items-baseline gap-2">
              <span className="min-w-10 rounded-lg bg-[color:var(--color-panel)] px-2 py-0.5 text-center text-2xl font-bold tabular-nums">
                {item.cantidad}
              </span>
              <span className="text-2xl font-semibold leading-tight">
                {item.plato_nombre || 'Plato sin nombre'}
              </span>
            </div>

            {item.comensal && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[color:var(--color-panel)] px-2 py-0.5 text-sm text-[color:var(--color-texto-suave)]">
                <User size={13} aria-hidden="true" />
                {item.comensal}
              </p>
            )}

            <Ingredientes item={item} />

            {item.notas_especiales && (
              <p className="mt-1 text-base font-medium text-[color:var(--color-preparacion)]">
                ⚠ {item.notas_especiales}
              </p>
            )}
          </li>
        ))}
      </ul>

      {comanda.items.length === 0 && (
        <p className="mt-3 text-base text-[color:var(--color-texto-suave)]">
          Esta comanda llegó sin ítems
        </p>
      )}
    </article>
  )
}
