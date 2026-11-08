import { AlertCircle, RefreshCw, Search, WifiOff, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  avisoDelPanel,
  avisoDelPanelPlatos,
  contarPlatosAgotados,
  filtrar,
  filtrarPlatos,
  motivoListaVacia,
  motivoListaVaciaPlatos,
} from '../lib/agotados'
import FilaIngrediente from './FilaIngrediente'
import FilaPlato from './FilaPlato'

/**
 * Panel de agotados: ingredientes (D-10) y platos (D-14). Cajon lateral sobre
 * el tablero.
 *
 * Cajon y no pagina aparte: agotar algo pasa EN MEDIO del servicio, mirando las
 * comandas. Sacar al cocinero del tablero para apagar un ingrediente seria
 * perder de vista justo lo que esta cocinando.
 *
 * Las dos listas van en SECCIONES con un selector, no una debajo de la otra:
 * son casi 40 ingredientes y la carta entera de platos, y apiladas obligarian a
 * desplazarse media pantalla para llegar a los platos. Cada seccion mantiene su
 * propio aviso (puede fallar una y no la otra) y comparte el buscador y el
 * filtro, que es lo que el cocinero acaba de escribir.
 *
 * Accesibilidad: role="dialog" con aria-modal, el foco entra al buscador al
 * abrir, Esc cierra, el tabulador no se escapa del cajon y al cerrar el foco
 * VUELVE al boton que lo abrio (si no, quien navega con teclado queda perdido
 * al principio de la pagina). El selector es un tablist de verdad, para que un
 * lector de pantalla anuncie cuantas secciones hay y en cual esta.
 */

const MENSAJES_VACIO = {
  ingredientes: {
    vacio: 'Ningún plato de la carta tiene ingredientes configurados.',
    'sin-agotados': 'No hay ningún ingrediente agotado. Todo disponible.',
    'sin-resultados': (texto) => `Ningún ingrediente coincide con «${texto}».`,
  },
  platos: {
    vacio: 'La carta no tiene platos.',
    'sin-agotados': 'No hay ningún plato agotado. Toda la carta disponible.',
    'sin-resultados': (texto) => `Ningún plato coincide con «${texto}».`,
  },
}

const SECCIONES = [
  { id: 'ingredientes', rotulo: 'Ingredientes' },
  { id: 'platos', rotulo: 'Platos' },
]

