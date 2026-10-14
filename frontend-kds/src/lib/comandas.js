/**
 * Logica del tablero de cocina, sin React.
 *
 * Todo lo que decide que comanda va en que columna, que eventos se ignoran y
 * como se mezcla el tiempo real con la carga inicial vive aqui, en funciones
 * puras: asi se prueba con node --test sin montar la interfaz, y la pantalla
 * solo se ocupa de dibujar.
 *
 * Regla general: cada funcion devuelve un estado NUEVO y nunca modifica el que
 * recibe, para que React detecte el cambio por identidad.
 */

import { ordenarPase } from './pase.js'

/** Columnas del tablero, en el orden en que se muestran. */
export const COLUMNAS = [
  { estado: 'recibido', titulo: 'Nuevas' },
  { estado: 'en_preparacion', titulo: 'En preparación' },
  { estado: 'listo', titulo: 'Listas' },
]

const ESTADOS_EN_TABLERO = COLUMNAS.map((c) => c.estado)

/**
 * Estados en los que la comanda deja de ser asunto de la cocina: ya salio al
 * comedor, se cobro o se anulo. Se quita del tablero.
 */
export const ESTADOS_QUE_SALEN = ['entregado', 'pagado', 'cancelado']

/**
 * Cuantos eventId se recuerdan para descartar repetidos.
 *
 * El socket-server reintenta y puede reenviar el mismo evento (EVENTS.md §3.1 y
 * §5), asi que hay que deduplicar. Se guarda una ventana y no todo el historial
 * porque una pantalla de cocina puede quedar abierta todo el dia y la lista
 * creceria sin tope.
 */
export const MAX_EVENTOS_RECORDADOS = 500

/** Estado inicial, antes de la primera carga. */
export function estadoInicial() {
  return { comandas: [], eventos: [], cargando: true, error: null }
}

/**
 * Reemplaza el tablero con lo que respondio GET /api/kds/comandas.
 *
 * Se usa en la carga inicial y en CADA reconexion: mientras el socket estuvo
 * caido pudieron pasar cosas que no llegaron, asi que mezclar dejaria comandas
 * fantasma. La API manda, el estado anterior se descarta.
 *
 * Desde D-09 la API tambien devuelve las comandas en 'listo', asi que la
 * columna "Listas" ya no se vacia al recargar ni al reconectar.
 *
 * Los eventId vistos tambien se olvidan: son de la sesion anterior del socket y
 * guardarlos solo podria hacer que se ignore un evento legitimo.
 */
export function cargarInicial(estado, comandas) {
  return {
    ...estado,
    comandas: (comandas || []).filter((c) => ESTADOS_EN_TABLERO.includes(c.estado)),
    eventos: [],
    cargando: false,
    error: null,
  }
}

/** Marca un fallo de carga, conservando lo que ya estuviera en pantalla. */
export function marcarError(estado, mensaje) {
  return { ...estado, cargando: false, error: mensaje || 'No se pudo cargar las comandas' }
}

/** Marca que se esta (re)cargando, sin borrar lo que ya se ve. */
export function marcarCargando(estado) {
  return { ...estado, cargando: true, error: null }
}

/** ¿Este eventId ya se proceso? */
export function esEventoRepetido(estado, eventId) {
  if (!eventId) return false
  return estado.eventos.includes(eventId)
}

/** Agrega el eventId a la ventana de vistos, recortando los mas viejos. */
function recordarEvento(estado, eventId) {
  if (!eventId) return estado.eventos
  const siguientes = [...estado.eventos, eventId]
  return siguientes.length > MAX_EVENTOS_RECORDADOS
    ? siguientes.slice(siguientes.length - MAX_EVENTOS_RECORDADOS)
    : siguientes
}

/**
 * Normaliza el pedido que viaja en order:created (EVENTS.md §4) a la forma que
 * usa la tarjeta.
 *
 * El payload del socket NO trae mesa_numero ni minutos_transcurridos, que si
 * vienen de la API: se deja `mesa_numero` en null (la tarjeta cae a `id_mesa`) y
 * se guarda la hora de llegada local como referencia del cronometro.
 *
 * `comensal` e `ingredientes` por item llegan con el PR #32; hasta entonces
 * quedan vacios y la tarjeta se dibuja igual.
 */
