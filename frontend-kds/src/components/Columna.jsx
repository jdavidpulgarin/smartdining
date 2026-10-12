import ComandaCard from './ComandaCard'

/**
 * Una columna del tablero, con su contador y su estado vacio.
 *
 * El color es solo del encabezado: las tarjetas se quedan neutras para que lo
 * que resalte sea el contenido, y porque el semaforo de tiempos (que si pinta
 * tarjetas) es D-09.
 */

const COLOR = {
  recibido: 'var(--color-nuevas)',
  en_preparacion: 'var(--color-preparacion)',
  listo: 'var(--color-listas)',
}

export default function Columna({ estado, titulo, comandas, ahora, nota }) {
  const color = COLOR[estado] || 'var(--color-texto-suave)'

  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-xl bg-[color:var(--color-panel)]">
      <header
        className="flex items-center justify-between gap-2 rounded-t-xl border-b-4 px-4 py-3"
        style={{ borderColor: color }}
      >
        <h2 className="text-2xl font-bold uppercase tracking-wide" style={{ color }}>
          {titulo}
        </h2>
        <span
          className="min-w-10 rounded-full px-3 py-0.5 text-center text-xl font-bold tabular-nums text-[color:var(--color-fondo)]"
          style={{ backgroundColor: color }}
          aria-label={`${comandas.length} comandas`}
        >
          {comandas.length}
        </span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {comandas.length === 0 ? (
          <p className="mt-6 text-center text-lg text-[color:var(--color-texto-suave)]">
            Sin comandas
            {nota && <span className="mt-2 block text-base">{nota}</span>}
          </p>
        ) : (
          comandas.map((comanda) => (
            <ComandaCard key={comanda.id_pedido} comanda={comanda} ahora={ahora} />
          ))
        )}
      </div>
    </section>
  )
}
