/**
 * T10 · Una tarjeta por mesa.
 *
 * El tablero sigue guardando COMANDAS (una por pedido, con su propio estado,
 * porque cada pedido avisa a su comensal); lo que cambia es como se dibujan:
 * en cada columna, las comandas de la misma mesa (id_mesa) van juntas en un
 * BLOQUE; cada pedido va en la columna de su propio estado. El bloque
 * no se guarda en ningun sitio, se calcula en cada render a partir de
 * estado.comandas, asi que cualquier evento (order:created, order:status,
 * item:cancelado) lo recoloca solo, sin recargar y con la deduplicacion por
 * eventId que ya hace lib/comandas.js.
 *
 * Funciones puras, con el "ahora" como argumento, como el resto de lib/.
 */

import { minutosDesdeCreacion } from './espera.js'
import { listoEnMs } from './pase.js'

/** Estados en los que "Todo listo" todavia tiene trabajo que hacer. */
export const ESTADOS_PENDIENTES = ['recibido', 'en_preparacion']

/** Como se rotula un bloque sin mesa, segun el canal que trae la API. */
const ROTULO_CANAL = {
  para_llevar: 'Para llevar',
  domicilio: 'Domicilio',
}

/**
 * Momento de creacion en ms, para ordenar.
 *
 * `creado_en` (API) es la verdad; un pedido que llego por order:created no lo
 * trae y se ordena por su hora de llegada local menos los minutos que ya
 * traia. Es la misma fuente que usa el cronometro (minutosDesdeCreacion), solo
 * que sin redondear a minutos: dos pedidos del mismo minuto tienen que salir
 * en el orden en que se hicieron.
 */
export function momentoDeCreacion(comanda, ahoraEnMs = Date.now()) {
  if (comanda?.creado_en) {
    const creado = Date.parse(comanda.creado_en)
    if (Number.isFinite(creado)) return creado
  }
  if (Number.isFinite(comanda?.recibidoEnMs)) {
    return comanda.recibidoEnMs - (Number(comanda.minutos_transcurridos) || 0) * 60000
  }
  return ahoraEnMs - (Number(comanda?.minutos_transcurridos) || 0) * 60000
}

/** De la mas antigua a la mas nueva; empate, por id_pedido. */
function porAntiguedad(ahoraEnMs) {
  return (a, b) =>
    momentoDeCreacion(a, ahoraEnMs) - momentoDeCreacion(b, ahoraEnMs) ||
    (a.id_pedido ?? 0) - (b.id_pedido ?? 0)
}

/** ¿El pedido es de una mesa? Los de para llevar y domicilio no tienen. */
function tieneMesa(comanda) {
  return comanda?.id_mesa !== undefined && comanda?.id_mesa !== null
}

/**
 * Titulo del bloque.
 *
 * - Mesa: "Mesa N", con el numero que trae la API. Un pedido que llego por el
 *   socket no trae mesa_numero; si otro pedido del bloque lo tiene, se usa ese,
 *   y si no, el id_mesa (lo mismo que hacia la tarjeta antes).
 * - Sin mesa: "Para llevar #codigo" o "Domicilio #codigo" segun `canal`. Si el
 *   pedido no trae canal (order:created no lo manda; la API si), "Sin mesa
 *   #codigo" hasta la siguiente recarga.
 */
function tituloDelBloque(comandas) {
  const primera = comandas[0]
  if (tieneMesa(primera)) {
    const conNumero = comandas.find((c) => c.mesa_numero !== undefined && c.mesa_numero !== null)
    return `Mesa ${conNumero ? conNumero.mesa_numero : primera.id_mesa}`
  }
  const rotulo = ROTULO_CANAL[primera?.canal] || 'Sin mesa'
  const codigo = primera?.codigo_pedido || primera?.id_pedido
  return `${rotulo} #${codigo}`
}

/**
 * Agrupa las comandas en bloques.
 *
 * - Cada pedido va en la columna de SU estado. Dentro de cada columna, los de
 *   la misma mesa (id_mesa) van en un bloque: la clave es mesa + estado, asi
 *   que una mesa puede salir a la vez en Nuevas, En preparacion y Listas. Al
 *   avanzar un pedido, ese pedido (y solo ese) cambia de bloque.
 * - Los sin mesa (para llevar, domicilio), cada uno en el suyo.
 * - Dentro del bloque, por creado_en (la mas antigua arriba).
 * - Los bloques, por su comanda mas antigua: la mesa que lleva mas esperando,
 *   primero.
 * - `minutos` del bloque = los de su comanda mas antigua DE ESE BLOQUE (el
 *   mismo calculo que el cronometro de la tarjeta).
 * - `enOtrasColumnas` = pedidos de la misma mesa que estan en el tablero con
 *   otro estado (siempre 0 sin mesa).
 *
 * @returns {Array<{clave: string, titulo: string, conMesa: boolean,
 *   id_mesa: number|null, comandas: object[], estado: string, minutos: number,
 *   pendientes: number, enOtrasColumnas: number}>}
 */