export function comandaDesdePedido(pedido, llegadaEnMs = Date.now()) {
  return {
    id_pedido: pedido.id_pedido,
    codigo_pedido: pedido.codigo_pedido ?? null,
    id_mesa: pedido.id_mesa ?? null,
    mesa_numero: pedido.mesa_numero ?? null,
    estado: pedido.estado || 'recibido',
    notas_generales: pedido.notas_generales ?? null,
    // Hora de paso a 'listo' (historial_estados), cuando la API la manda.
    listo_en: pedido.listo_en ?? null,
    minutos_transcurridos: 0,
    recibidoEnMs: llegadaEnMs,
    items: (pedido.items || []).map((item) => ({
      id_detalle: item.id_detalle ?? null,
      cantidad: item.cantidad,
      // La API dice plato_nombre y el socket dice nombre: misma cosa con dos
      // nombres, se acepta cualquiera para que la tarjeta no dependa del origen.
      plato_nombre: item.plato_nombre ?? item.nombre ?? null,
      notas_especiales: item.notas_especiales ?? null,
      comensal: item.comensal ?? null,
      ingredientes: item.ingredientes ?? [],
    })),
  }
}

/**
 * Aplica order:created: agrega la comanda a "Nuevas".
 *
 * Doble deduplicacion, porque son dos problemas distintos: por `eventId` para el
 * mismo evento reenviado, y por `id_pedido` para el caso en que el pedido ya
 * estaba en pantalla (lo trajo la carga inicial, o llego por otra via). Si ya
 * esta, no se duplica ni se le pisa el estado: una comanda que ya paso a
 * "En preparación" no debe volver a "Nuevas" porque llegue tarde su created.
 */
export function aplicarCreado(estado, evento) {
  if (esEventoRepetido(estado, evento?.eventId)) return estado

  const pedido = evento?.pedido
  if (!pedido || pedido.id_pedido === undefined || pedido.id_pedido === null) return estado

  const eventos = recordarEvento(estado, evento.eventId)
  if (estado.comandas.some((c) => c.id_pedido === pedido.id_pedido)) {
    return { ...estado, eventos }
  }

  const nueva = comandaDesdePedido(pedido, evento.recibidoEnMs ?? Date.now())
  if (!ESTADOS_EN_TABLERO.includes(nueva.estado)) return { ...estado, eventos }

  // Las nuevas van al principio: en cocina lo que acaba de entrar es lo que hay
  // que ver primero.
  return { ...estado, comandas: [nueva, ...estado.comandas], eventos }
}

/**
 * Aplica order:status: mueve la comanda de columna, o la saca del tablero.
 *
 * Si el pedido no esta en pantalla no se inventa una tarjeta: el payload de
 * order:status no trae los items, y una comanda sin items no le sirve a nadie en
 * la cocina. Al reconectar, la carga inicial pone todo en su sitio.
 */
export function aplicarEstado(estado, evento) {
  if (esEventoRepetido(estado, evento?.eventId)) return estado
  if (!evento || evento.id_pedido === undefined || evento.id_pedido === null) return estado

  const eventos = recordarEvento(estado, evento.eventId)

  if (ESTADOS_QUE_SALEN.includes(evento.estado)) {
    return {
      ...estado,
      comandas: estado.comandas.filter((c) => c.id_pedido !== evento.id_pedido),
      eventos,
    }
  }

  if (!ESTADOS_EN_TABLERO.includes(evento.estado)) return { ...estado, eventos }

  return {
    ...estado,
    comandas: estado.comandas.map((c) =>
      c.id_pedido === evento.id_pedido ? { ...c, ...cambioDeEstado(evento) } : c
    ),
    eventos,
  }
}

/**
 * Campos que deja un order:status en la comanda.
 *
 * Al pasar a 'listo' se anota CUANDO, para poder contar el tiempo en el pase y
 * no el total desde que se pidio. La hora preferida es el `emitidoEn` del
 * evento (la pone el socket-server al difundirlo, a milisegundos del cambio en
 * la base); si no viniera, la hora de llegada local, que es igual de buena
 * porque el evento acaba de llegar.
 */