export default function PanelAgotados({
  abierto,
  onCerrar,
  estado,
  conectado,
  onConmutar,
  onRecargar,
  onDescartarError,
  onConmutarPlato,
  onDescartarErrorPlato,
}) {
  const [texto, setTexto] = useState('')
  const [soloAgotados, setSoloAgotados] = useState(false)
  const [seccion, setSeccion] = useState('ingredientes')

  const cajon = useRef(null)
  const buscador = useRef(null)

  const enPlatos = seccion === 'platos'

  // Al abrir, el foco va al buscador. Con 39 ingredientes y un teclado, buscar
  // es mas rapido que tabular hasta la fila.
  useEffect(() => {
    if (abierto) buscador.current?.focus()
  }, [abierto])

  // Esc cierra, y el tabulador se queda dentro del cajon mientras esta abierto.
  useEffect(() => {
    if (!abierto) return undefined

    function alPulsar(evento) {
      if (evento.key === 'Escape') {
        evento.stopPropagation()
        onCerrar()
        return
      }
      if (evento.key !== 'Tab') return

      const enfocables = cajon.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled])'
      )
      if (!enfocables || enfocables.length === 0) return

      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]

      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault()
        primero.focus()
      }
    }

    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [abierto, onCerrar])

  const grupos = useMemo(
    () => (enPlatos ? [] : filtrar(estado, { texto, soloAgotados })),
    [enPlatos, estado, texto, soloAgotados]
  )
  const platos = useMemo(
    () => (enPlatos ? filtrarPlatos(estado, { texto, soloAgotados }) : []),
    [enPlatos, estado, texto, soloAgotados]
  )
  const motivoVacio = useMemo(
    () =>
      enPlatos
        ? motivoListaVaciaPlatos(estado, { texto, soloAgotados })
        : motivoListaVacia(estado, { texto, soloAgotados }),
    [enPlatos, estado, texto, soloAgotados]
  )

  const aviso = enPlatos ? avisoDelPanelPlatos(estado) : avisoDelPanel(estado)
  const errorDeLaSeccion = enPlatos ? estado.platos?.error : estado.error
  const mensajes = MENSAJES_VACIO[seccion]
  const platosAgotados = contarPlatosAgotados(estado)

  if (!abierto) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Tocar fuera cierra. Es un boton para que tambien funcione con teclado
          y lo anuncie un lector de pantalla. */}
      <button
        type="button"
        onClick={onCerrar}
        aria-label="Cerrar el panel de agotados"
        className="absolute inset-0 bg-black/60"
      />

      <aside
        ref={cajon}
        role="dialog"
        aria-modal="true"
        aria-label="Ingredientes y platos agotados"
        className={[
          'relative flex h-full w-full max-w-md flex-col border-l border-[color:var(--color-borde)]',
          // bg opaco, no translucido: detras puede haber la foto de fondo de la
          // cocina y un panel semitransparente volveria el texto ilegible.
          'bg-[color:var(--color-panel)] shadow-2xl',
          'motion-safe:animate-[entrar-cajon_180ms_ease-out] motion-reduce:animate-none',
        ].join(' ')}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--color-borde)] px-4 py-3">
          <h2 className="display text-2xl font-bold text-[color:var(--color-texto)]">Agotados</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRecargar}
              className="grid h-12 w-12 place-items-center rounded-xl border border-[color:var(--color-borde)] text-[color:var(--color-texto)]"
              aria-label="Actualizar las listas"
              title="Actualizar las listas"
            >
              <RefreshCw
                size={20}
                className={
                  estado.cargando || estado.platos?.cargando
                    ? 'animate-spin motion-reduce:animate-none'
                    : undefined
                }
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="grid h-12 w-12 place-items-center rounded-xl border border-[color:var(--color-borde)] text-[color:var(--color-texto)]"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Que se apaga: un ingrediente de un paso, o el plato entero. */}
        <div
          role="tablist"
          aria-label="Qué se agota"
          className="flex gap-2 border-b border-[color:var(--color-borde)] px-4 py-3"
        >
          {SECCIONES.map(({ id, rotulo }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={seccion === id}
              onClick={() => setSeccion(id)}
              className={[
                'min-h-12 flex-1 rounded-xl border px-3 text-base font-bold uppercase tracking-wide',
                seccion === id
                  ? 'border-[color:var(--color-texto)] bg-[color:var(--color-panel-alto)] text-[color:var(--color-texto)]'
                  : 'border-[color:var(--color-borde)] text-[color:var(--color-texto-suave)]',
              ].join(' ')}
            >
              {rotulo}
              {/* Solo en Platos y solo si hay alguno agotado: asi el cocinero ve
                  que hay algo que atender en la otra seccion sin entrar. */}
              {id === 'platos' && platosAgotados > 0 && (
                <span className="ml-2 rounded-full bg-[color:var(--color-alerta)] px-2 text-sm text-white">
                  {platosAgotados}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Sin socket el PATCH sigue funcionando (va por HTTP): lo que se pierde
            es ver lo que cambien OTRAS pantallas. Se dice sin alarmar. */}
        {!conectado && (
          <p className="flex items-start gap-2 border-b border-[color:var(--color-borde)] bg-[color:var(--color-panel-alto)] px-4 py-2 text-sm text-[color:var(--color-texto-suave)]">
            <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            Sin conexión en vivo: los cambios de otras pantallas no se verán hasta reconectar.
          </p>
        )}

        <div className="flex flex-col gap-2 border-b border-[color:var(--color-borde)] px-4 py-3">
          <label className="relative block">
            <span className="sr-only">{enPlatos ? 'Buscar plato' : 'Buscar ingrediente'}</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-texto-suave)]"
              aria-hidden="true"
            />
            <input
              ref={buscador}
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={enPlatos ? 'Buscar plato' : 'Buscar ingrediente'}
              className="min-h-12 w-full rounded-xl border border-[color:var(--color-borde)] bg-[color:var(--color-panel-alto)] pl-10 pr-3 text-lg text-[color:var(--color-texto)] placeholder:text-[color:var(--color-texto-suave)]"
            />
          </label>

          <button
            type="button"
            onClick={() => setSoloAgotados((v) => !v)}
            aria-pressed={soloAgotados}
            className={[
              'min-h-12 rounded-xl border px-4 text-base font-bold uppercase tracking-wide',
              soloAgotados
                ? 'border-[color:var(--color-alerta)] bg-[color:var(--color-alerta)] text-white'
                : 'border-[color:var(--color-borde)] text-[color:var(--color-texto)]',
            ].join(' ')}
          >
            Solo agotados
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {aviso === 'cargando' && (
            <ul
              className="flex flex-col gap-2"
              aria-busy="true"
              aria-label={enPlatos ? 'Cargando platos' : 'Cargando ingredientes'}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <li
                  key={i}
                  className="min-h-14 animate-pulse rounded-xl bg-[color:var(--color-panel-alto)] motion-reduce:animate-none"
                />
              ))}
            </ul>
          )}

          {aviso === 'prohibido' && (
            <p className="flex items-start gap-2 rounded-xl border border-[color:var(--color-alerta)] px-4 py-3 text-[color:var(--color-alerta)]">
              <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              Tu usuario no puede cambiar la disponibilidad. Avisa al administrador.
            </p>
          )}

          {aviso === 'error' && (
            <div className="rounded-xl border border-[color:var(--color-alerta)] px-4 py-3">
              <p className="flex items-start gap-2 text-[color:var(--color-alerta)]">
                <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                {errorDeLaSeccion}
              </p>
              <button
                type="button"
                onClick={onRecargar}
                className="mt-3 min-h-12 w-full rounded-xl bg-[color:var(--color-alerta)] px-4 font-bold uppercase tracking-wide text-white"
              >
                Reintentar
              </button>
            </div>
          )}

          {!aviso && motivoVacio && (
            <div className="py-6 text-center text-[color:var(--color-texto-suave)]">
              <p>
                {motivoVacio === 'sin-resultados'
                  ? mensajes['sin-resultados'](texto)
                  : mensajes[motivoVacio]}
              </p>
              {motivoVacio === 'sin-resultados' && (
                <button
                  type="button"
                  onClick={() => {
                    setTexto('')
                    setSoloAgotados(false)
                    buscador.current?.focus()
                  }}
                  className="mt-3 min-h-12 rounded-xl border border-[color:var(--color-borde)] px-4 font-bold text-[color:var(--color-texto)]"
                >
                  Limpiar la búsqueda
                </button>
              )}
            </div>
          )}

          {!aviso && !motivoVacio && enPlatos && (
            <ul className="flex flex-col gap-2">
              {platos.map((plato) => (
                <FilaPlato
                  // Por id_plato, nunca por nombre.
                  key={plato.id_plato}
                  plato={plato}
                  enVuelo={Object.hasOwn(estado.platos.enVuelo, String(plato.id_plato))}
                  error={estado.platos.errores[String(plato.id_plato)]}
                  onConmutar={onConmutarPlato}
                  onDescartarError={onDescartarErrorPlato}
                />
              ))}
            </ul>
          )}

          {!aviso && !motivoVacio && !enPlatos && (
            <div className="flex flex-col gap-5">
              {grupos.map((grupo) => (
                <section key={grupo.id_plato}>
                  <h3 className="display text-xl font-bold text-[color:var(--color-texto)]">
                    {grupo.plato}
                  </h3>
                  {grupo.pasos.map((paso) => (
                    <div key={paso.id_paso} className="mt-2">
                      <h4 className="mb-1 text-sm font-bold uppercase tracking-wide text-[color:var(--color-texto-suave)]">
                        {paso.paso}
                      </h4>
                      <ul className="flex flex-col gap-2">
                        {paso.ingredientes.map((ing) => (
                          <FilaIngrediente
                            // Por id_ingrediente, nunca por nombre: en la carta
                            // hay nombres repetidos a proposito y son
                            // ingredientes distintos.
                            key={ing.id_ingrediente}
                            ingrediente={ing}
                            enVuelo={Object.hasOwn(estado.enVuelo, String(ing.id_ingrediente))}
                            error={estado.errores[String(ing.id_ingrediente)]}
                            onConmutar={onConmutar}
                            onDescartarError={onDescartarError}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
