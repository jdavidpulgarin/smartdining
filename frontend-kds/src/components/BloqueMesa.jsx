import { AlertCircle, CheckCheck, Clock, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'
import { preguntaTodoListo } from '../lib/bloques'
import { senalDeEsperaDeComanda, textoDeEspera } from '../lib/espera'
import ComandaCard from './ComandaCard'

/**
 * T10 · La tarjeta de una mesa: todos sus pedidos juntos.
 *
 * Cabecera grande ("Mesa N", que se lee desde el otro lado de la cocina) con
 * el tiempo de su pedido MÁS ANTIGUO, que es lo que lleva esperando la mesa, y
 * con el mismo semáforo que la tarjeta suelta. Debajo, cada pedido con su
 * comensal, su código, sus líneas, su estado y SUS botones: cada pedido avisa a
 * su comensal, así que cada uno conserva su propio estado.
 *
 * "Todo listo" lleva a 'listo' todo lo pendiente del bloque. El resultado y el
 * "corriendo" viven en el Tablero (no aquí) porque el bloque puede cambiar de
 * columna a mitad de camino, y al desmontarse se llevaría los fallos.
 */

const CHIP_ESPERA = {
  normal: 'bg-[color:var(--color-panel)] text-[color:var(--color-texto)]',
  neutro: 'bg-[color:var(--color-panel)] text-[color:var(--color-texto-suave)]',
  ambar: 'border-2 border-[color:var(--color-preparacion)] text-[color:var(--color-preparacion)]',
  rojo: 'bg-[color:var(--color-alerta)] text-white',
}

const BORDE_ESPERA = {
  ambar: 'var(--color-preparacion)',
  rojo: 'var(--color-alerta)',
}

export default function BloqueMesa({
  bloque,
  ahora,
  conectado,
  onAvanzar,
  todoListo = null,
  onTodoListo,
  onDescartarFallos,
}) {
  const [confirmando, setConfirmando] = useState(false)

  const corriendo = Boolean(todoListo?.corriendo)
  const fallidos = todoListo?.fallidos || []

  // El semáforo solo mientras la mesa tiene algo en la cocina; un bloque que
  // ya está entero en el pase va neutro, como la tarjeta suelta en Listas.
  const espera = senalDeEsperaDeComanda(bloque.pendientes > 0 ? 'recibido' : 'listo', bloque.minutos)
  const tituloReloj = espera.etiqueta
    ? `${espera.etiqueta}: el pedido más antiguo lleva ${textoDeEspera(bloque.minutos)}`
    : `El pedido más antiguo se hizo hace ${textoDeEspera(bloque.minutos)}`

  const conBoton = bloque.conMesa && bloque.pendientes > 0

  function confirmar() {
    setConfirmando(false)
    onTodoListo?.(bloque)
  }

  return (
    <article
      className="rounded-xl border-2 bg-[color:var(--color-panel-alto)] p-3 shadow-lg"
      style={{ borderColor: BORDE_ESPERA[espera.nivel] || 'var(--color-borde)' }}
      aria-label={bloque.titulo}
    >
      <header className="flex items-start justify-between gap-3 px-1 pb-3">
        <div>
          <h3 className="display text-5xl font-bold leading-none">{bloque.titulo}</h3>
          {bloque.conMesa && (
            <p className="mt-1.5 text-base leading-none text-[color:var(--color-texto-suave)]">
              {bloque.comandas.length} {bloque.comandas.length === 1 ? 'pedido' : 'pedidos'}
            </p>
          )}
        </div>
        <p
          className={`display flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1 text-3xl font-bold tabular-nums ${CHIP_ESPERA[espera.nivel]}`}
          title={tituloReloj}
        >
          <Clock size={24} aria-hidden="true" />
          {textoDeEspera(bloque.minutos)}
          <span className="sr-only">{tituloReloj}</span>
        </p>
      </header>

      {conBoton && !confirmando && (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          disabled={corriendo}
          className="display mb-3 flex h-16 w-full items-center justify-center gap-2 rounded-xl text-2xl font-bold disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-listas)', color: 'var(--color-fondo)' }}
        >
          {corriendo ? (
            <LoaderCircle size={26} className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCheck size={26} aria-hidden="true" />
          )}
          {corriendo ? 'Marcando…' : 'Todo listo'}
        </button>
      )}

      {/* La confirmación va en la propia tarjeta y no en un confirm() del
          navegador: en la tablet de cocina queda donde se está mirando, con
          botones del mismo tamaño que el resto. */}
      {conBoton && confirmando && (
        <div
          role="alertdialog"
          aria-label="Confirmar todo listo"
          className="mb-3 rounded-xl border-2 border-[color:var(--color-listas)] p-3"
        >
          <p className="display text-2xl font-bold leading-tight">{preguntaTodoListo(bloque)}</p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={confirmar}
              className="display h-14 flex-1 rounded-xl text-xl font-bold"
              style={{ backgroundColor: 'var(--color-listas)', color: 'var(--color-fondo)' }}
            >
              Sí, marcar listos
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="display h-14 flex-1 rounded-xl border-2 border-[color:var(--color-borde)] text-xl font-bold"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {fallidos.length > 0 && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-[color:var(--color-alerta)]/20 p-3 text-[color:var(--color-alerta)]"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-lg font-bold">
              <AlertCircle size={20} aria-hidden="true" />
              {fallidos.length === 1
                ? 'Un pedido no se pudo marcar listo'
                : `${fallidos.length} pedidos no se pudieron marcar listos`}
            </p>
            <button
              type="button"
              onClick={() => onDescartarFallos?.(bloque.clave)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
              aria-label="Cerrar aviso"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <ul className="mt-1 space-y-1 text-base">
            {fallidos.map((f) => (
              <li key={f.id_pedido}>
                <span className="font-bold">{f.codigo_pedido || `Pedido ${f.id_pedido}`}</span>: {f.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {bloque.comandas.map((comanda) => (
          <ComandaCard
            key={comanda.id_pedido}
            comanda={comanda}
            ahora={ahora}
            conectado={conectado}
            onAvanzar={onAvanzar}
            enBloque
            bloqueado={corriendo}
          />
        ))}
      </div>
    </article>
  )
}