function cambioDeEstado(evento) {
  if (evento.estado !== 'listo') return { estado: evento.estado }

  const emitido = evento.emitidoEn ? Date.parse(evento.emitidoEn) : NaN
  return {
    estado: evento.estado,
    listoEnMs: Number.isFinite(emitido) ? emitido : Date.now(),
  }
}

/**
 * Siguiente estado al que puede avanzar una comanda desde el tablero.
 *
 * Es el boton de la tarjeta: "Empezar" en Nuevas y "Listo" en En preparacion.
 * Una comanda ya lista no tiene boton — sacarla del tablero es del mesero, que
 * la marca 'entregado' desde su panel, y el KDS lo recibe por order:status.
 *
 * Solo devuelve los dos estados que acepta PATCH /api/kds/comandas/:id/estado;
 * la transicion la valida igualmente el trigger de la base.
 *
 * @returns {{estado: string, etiqueta: string}|null}
 */
export function siguientePaso(estadoActual) {
  if (estadoActual === 'recibido') return { estado: 'en_preparacion', etiqueta: 'Empezar' }
  if (estadoActual === 'en_preparacion') return { estado: 'listo', etiqueta: 'Listo' }
  return null
}

/**
 * Mueve una comanda de columna sin esperar al evento del socket.
 *
 * Se aplica con la respuesta del PATCH para que la tarjeta se mueva en el acto:
 * en una pantalla tactil, tocar y que no pase nada hasta que vuelva el socket
 * invita a tocar otra vez. Si el evento llega despues con el mismo estado, el
 * resultado es el mismo (es idempotente).
 */
export function marcarEstadoLocal(estado, idPedido, nuevoEstado) {
  if (ESTADOS_QUE_SALEN.includes(nuevoEstado)) {
    return { ...estado, comandas: estado.comandas.filter((c) => c.id_pedido !== idPedido) }
  }
  if (!ESTADOS_EN_TABLERO.includes(nuevoEstado)) return estado

  return {
    ...estado,
    comandas: estado.comandas.map((c) =>
      c.id_pedido === idPedido
        ? {
            ...c,
            estado: nuevoEstado,
            // La marca la pone el PATCH propio: acaba de pasar a listo.
            ...(nuevoEstado === 'listo' ? { listoEnMs: Date.now() } : {}),
          }
        : c
    ),
  }
}

/**
 * Comandas de una columna.
 *
 * Nuevas y En preparacion conservan el orden del estado (la API las da de la
 * mas vieja a la mas nueva, que es el orden en que hay que atenderlas). El pase
 * se invierte: arriba lo que acaba de salir (ver ordenarPase).
 */
export function comandasDeColumna(estado, estadoColumna) {
  const deLaColumna = estado.comandas.filter((c) => c.estado === estadoColumna)
  return estadoColumna === 'listo' ? ordenarPase(deLaColumna) : deLaColumna
}

/**
 * Minutos que lleva la comanda.
 *
 * Parte de `minutos_transcurridos`, que calcula la base al cargar, y le suma lo
 * que ha pasado desde entonces en el reloj local. Asi el cronometro avanza sin
 * volver a preguntarle nada al servidor.
 */
export function minutosDeEspera(comanda, ahoraEnMs = Date.now()) {
  const base = Number(comanda.minutos_transcurridos) || 0
  const desde = comanda.recibidoEnMs
  if (!desde) return Math.floor(base)
  return Math.floor(base + (ahoraEnMs - desde) / 60000)
}

/** Agrupa los ingredientes de un item por paso del constructor, en orden. */
export function ingredientesPorPaso(item) {
  const grupos = []
  for (const ing of item.ingredientes || []) {
    const nombrePaso = ing.paso || 'Ingredientes'
    let grupo = grupos.find((g) => g.paso === nombrePaso)
    if (!grupo) {
      grupo = { paso: nombrePaso, ingredientes: [] }
      grupos.push(grupo)
    }
    grupo.ingredientes.push(ing)
  }
  return grupos
}
