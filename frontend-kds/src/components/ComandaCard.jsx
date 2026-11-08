import { Clock, FileText, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import {
  comensalesDeComanda,
  debeEsperarConexion,
  ingredientesPorPaso,
  siguientePaso,
} from '../lib/comandas'
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
    clase:
      'border border-[color:var(--color-borde)] text-[color:var(--color-texto-suave)] font-semibold',
  },
}

const COLOR_ESPERA = {
  normal: 'var(--color-texto-suave)',
  ambar: 'var(--color-preparacion)',
  rojo: 'var(--color-alerta)',
  neutro: 'var(--color-texto-suave)',
}

/**
 * El chip del reloj. El rojo va relleno y no solo con borde: una comanda
 * atrasada tiene que encontrarse barriendo la pantalla con la vista, sin leer.
 */
const CHIP_ESPERA = {
  normal: 'bg-[color:var(--color-panel)] text-[color:var(--color-texto)]',
  neutro: 'bg-[color:var(--color-panel)] text-[color:var(--color-texto-suave)]',
  ambar: 'border-2 border-[color:var(--color-preparacion)] text-[color:var(--color-preparacion)]',
  rojo: 'bg-[color:var(--color-alerta)] text-white',
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
                  <span className={`display ml-1 rounded px-1.5 py-0.5 text-sm ${marca.clase}`}>
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

export default function ComandaCard({ comanda, ahora, conectado = true, onAvanzar }) {
  const [enVuelo, setEnVuelo] = useState(false)
  const [error, setError] = useState(null)
  const [ultimoFallo, setUltimoFallo] = useState(null)

  // Derivado, no guardado: en cuanto vuelve el tiempo real el boton vuelve
  // solo, sin un efecto que lo "despierte". La reconexion es la señal de que
  // la red esta otra vez, y nadie deberia tener que recargar para poder tocar.
  const esperandoConexion = debeEsperarConexion(ultimoFallo, conectado)

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
  const comensales = comensalesDeComanda(comanda)

  const tituloDelReloj = conSemaforo
    ? `${espera.etiqueta}: ${textoDeEspera(minutos)}`
    : tituloDelPase(enPase, minutos)

  async function alTocar() {
    if (enVuelo || !paso) return
    setEnVuelo(true)
    setError(null)
    setUltimoFallo(null)
    const resultado = await onAvanzar?.(comanda.id_pedido, paso.estado)
    // Si salió bien, la tarjeta se mueve de columna y este componente se
    // desmonta; dejar enVuelo en true evita un parpadeo del botón justo antes.
    if (!resultado?.ok) {
      setError(resultado?.mensaje || 'No se pudo cambiar el estado')
      setUltimoFallo(resultado)
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
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="display text-4xl font-bold leading-none">Mesa {mesa}</p>
          {(comanda.codigo_pedido || comensales.length > 0) && (
            <p className="mt-1.5 text-base leading-none text-[color:var(--color-texto-suave)]">
              {[comanda.codigo_pedido, comensales.join(', ')].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {/* El diseño señala el nivel solo con el color del chip; el texto sigue
            estando, en el title y para los lectores de pantalla, porque un
            monitor mal calibrado o quien no distingue rojo de ámbar se quedaría
            sin la única pista. */}
        <p
          className={`display flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1 text-2xl font-bold tabular-nums ${CHIP_ESPERA[espera.nivel]}`}
          title={tituloDelReloj}
        >
          <Clock size={20} aria-hidden="true" />
          {textoDeEspera(reloj.minutos)}
          {/* En el pase el reloj cuenta otra cosa, así que lo dice. */}
          {reloj.enPase && <span className="text-lg font-semibold">en pase</span>}
          <span className="sr-only">{tituloDelReloj}</span>
        </p>
      </header>

      {/* Los avisos van en ancho completo bajo la cabecera: es lo primero que
          se lee después del número de mesa, y es lo que decide qué se hace. */}
      {espera.nivel === 'rojo' && (
        <p className="display mt-3 rounded-lg bg-[color:var(--color-alerta)] px-3 py-1.5 text-lg font-bold text-white">
          {espera.etiqueta} · prioridad
        </p>
      )}

      {olvidada && (
        <p className="display mt-3 rounded-lg border-2 border-[color:var(--color-alerta)] px-3 py-1.5 text-lg font-bold text-[color:var(--color-alerta)]">
          {avisoSinRecoger(enPase, reloj.minutos)} · avisar al mesero
        </p>
      )}

      <ul className="mt-3 space-y-3 border-t border-[color:var(--color-borde)] pt-3">
        {comanda.items.map((item, indice) => (
          <li key={item.id_detalle ?? `${comanda.id_pedido}-${indice}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="display text-2xl font-bold text-[color:var(--color-marca)] tabular-nums">
                  {item.cantidad}×
                </span>
                <span className="display text-2xl font-bold leading-tight">
                  {item.plato_nombre || 'Plato sin nombre'}
                </span>
              </div>
              {item.comensal && (
                <span className="text-base text-[color:var(--color-texto-suave)]">
                  {item.comensal}
                </span>
              )}
            </div>

            <Ingredientes item={item} />

            {item.notas_especiales && (
              <p className="mt-2 flex items-start gap-2 rounded-lg border border-[color:var(--color-preparacion)] p-2 text-base font-semibold text-[color:var(--color-preparacion)]">
                <FileText size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{item.notas_especiales}</span>
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

      {/* La nota de la mesa va DEBAJO de los platos y pegada al botón: es lo
          último que hay que leer antes de darle, no un encabezado. */}
      {comanda.notas_generales && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-[color:var(--color-preparacion)] p-2.5 text-base">
          <FileText
            size={18}
            className="mt-0.5 shrink-0 text-[color:var(--color-preparacion)]"
            aria-hidden="true"
          />
          <span>{comanda.notas_generales}</span>
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

      {paso && esperandoConexion && (
        // El PATCH no llego al servidor y el tiempo real tampoco esta: tocar
        // otra vez solo repetiria el mismo fallo. En cuanto vuelva la conexion
        // este bloque se va solo y el boton vuelve.
        <p className="display mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[color:var(--color-borde)] text-xl font-bold text-[color:var(--color-texto-suave)]">
          <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />
          Esperando conexión…
        </p>
      )}

      {paso && !esperandoConexion && (
        <button
          type="button"
          onClick={alTocar}
          disabled={enVuelo}
          // 64 px de alto: objetivo tactil holgado para una pantalla de cocina.
          className="display mt-4 flex h-16 w-full items-center justify-center gap-2 rounded-xl text-2xl font-bold disabled:opacity-60"
          style={
            paso.estado === 'en_preparacion'
              ? { backgroundColor: 'var(--color-marca)', color: '#ffffff' }
              : { backgroundColor: 'var(--color-listas)', color: 'var(--color-fondo)' }
          }
        >
          {enVuelo && <LoaderCircle size={26} className="animate-spin" aria-hidden="true" />}
          {enVuelo ? 'Enviando…' : paso.etiqueta}
        </button>
      )}
    </article>
  )
}
