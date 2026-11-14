/**
 * T10 · Una tarjeta por mesa.
 *
 * El tablero sigue guardando COMANDAS (una por pedido, con su propio estado,
 * porque cada pedido avisa a su comensal); lo que cambia es como se dibujan:
 * las comandas de la misma mesa (id_mesa) van juntas en un BLOQUE. El bloque
 * no se guarda en ningun sitio, se calcula en cada render a partir de
 * estado.comandas, asi que cualquier evento (order:created, order:status,
 * item:cancelado) lo recoloca solo, sin recargar y con la deduplicacion por
 * eventId que ya hace lib/comandas.js.
 *
 * Funciones puras, con el "ahora" como argumento, como el resto de lib/.
 */

import { COLUMNAS } from './comandas.js'
import { minutosDesdeCreacion } from './espera.js'
import { listoEnMs } from './pase.js'

/** Orden de "atraso": cuanto mas a la izquierda, mas le falta a la cocina. */
const ORDEN_ESTADOS = COLUMNAS.map((c) => c.estado)

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
 * Estado mas atrasado del bloque: decide en que columna se dibuja.
 *
 * Una mesa con un pedido en el pase y otro recien llegado sigue teniendo
 * trabajo en Nuevas, y es ahi donde la cocina tiene que verla.
 */
export function estadoDelBloque(comandas) {
  let indice = ORDEN_ESTADOS.length - 1
  for (const c of comandas) {
    const i = ORDEN_ESTADOS.indexOf(c.estado)
    if (i >= 0 && i < indice) indice = i
  }
  return ORDEN_ESTADOS[indice]
}

/**
 * Agrupa las comandas en bloques.
 *
 * - Las de la misma mesa (id_mesa) van en un bloque; las sin mesa, cada una en
 *   el suyo.
 * - Dentro del bloque, por creado_en (la mas antigua arriba).
 * - Los bloques, por su comanda mas antigua: la mesa que lleva mas esperando,
 *   primero.
 * - `minutos` del bloque = los de su comanda mas antigua (el mismo calculo que
 *   el cronometro de la tarjeta).
 *
 * @returns {Array<{clave: string, titulo: string, conMesa: boolean,
 *   id_mesa: number|null, comandas: object[], estado: string, minutos: number,
 *   pendientes: number}>}
 */
export function agruparPorMesa(comandas, ahoraEnMs = Date.now()) {
  const grupos = new Map()
  for (const comanda of comandas || []) {
    if (!comanda) continue
    const clave = tieneMesa(comanda) ? `mesa:${comanda.id_mesa}` : `pedido:${comanda.id_pedido}`
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(comanda)
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
      estado: estadoDelBloque(ordenadas),
      minutos: minutosDesdeCreacion(ordenadas[0], ahoraEnMs),
      pendientes: ordenadas.filter((c) => ESTADOS_PENDIENTES.includes(c.estado)).length,
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
 * Bloques de una columna: los que tienen ahi su estado mas atrasado.
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

/** Pregunta de confirmacion del boton. */
export function preguntaTodoListo(bloque) {
  return `¿Marcar todos los pedidos de la ${bloque.titulo} como listos?`
}
