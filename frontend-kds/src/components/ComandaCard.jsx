import { AlertTriangle, Check, ChefHat, Clock, Hash, LoaderCircle, StickyNote, User } from 'lucide-react'
import { useState } from 'react'
import { ingredientesPorPaso, siguientePaso } from '../lib/comandas'
import { minutosDesdeCreacion, senalDeEsperaDeComanda, textoDeEspera } from '../lib/espera'
import {
  avisoSinRecoger,
  minutosDelReloj,
  minutosEnPase,
  sinRecoger,
  tituloDelPase,
} from '../lib/pase'

/**
 * Tarjeta de una comanda: lo que la cocina lee y toca.
 *
 * Se lee de lejos, así que el plato y la cantidad son lo más grande, y el botón
 * ocupa todo el ancho con 64 px de alto (bastante más que los 48 px mínimos de
 * un objetivo táctil: aquí se toca con prisa y a veces con el guante puesto).
 *
 * Tolera los dos orígenes de datos: la API (mesa_numero, creado_en) y el socket
 * (solo id_mesa), y también que los ítems NO traigan comensal ni ingredientes.
 */

/** Cómo se marca cada porción. 'normal' no se adorna: es la que no sorprende. */
const PORCIONES = {
  extra: {
    texto: 'EXTRA',
    clase: 'bg-[color:var(--color-preparacion)] text-[color:var(--color-fondo)] font-bold',
  },
  ligera: {
    texto: 'LIGERA',
    clase: 'bg-[color:var(--color-nuevas)]/25 text-[color:var(--color-nuevas)] font-semibold',
  },
}

const COLOR_ESPERA = {
  normal: 'var(--color-texto-suave)',
  ambar: 'var(--color-preparacion)',
  rojo: 'var(--color-alerta)',
  neutro: 'var(--color-texto-suave)',
}