export function agruparPorMesa(comandas, ahoraEnMs = Date.now()) {
  const grupos = new Map()
  const porMesa = new Map()
  for (const comanda of comandas || []) {
    if (!comanda) continue
    const conMesa = tieneMesa(comanda)
    const clave = conMesa ? `mesa:${comanda.id_mesa}:${comanda.estado}` : `pedido:${comanda.id_pedido}`
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(comanda)
    if (conMesa) porMesa.set(comanda.id_mesa, (porMesa.get(comanda.id_mesa) || 0) + 1)
  }

  const orden = porAntiguedad(ahoraEnMs)
  const bloques = []
  for (const [clave, delGrupo] of grupos) {
    const ordenadas = [...delGrupo].sort(orden)
    const conMesa = tieneMesa(ordenadas[0])
    bloques.push({
      clave,
      titulo: tituloDelBloque(ordenadas),
      conMesa,
      id_mesa: conMesa ? ordenadas[0].id_mesa : null,
      comandas: ordenadas,
      estado: ordenadas[0].estado,
      minutos: minutosDesdeCreacion(ordenadas[0], ahoraEnMs),
      pendientes: ordenadas.filter((c) => ESTADOS_PENDIENTES.includes(c.estado)).length,
      enOtrasColumnas: conMesa ? porMesa.get(ordenadas[0].id_mesa) - ordenadas.length : 0,
    })
  }

  return bloques.sort((a, b) => orden(a.comandas[0], b.comandas[0]))
}

/** Ultima vez que alguna comanda del bloque paso a 'listo', o null. */
function ultimoListo(bloque) {
  let ultimo = null
  for (const c of bloque.comandas) {
    const marca = listoEnMs(c)
    if (marca !== null && (ultimo === null || marca > ultimo)) ultimo = marca
  }
  return ultimo
}

/**
 * Bloques de una columna: los pedidos en ese estado, agrupados por mesa.
 *
 * Nuevas y En preparacion, por antiguedad (la mesa que mas espera, primero).
 * El pase conserva su criterio de siempre (ordenarPase): arriba lo que acaba de
 * salir, porque ahi ya no se cuenta la espera del comensal sino lo que el
 * mesero tiene que recoger.
 */
export function bloquesDeColumna(estado, estadoColumna, ahoraEnMs = Date.now()) {
  const bloques = agruparPorMesa(estado?.comandas, ahoraEnMs).filter((b) => b.estado === estadoColumna)
  if (estadoColumna !== 'listo') return bloques

  return bloques.sort((a, b) => {
    const ma = ultimoListo(a)
    const mb = ultimoListo(b)
    if (ma === null && mb === null) return 0
    if (ma === null) return 1
    if (mb === null) return -1
    return mb - ma
  })
}

/**
 * Transiciones que le faltan a un pedido para llegar a 'listo', en orden. El
 * KDS no puede saltar de recibido a listo (lo rechaza la base), asi que se
 * pasa por en_preparacion.
 */
export function pasosHastaListo(estadoActual) {
  if (estadoActual === 'recibido') return ['en_preparacion', 'listo']
  if (estadoActual === 'en_preparacion') return ['listo']
  return []
}

/**
 * "Todo listo": lleva a 'listo' cada pedido del bloque que aun no lo este.
 *
 * - Los pedidos van de uno en uno, en el orden del bloque, y sus pasos tambien
 *   (recibido -> en_preparacion -> listo), con `avanzar`, que es la MISMA
 *   llamada que usan los botones de la tarjeta (PATCH + movimiento local con
 *   el estado que devuelve el servidor).
 * - Se saltan los que ya estan listos, entregados o cancelados.
 * - Si un paso falla, ese pedido se deja donde quedo (el estado en pantalla es
 *   el que dijo el servidor, o el de la recarga que hace `avanzar` al fallar) y
 *   se sigue con los demas.
 *
 * @param {object[]} comandas  las del bloque
 * @param {(id: number, estado: string) => Promise<{ok: boolean, estado?: string, mensaje?: string}>} avanzar
 * @returns {Promise<{listos: number[], fallidos: Array<{id_pedido: number, codigo_pedido: string|null, mensaje: string}>}>}
 */
