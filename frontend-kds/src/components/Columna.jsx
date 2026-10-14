import { ChefHat } from 'lucide-react'
import ComandaCard from './ComandaCard'

/**
 * Una columna del tablero, con su contador y su estado vacio.
 *
 * El color va en una regla arriba del encabezado y en el titulo; el contador
 * es neutro en las tres para que la cifra se lea igual de lejos sin que el
 * color le cambie el peso. Las tarjetas no se tinen de color de columna: lo
 * que las pinta es el semaforo de tiempos, y son dos cosas distintas.
 */

const COLOR = {
  recibido: 'var(--color-nuevas)',
  en_preparacion: 'var(--color-preparacion)',
  listo: 'var(--color-listas)',
}

export default function Columna({ estado, titulo, comandas, ahora, vacio, conectado, onAvanzar }) {
  const color = COLOR[estado] || 'var(--color-texto-suave)'

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header
        className="flex items-center justify-between gap-2 rounded-xl border-t-4 bg-[color:var(--color-panel)] px-4 py-3"
        style={{ borderColor: color }}
      >
        <h2 className="display text-3xl font-bold" style={{ color }}>
          {titulo}
        </h2>
        <span
          className="display min-w-11 rounded-lg bg-[color:var(--color-fondo)] px-3 py-1 text-center text-2xl font-bold tabular-nums"
          aria-label={`${comandas.length} comandas`}
        >
          {comandas.length}
        </span>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto pt-3">
        {comandas.length === 0 ? (
          // Caja punteada, no un parrafo suelto: deja claro que el hueco es el
          // sitio donde van a aparecer las comandas, y no un fallo de carga.
          <div className="rounded-xl border-2 border-dashed border-[color:var(--color-borde)] px-5 py-10 text-center">
            <ChefHat
              size={34}
              className="mx-auto mb-3 text-[color:var(--color-texto-suave)]"
              aria-hidden="true"
            />
            <p className="display text-xl font-bold">{vacio?.titulo || 'Sin comandas'}</p>
            {vacio?.nota && (
              <p className="mt-2 text-base text-[color:var(--color-texto-suave)]">{vacio.nota}</p>
            )}
          </div>
        ) : (
          comandas.map((comanda) => (
            <ComandaCard
              key={comanda.id_pedido}
              comanda={comanda}
              ahora={ahora}
              conectado={conectado}
              onAvanzar={onAvanzar}
            />
          ))
        )}
      </div>
    </section>
  )
}
