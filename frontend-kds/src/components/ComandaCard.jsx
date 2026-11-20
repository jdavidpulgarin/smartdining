import { Ban, Clock, FileText, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import {
  comensalesDeComanda,
  debeEsperarConexion,
  ingredientesPorPaso,
  lineaCancelada,
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
    clase: 'tc-marca-extra',
  },
  ligera: {
    texto: 'LIGERA',
    clase: 'tc-marca-ligera',
  },
}

/**
 * El chip del reloj. El rojo va relleno y no solo con borde: una comanda
 * atrasada tiene que encontrarse barriendo la pantalla con la vista, sin leer.
 */
const CHIP_ESPERA = {
  normal: 'tc-chip-normal',
  neutro: 'tc-chip-neutro',
  ambar: 'tc-chip-ambar',
  rojo: 'tc-chip-rojo',
}

/**
 * La marca del pedido en ámbar o rojo (barra a la izquierda en el ticket).
 * Antes era el color del borde, con la misma condición: hay semáforo y el
 * nivel no es 'normal'.
 */
const MARCA_ESPERA = {
  ambar: 'tc-pedido-ambar',
  rojo: 'tc-pedido-rojo',
}

function Ingredientes({ item }) {
  const grupos = ingredientesPorPaso(item)
  if (grupos.length === 0) return null

  return (
    <ul className="tc-mods">
      {grupos.map((grupo) => (
        <li key={grupo.paso} className="tc-mod">
          <span className="tc-mod-paso">{grupo.paso}: </span>
          {grupo.ingredientes.map((ing, indice) => {
            const marca = PORCIONES[ing.porcion]
            return (
              <span key={ing.id_ingrediente ?? `${grupo.paso}-${indice}`}>
                {indice > 0 && <span className="tc-mod-sep"> · </span>}
                <span>{ing.nombre}</span>
                {marca && (
                  <span className={`display tc-marca ${marca.clase}`}>
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

/**
 * T10: dentro de un bloque la tarjeta se dibuja en una columna que puede no
 * ser la de su estado (el bloque va en la del pedido más atrasado), así que el
 * estado se dice con texto y con el color de su columna.
 */
const ETIQUETA_ESTADO = {
  recibido: { texto: 'Nuevo', color: 'var(--color-nuevas)' },
  en_preparacion: { texto: 'En preparación', color: 'var(--color-preparacion)' },
  listo: { texto: 'Listo', color: 'var(--color-listas)' },
}

export default function ComandaCard({
  comanda,
  ahora,
  conectado = true,
  onAvanzar,
  // T10: la tarjeta va dentro del bloque de su mesa (el "Mesa N" lo pone el
  // bloque) y `bloqueado` la congela mientras corre "Todo listo".
  enBloque = false,
  bloqueado = false,
}) {
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

  const etiquetaEstado = ETIQUETA_ESTADO[comanda.estado]

  async function alTocar() {
    if (enVuelo || bloqueado || !paso) return
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
    } else if (enBloque) {
      // T10: dentro de un bloque la tarjeta NO se desmonta al avanzar (el
      // bloque sigue en su columna mientras le quede un pedido atrasado), así
      // que el botón tiene que volver por sí solo con su siguiente paso.
      setEnVuelo(false)
    }
  }

  return (
    <article
      // Atenuada, no escondida: una comanda olvidada tiene que seguir viendose,
      // solo deja de competir por la atencion con las que acaban de salir.
      className={`tc-pedido${enBloque ? '' : ' tc-pedido-suelto'}${
        conSemaforo && espera.nivel !== 'normal' ? ` ${MARCA_ESPERA[espera.nivel] || ''}` : ''
      }${olvidada ? ' es-olvidada' : ''}`}
    >
      <header className="tc-pedido-cabecera">
        {enBloque ? (
          // Dentro del bloque: quién pidió (el alias, que es con lo que se canta
          // el pase), el código y en qué estado va ESTE pedido.
          <div>
            <p className="display tc-pedido-quien">
              {comensales.length > 0 ? comensales.join(', ') : 'Pedido'}
            </p>
            <p className="tc-pedido-meta">
              {comanda.codigo_pedido && <span>{comanda.codigo_pedido}</span>}
              {etiquetaEstado && (
                <span
                  className="display tc-etiqueta-estado"
                  style={{ border: `2px solid ${etiquetaEstado.color}`, color: etiquetaEstado.color }}
                >
                  {etiquetaEstado.texto}
                </span>
              )}
            </p>
          </div>
        ) : (
          <div>
            <p className="display tc-ticket-mesa">Mesa {mesa}</p>
            {(comanda.codigo_pedido || comensales.length > 0) && (
              <p className="tc-pedido-meta">
                {[comanda.codigo_pedido, comensales.join(', ')].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* El diseño señala el nivel solo con el color del chip; el texto sigue
            estando, en el title y para los lectores de pantalla, porque un
            monitor mal calibrado o quien no distingue rojo de ámbar se quedaría
            sin la única pista. */}
        <p
          className={`display tc-chip ${CHIP_ESPERA[espera.nivel]}`}
          title={tituloDelReloj}
        >
          <Clock size={20} aria-hidden="true" />
          {textoDeEspera(reloj.minutos)}
          {/* En el pase el reloj cuenta otra cosa, así que lo dice. */}
          {reloj.enPase && <span className="tc-chip-nota">en pase</span>}
          <span className="sr-only">{tituloDelReloj}</span>
        </p>
      </header>

      {/* Los avisos van en ancho completo bajo la cabecera: es lo primero que
          se lee después del número de mesa, y es lo que decide qué se hace. */}
      {espera.nivel === 'rojo' && (
        <p className="display tc-banda tc-banda-rojo">
          {espera.etiqueta} · prioridad
        </p>
      )}

      {olvidada && (
        // Mismo rojo sólido que "· prioridad", y fuera de la atenuación de la
        // comanda olvidada (ver .es-olvidada en tema-cocina.css).
        <p className="display tc-banda tc-banda-rojo tc-aviso-olvidada">
          {avisoSinRecoger(enPase, reloj.minutos)} · avisar al mesero
        </p>
      )}

      <ul className="tc-items">
        {comanda.items.map((item, indice) => {
          // Una linea cancelada (D-13 / #180) se ve TACHADA, igual en vivo que al
          // recargar (ver lineaCancelada). Sin ingredientes ni notas: ya no hay
          // nada que preparar, solo dejar constancia de que se quito.
          const cancelada = lineaCancelada(item)
          return (
            <li
              key={item.id_detalle ?? `${comanda.id_pedido}-${indice}`}
              className={cancelada ? 'tc-item es-cancelada' : 'tc-item'}
            >
              <div className="tc-item-fila">
                <div className={`tc-item-plato${cancelada ? ' es-tachado' : ''}`}>
                  <span
                    className={`display tc-item-cantidad${cancelada ? ' es-cancelada' : ''}`}
                  >
                    {item.cantidad}×
                  </span>
                  <span className="display tc-item-nombre">
                    {item.plato_nombre || 'Plato sin nombre'}
                  </span>
                </div>
                {cancelada ? (
                  <span className="tc-item-cancelado">
                    <Ban size={14} aria-hidden="true" />
                    Cancelado
                  </span>
                ) : (
                  item.comensal && <span className="tc-item-quien">{item.comensal}</span>
                )}
              </div>

              {!cancelada && <Ingredientes item={item} />}

              {!cancelada && item.notas_especiales && (
                <p className="tc-nota">
                  <FileText size={18} className="tc-nota-icono" aria-hidden="true" />
                  <span>{item.notas_especiales}</span>
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {comanda.items.length === 0 && (
        <p className="tc-pedido-vacio">
          Esta comanda llegó sin ítems
        </p>
      )}

      {/* La nota de la mesa va DEBAJO de los platos y pegada al botón: es lo
          último que hay que leer antes de darle, no un encabezado. */}
      {comanda.notas_generales && (
        <p className="tc-nota tc-nota-general">
          <FileText size={18} className="tc-nota-icono" aria-hidden="true" />
          <span>{comanda.notas_generales}</span>
        </p>
      )}

      {error && (
        <p
          className="tc-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {paso && esperandoConexion && (
        // El PATCH no llego al servidor y el tiempo real tampoco esta: tocar
        // otra vez solo repetiria el mismo fallo. En cuanto vuelva la conexion
        // este bloque se va solo y el boton vuelve.
        <p className="display tc-accion tc-accion-esperando">
          <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />
          Esperando conexión…
        </p>
      )}

      {paso && !esperandoConexion && (
        <button
          type="button"
          onClick={alTocar}
          disabled={enVuelo || bloqueado}
          // 64 px de alto: objetivo tactil holgado para una pantalla de cocina.
          // Misma condición que antes elegía el color en línea: EMPEZAR va con
          // contorno y MARCAR LISTO relleno de tinta.
          className={`display tc-accion ${
            paso.estado === 'en_preparacion' ? 'tc-accion-empezar' : 'tc-accion-listo'
          }`}
        >
          {enVuelo && <LoaderCircle size={26} className="animate-spin" aria-hidden="true" />}
          {enVuelo ? 'Enviando…' : paso.etiqueta}
        </button>
      )}
    </article>
  )
}