export async function marcarTodoListo(comandas, avanzar) {
  const listos = []
  const fallidos = []

  for (const comanda of comandas || []) {
    let actual = comanda.estado
    for (const destino of pasosHastaListo(actual)) {
      // El servidor pudo dejarlo ya en 'listo' (otra pantalla se adelanto).
      if (actual === 'listo') break
      let resultado
      try {
        resultado = await avanzar(comanda.id_pedido, destino)
      } catch (error) {
        resultado = { ok: false, mensaje: error?.message }
      }
      if (!resultado?.ok) {
        fallidos.push({
          id_pedido: comanda.id_pedido,
          codigo_pedido: comanda.codigo_pedido ?? null,
          mensaje: resultado?.mensaje || 'No se pudo cambiar el estado',
        })
        actual = null
        break
      }
      actual = resultado.estado || destino
    }
    if (actual === 'listo' && comanda.estado !== 'listo') listos.push(comanda.id_pedido)
  }

  return { listos, fallidos }
}

/** Como se nombran los pedidos de cada columna en la pregunta de "Todo listo". */
const NOMBRE_EN_PREGUNTA = {
  recibido: { uno: 'el pedido nuevo', varios: (n) => `los ${n} pedidos nuevos` },
  en_preparacion: { uno: 'el pedido en preparación', varios: (n) => `los ${n} pedidos en preparación` },
}

/**
 * Pregunta de confirmacion del boton.
 *
 * Un bloque de mesa solo lleva los pedidos de su columna, asi que la pregunta
 * dice cuales y cuantos: la misma mesa puede tener otro boton en la columna de
 * al lado. Sin mesa (o en un estado sin boton) queda la pregunta de siempre.
 */
export function preguntaTodoListo(bloque) {
  const nombre = NOMBRE_EN_PREGUNTA[bloque?.estado]
  if (!bloque?.conMesa || !nombre) {
    return `¿Marcar todos los pedidos de la ${bloque.titulo} como listos?`
  }
  const n = bloque.comandas.length
  return n === 1
    ? `¿Marcar como listo ${nombre.uno} de la ${bloque.titulo}?`
    : `¿Marcar como listos ${nombre.varios(n)} de la ${bloque.titulo}?`
}

/** Linea "+N pedidos de esta mesa en otras columnas"; vacia si N es 0. */
export function textoOtrasColumnas(n) {
  if (!(n > 0)) return ''
  return n === 1 ? '+1 pedido de esta mesa en otras columnas' : `+${n} pedidos de esta mesa en otras columnas`
}

/**
 * Estado de "Todo listo" que le toca a un bloque.
 *
 * El Tablero lo guarda por la clave del bloque desde el que se lanzo, junto con
 * los ids de sus pedidos (`ids`). Mientras corre, esos pedidos se van moviendo
 * a otros bloques (Nuevas -> En preparacion -> Listas); cada bloque muestra
 * "corriendo" y los fallos de los pedidos que tiene EN ESE MOMENTO.
 *
 * @param {object} bloque
 * @param {Record<string, {corriendo: boolean, fallidos: object[], ids?: number[]}>} todoListo
 * @returns {{corriendo: boolean, fallidos: object[]} | null}
 */
export function todoListoDelBloque(bloque, todoListo) {
  const ids = idsDelBloque(bloque)
  let corriendo = false
  const fallidos = []
  for (const entrada of Object.values(todoListo || {})) {
    if (!entrada) continue
    if (entrada.corriendo && (entrada.ids || []).some((id) => ids.has(id))) corriendo = true
    fallidos.push(...(entrada.fallidos || []).filter((f) => ids.has(f.id_pedido)))
  }
  if (!corriendo && fallidos.length === 0) return null
  return { corriendo, fallidos }
}

/**
 * Cierra el aviso de fallos de un bloque: quita los fallos de SUS pedidos y
 * deja los de otros bloques. Las entradas que se quedan sin nada se borran.
 */
export function descartarFallosDelBloque(todoListo, bloque) {
  const ids = idsDelBloque(bloque)
  const siguiente = {}
  for (const [clave, entrada] of Object.entries(todoListo || {})) {
    if (!entrada) continue
    const fallidos = (entrada.fallidos || []).filter((f) => !ids.has(f.id_pedido))
    if (entrada.corriendo || fallidos.length > 0) siguiente[clave] = { ...entrada, fallidos }
  }
  return siguiente
}

function idsDelBloque(bloque) {
  return new Set((bloque?.comandas || []).map((c) => c.id_pedido))
}