function Ingredientes({ item }) {
  const grupos = ingredientesPorPaso(item)
  if (grupos.length === 0) return null

  return (
    <ul className="mt-2 space-y-1 border-l-2 border-[color:var(--color-borde)] pl-3">
      {grupos.map((grupo) => (
        <li key={grupo.paso} className="text-base leading-snug">
          <span className="text-[color:var(--color-texto-suave)]">{grupo.paso}: </span>
          {grupo.ingredientes.map((ing, indice) => {
            const marca = PORCIONES[ing.porcion]
            return (
              <span key={ing.id_ingrediente ?? `${grupo.paso}-${indice}`}>
                {indice > 0 && <span className="text-[color:var(--color-texto-suave)]"> · </span>}
                <span>{ing.nombre}</span>
                {marca && (
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-sm uppercase ${marca.clase}`}>
                    {marca.texto}
                  </span>
                )}
              </span>
            )
          })}
        </li>
      ))}
    </ul>
  )
}

export default function ComandaCard({ comanda, ahora, onAvanzar }) {
  const [enVuelo, setEnVuelo] = useState(false)
  const [error, setError] = useState(null)

  const minutos = minutosDesdeCreacion(comanda, ahora)
  // En Listas la señal es neutra: la comanda ya salió de la cocina.
  const espera = senalDeEsperaDeComanda(comanda.estado, minutos)
  const colorEspera = COLOR_ESPERA[espera.nivel]
  const conSemaforo = espera.nivel !== 'neutro'

  // En el pase se cuenta otro reloj: cuanto lleva HECHA sin que la recojan, y
  // es ese el que va en grande (el total queda en el tooltip).
  const enPase = comanda.estado === 'listo' ? minutosEnPase(comanda, ahora) : null
  const olvidada = comanda.estado === 'listo' && sinRecoger(comanda, ahora)
  const reloj = minutosDelReloj(comanda, minutos, ahora)

  // El socket no manda el numero de mesa: se cae al id, que al menos identifica.
  const mesa = comanda.mesa_numero ?? comanda.id_mesa ?? '—'
  const paso = siguientePaso(comanda.estado)

  async function alTocar() {
    if (enVuelo || !paso) return
    setEnVuelo(true)
    setError(null)
    const resultado = await onAvanzar?.(comanda.id_pedido, paso.estado)
    // Si salió bien, la tarjeta se mueve de columna y este componente se
    // desmonta; dejar enVuelo en true evita un parpadeo del botón justo antes.
    if (!resultado?.ok) {
      setError(resultado?.mensaje || 'No se pudo cambiar el estado')
      setEnVuelo(false)
    }
  }

  return (
    <article
      // Atenuada, no escondida: una comanda olvidada tiene que seguir viendose,
      // solo deja de competir por la atencion con las que acaban de salir.
      className={`rounded-xl border-2 bg-[color:var(--color-panel-alto)] p-4 shadow-lg${
        olvidada ? ' opacity-60' : ''
      }`}
      style={{
        borderColor:
          conSemaforo && espera.nivel !== 'normal' ? colorEspera : 'var(--color-borde)',
      }}
    >
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

        {/* El tiempo no se señala solo con color: lleva signo y texto, por si el
            monitor está mal calibrado o quien mira no distingue rojo de ámbar. */}
        <p
          className="flex shrink-0 flex-col items-end text-2xl font-semibold tabular-nums"
          style={{ color: colorEspera }}
          title={
            conSemaforo
              ? `${espera.etiqueta}: ${textoDeEspera(minutos)}`
              : tituloDelPase(enPase, minutos)
          }
        >
          <span className="flex items-center gap-1">
            <Clock size={20} aria-hidden="true" />
            {textoDeEspera(reloj.minutos)}
          </span>
          {conSemaforo && (
            <span className="text-sm font-bold uppercase tracking-wide">
              {espera.signo} {espera.etiqueta}
            </span>
          )}
          {/* Aviso para el mesero, sin rojo ni "retrasada": la cocina ya hizo
              su parte, esto es que nadie ha venido a recogerla. */}
          {olvidada && (
            <span className="text-sm font-semibold normal-case text-[color:var(--color-texto-suave)]">
              {avisoSinRecoger(enPase, reloj.minutos)}
            </span>
          )}
        </p>
      </header>

      {comanda.notas_generales && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-[color:var(--color-alerta)]/15 p-2 text-base">
          <StickyNote size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{comanda.notas_generales}</span>
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {comanda.items.map((item, indice) => (
          <li key={item.id_detalle ?? `${comanda.id_pedido}-${indice}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="min-w-10 rounded-lg bg-[color:var(--color-panel)] px-2 py-0.5 text-center text-2xl font-bold tabular-nums">
                {item.cantidad}
              </span>
              <span className="text-2xl font-semibold leading-tight">
                {item.plato_nombre || 'Plato sin nombre'}
              </span>
              {item.comensal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-panel)] px-2 py-0.5 text-base text-[color:var(--color-texto-suave)]">
                  <User size={14} aria-hidden="true" />
                  {item.comensal}
                </span>
              )}
            </div>

            <Ingredientes item={item} />

            {item.notas_especiales && (
              <p className="mt-1 flex items-start gap-1 text-base font-semibold text-[color:var(--color-preparacion)]">
                <AlertTriangle size={16} className="mt-1 shrink-0" aria-hidden="true" />
                {item.notas_especiales}
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

      {error && (
        <p
          className="mt-3 rounded-lg bg-[color:var(--color-alerta)]/20 p-2 text-base text-[color:var(--color-alerta)]"
          role="alert"
        >
          {error}
        </p>
      )}

      {paso && (
        <button
          type="button"
          onClick={alTocar}
          disabled={enVuelo}
          // 64 px de alto: objetivo tactil holgado para una pantalla de cocina.
          className="mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-xl text-2xl font-bold text-[color:var(--color-fondo)] disabled:opacity-60"
          style={{
            backgroundColor:
              paso.estado === 'en_preparacion'
                ? 'var(--color-preparacion)'
                : 'var(--color-listas)',
          }}
        >
          {enVuelo ? (
            <LoaderCircle size={26} className="animate-spin" aria-hidden="true" />
          ) : paso.estado === 'en_preparacion' ? (
            <ChefHat size={26} aria-hidden="true" />
          ) : (
            <Check size={26} aria-hidden="true" />
          )}
          {enVuelo ? 'Enviando…' : paso.etiqueta}
        </button>
      )}
    </article>
  )
}
