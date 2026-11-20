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
  normal: 'tc-chip-normal',
  neutro: 'tc-chip-neutro',
  ambar: 'tc-chip-ambar',
  rojo: 'tc-chip-rojo',
}

/**
 * El nivel ya no pinta el borde de la tarjeta sino la cabecera entera del
 * ticket (tema-cocina.css). La clase sale del mismo espera.nivel que antes
 * elegía el borde; 'neutro' es el bloque que ya está entero en el pase.
 */
const NIVEL_TICKET = {
  normal: 'tc-nivel-normal',
  neutro: 'tc-nivel-neutro',
  ambar: 'tc-nivel-ambar',
  rojo: 'tc-nivel-rojo',
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
      className={`tc-ticket ${NIVEL_TICKET[espera.nivel] || ''}`}
      aria-label={bloque.titulo}
    >
      <header className="tc-ticket-cabecera">
        <div>
          <h3 className="display tc-ticket-mesa">{bloque.titulo}</h3>
          {bloque.conMesa && (
            <p className="tc-ticket-meta">
              {bloque.comandas.length} {bloque.comandas.length === 1 ? 'pedido' : 'pedidos'}
            </p>
          )}
        </div>
        <p
          className={`display tc-chip ${CHIP_ESPERA[espera.nivel]}`}
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
          className="display tc-accion tc-accion-listo"
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
          className="tc-confirmar"
        >
          <p className="display tc-confirmar-pregunta">{preguntaTodoListo(bloque)}</p>
          <div className="tc-confirmar-botones">
            <button
              type="button"
              onClick={confirmar}
              className="display tc-accion tc-accion-listo"
            >
              Sí, marcar listos
            </button>
            <button
              type="button"
              onClick={() => setConfirmando(false)}
              className="display tc-accion tc-accion-secundaria"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {fallidos.length > 0 && (
        <div
          role="alert"
          className="tc-alerta"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="tc-alerta-titulo">
              <AlertCircle size={20} aria-hidden="true" />
              {fallidos.length === 1
                ? 'Un pedido no se pudo marcar listo'
                : `${fallidos.length} pedidos no se pudieron marcar listos`}
            </p>
            <button
              type="button"
              onClick={() => onDescartarFallos?.(bloque.clave)}
              className="tc-alerta-cerrar"
              aria-label="Cerrar aviso"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <ul className="tc-alerta-lista">
            {fallidos.map((f) => (
              <li key={f.id_pedido}>
                <span className="font-bold">{f.codigo_pedido || `Pedido ${f.id_pedido}`}</span>: {f.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="tc-ticket-pedidos">
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
