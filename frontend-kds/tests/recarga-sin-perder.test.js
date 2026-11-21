/**
 * Recarga sin perder (revision de Roberto en el #318): mientras recargar()
 * espera GET /api/kds/comandas siguen llegando avisos del socket. La respuesta
 * puede ser mas vieja que esos avisos, asi que no los puede pisar: un pedido
 * creado durante la carga no se pierde, uno que avanzo no vuelve atras y un
 * plato quitado no reaparece. Y al repartir por mesa + estado, ningun pedido se
 * duplica ni se pierde.
 *
 * Al final, una prueba de propiedades con semilla fija: un servidor simulado,
 * un socket que se cae y reconecta, recargas que se solapan y avisos
 * repetidos; despues de cada paso se comprueban los bloques y, cuando el
 * tablero ya deberia estar al dia, que coincida con el servidor.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { bloquesDeColumna } from '../src/lib/bloques.js'
import {
  COLUMNAS,
  MAX_EVENTOS_RECORDADOS,
  aplicarCreado,
  aplicarEstado,
  aplicarItemCancelado,
  cargarInicial,
  contarComandasActivas,
  estadoInicial,
  lineaCancelada,
  marcarCargando,
  marcarError,
  marcarEstadoLocal,
} from '../src/lib/comandas.js'

// ---------------------------------------------------------------------------
// Copia de ACCIONES y reducer de src/lib/useTablero.js (no se exportan y ese
// archivo importa React, la API y el socket). Si cambia alli, cambia aqui.
// ---------------------------------------------------------------------------

const ACCIONES = {
  cargando: (estado, { idCarga } = {}) => marcarCargando(estado, idCarga),
  cargar: (estado, { comandas, idCarga }) => cargarInicial(estado, comandas, idCarga),
  error: (estado, { mensaje, idCarga }) => marcarError(estado, mensaje, idCarga),
  creado: aplicarCreado,
  estado: aplicarEstado,
  itemCancelado: aplicarItemCancelado,
  local: (estado, { id_pedido, nuevoEstado }) => marcarEstadoLocal(estado, id_pedido, nuevoEstado),
}

function reducer(estado, accion) {
  const aplicar = ACCIONES[accion.tipo]
  return aplicar ? aplicar(estado, accion.datos) : estado
}

/** Despacha una lista de acciones [tipo, datos] en orden. */
function correr(estado, acciones) {
  return acciones.reduce((e, [tipo, datos]) => reducer(e, { tipo, datos }), estado)
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

const AHORA = Date.parse('2026-11-20T20:00:00Z')
const MINUTO = 60_000
const ORDEN = COLUMNAS.map((c) => c.estado)

/** Comanda como la trae GET /api/kds/comandas. */
function delApi(id, { mesa = null, estado = 'recibido', cancelados = [], hace = 0 } = {}) {
  return {
    id_pedido: id,
    codigo_pedido: `PED-261120-${String(id).padStart(5, '0')}`,
    id_mesa: mesa,
    mesa_numero: mesa,
    canal: mesa === null ? 'para_llevar' : 'mesa',
    estado,
    creado_en: new Date(AHORA - hace * MINUTO).toISOString(),
    items: [1, 2].map((k) => ({
      id_detalle: id * 10 + k,
      cantidad: 1,
      plato_nombre: `Plato ${k}`,
      estado_item: cancelados.includes(id * 10 + k) ? 'cancelado' : 'pendiente',
    })),
  }
}

/** order:created tal como lo manda el socket (sin mesa_numero ni creado_en). */
function creado(eventId, id, mesa = null) {
  return {
    eventId,
    recibidoEnMs: AHORA,
    pedido: {
      id_pedido: id,
      codigo_pedido: `PED-261120-${String(id).padStart(5, '0')}`,
      id_mesa: mesa,
      estado: 'recibido',
      items: [1, 2].map((k) => ({ id_detalle: id * 10 + k, cantidad: 1, nombre: `Plato ${k}` })),
    },
  }
}

const cambio = (eventId, id, estado) => ({ eventId, id_pedido: id, estado, emitidoEn: new Date(AHORA).toISOString() })
const quitado = (eventId, id, idDetalle) => ({ eventId, id_pedido: id, id_detalle: idDetalle })

/** Lo que importa del tablero: estado y platos quitados de cada pedido. */
function foto(estado) {
  return estado.comandas
    .map((c) => ({
      id: c.id_pedido,
      estado: c.estado,
      quitados: c.items.filter(lineaCancelada).map((i) => i.id_detalle).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.id - b.id)
}

/**
 * Invariantes del reparto por mesa + estado: cada pedido activo esta en
 * exactamente un bloque, ese bloque esta en la columna de su estado, los
 * contadores (bloques por columna) son los que tocan y la suma de pedidos de
 * todos los bloques es el numero de pedidos activos.
 */
function comprobarBloques(estado, donde = '') {
  const ids = estado.comandas.map((c) => c.id_pedido)
  assert.equal(new Set(ids).size, ids.length, `${donde} pedido duplicado en el tablero: ${ids}`)

  const veces = new Map()
  let suma = 0
  for (const columna of ORDEN) {
    const bloques = bloquesDeColumna(estado, columna, AHORA)
    const grupos = new Set(
      estado.comandas
        .filter((c) => c.estado === columna)
        .map((c) => (c.id_mesa === null || c.id_mesa === undefined ? `pedido:${c.id_pedido}` : `mesa:${c.id_mesa}`))
    )
    assert.equal(bloques.length, grupos.size, `${donde} contador de ${columna}`)
    for (const bloque of bloques) {
      assert.equal(bloque.estado, columna, `${donde} bloque ${bloque.clave} en la columna ${columna}`)
      for (const c of bloque.comandas) {
        assert.equal(c.estado, columna, `${donde} pedido ${c.id_pedido} en la columna ${columna}`)
        veces.set(c.id_pedido, (veces.get(c.id_pedido) || 0) + 1)
        suma += 1
      }
    }
  }
  for (const id of ids) assert.equal(veces.get(id), 1, `${donde} pedido ${id} en ${veces.get(id) || 0} bloques`)
  assert.equal(suma, contarComandasActivas(estado), `${donde} suma de los bloques`)
  assert.equal(suma, ids.length, `${donde} suma de los bloques frente a las comandas`)
}

/** Columna (estado) y numero de bloques de cada columna. */
function contadores(estado) {
  return Object.fromEntries(ORDEN.map((col) => [col, bloquesDeColumna(estado, col, AHORA).length]))
}

/** Tablero ya cargado (carga 1 terminada). */
function cargado(comandas) {
  return correr(estadoInicial(), [
    ['cargando', { idCarga: 1 }],
    ['cargar', { comandas, idCarga: 1 }],
  ])
}

// ---------------------------------------------------------------------------
// Avisos seguidos y repetidos
// ---------------------------------------------------------------------------

test('dos avisos seguidos del mismo pedido: una vez, en Listas, y los contadores cuadran', () => {
  let estado = cargado([delApi(1, { mesa: 4 }), delApi(2, { mesa: 4 })])
  estado = correr(estado, [
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['estado', cambio('ev-2', 1, 'listo')],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'listo'], [2, 'recibido']])
  assert.deepEqual(contadores(estado), { recibido: 1, en_preparacion: 0, listo: 1 })
})

test('el mismo aviso repetido (mismo eventId) no lo mueve ni lo duplica', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['estado', cambio('ev-2', 1, 'listo')],
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['estado', cambio('ev-2', 1, 'listo')],
    ['creado', creado('ev-0', 1, 4)],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado), [{ id: 1, estado: 'listo', quitados: [] }])
  assert.deepEqual(contadores(estado), { recibido: 0, en_preparacion: 0, listo: 1 })
})

test('el mismo estado con otro eventId, y un created tardio, tampoco duplican', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['local', { id_pedido: 1, nuevoEstado: 'en_preparacion' }],
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['estado', cambio('ev-1b', 1, 'en_preparacion')],
    ['creado', creado('ev-0', 1, 4)],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'en_preparacion']])
  assert.deepEqual(contadores(estado), { recibido: 0, en_preparacion: 1, listo: 0 })
})

// ---------------------------------------------------------------------------
// Avisos durante la recarga
// ---------------------------------------------------------------------------

test('recarga: un order:created que la respuesta aun no trae no se pierde', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['creado', creado('ev-9', 9, 4)],
    // El GET se armo antes de que existiera el 9.
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'recibido'], [9, 'recibido']])
  assert.deepEqual(bloquesDeColumna(estado, 'recibido', AHORA)[0].comandas.map((c) => c.id_pedido).sort(), [1, 9])
  assert.deepEqual(estado.cargas, [], 'la carga se cierra')
})

test('recarga: un order:status no vuelve atras con una respuesta mas vieja', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['estado', cambio('ev-2', 1, 'listo')],
    ['cargar', { comandas: [delApi(1, { mesa: 4, estado: 'en_preparacion' })], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'listo']])
  assert.ok(Number.isFinite(estado.comandas[0].listoEnMs), 'conserva la hora de paso a listo')
})

test('recarga: un order:status de un pedido que el tablero viejo no tenia (pedido 90) se aplica sobre la respuesta', () => {
  // Tras reconectar: el 90 se creo durante el corte, asi que el tablero no lo
  // tiene y el aviso se ignora en vivo; el GET (mas viejo) lo trae en recibido.
  let estado = cargado([])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-90', 90, 'en_preparacion')],
  ])
  assert.deepEqual(foto(estado), [], 'en vivo no se inventa la tarjeta')
  estado = reducer(estado, { tipo: 'cargar', datos: { comandas: [delApi(90, { mesa: 2 })], idCarga: 2 } })
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[90, 'en_preparacion']])
})

test('recarga: un item:cancelado durante la carga no reaparece', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['itemCancelado', quitado('ev-q', 1, 12)],
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado), [{ id: 1, estado: 'recibido', quitados: [12] }])
})

test('recarga: un pedido entregado o cancelado durante la carga no vuelve', () => {
  let estado = cargado([delApi(1, { mesa: 4, estado: 'listo' }), delApi(2, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-e', 1, 'entregado')],
    ['estado', cambio('ev-c', 2, 'cancelado')],
    ['cargar', { comandas: [delApi(1, { mesa: 4, estado: 'listo' }), delApi(2, { mesa: 4 })], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado), [])
})

test('recarga: el movimiento local tras un PATCH propio no vuelve atras', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['local', { id_pedido: 1, nuevoEstado: 'en_preparacion' }],
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
  ])
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'en_preparacion']])
})

test('recarga: un aviso mas viejo que la respuesta no hace retroceder al pedido', () => {
  // El aviso a en_preparacion llega durante la carga, pero el GET se armo
  // despues, cuando el pedido ya estaba listo (su aviso aun no ha llegado).
  let estado = cargado([delApi(1, { mesa: 4 }), delApi(2, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['local', { id_pedido: 2, nuevoEstado: 'en_preparacion' }],
    [
      'cargar',
      {
        comandas: [delApi(1, { mesa: 4, estado: 'listo' }), delApi(2, { mesa: 4, estado: 'listo' })],
        idCarga: 2,
      },
    ],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'listo'], [2, 'listo']])

  // Si el socket reenvia ese aviso viejo, tampoco retrocede; el de listo que
  // faltaba llega y no cambia nada.
  estado = correr(estado, [
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['estado', cambio('ev-2', 1, 'listo')],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'listo'], [2, 'listo']])
  assert.deepEqual(contadores(estado), { recibido: 0, en_preparacion: 0, listo: 1 })
})

test('recarga: el aviso repetido despues de la carga no se aplica dos veces', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-1', 1, 'listo')],
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
    // El socket reenvia el mismo aviso; ya esta visto.
    ['estado', cambio('ev-1', 1, 'listo')],
    ['creado', creado('ev-0', 1, 4)],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'listo']])
})

test('recarga fallida: cierra la carga y conserva lo que llego', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['creado', creado('ev-9', 9)],
    ['error', { mensaje: 'Failed to fetch', idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.equal(estado.error, 'Failed to fetch')
  assert.deepEqual(estado.cargas, [])
  assert.deepEqual(foto(estado).map((p) => p.id), [1, 9])
})

// ---------------------------------------------------------------------------
// Dos recargas seguidas
// ---------------------------------------------------------------------------

test('dos recargas seguidas, una tras otra: cada una con sus avisos', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['creado', creado('ev-5', 5, 4)],
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
    ['cargando', { idCarga: 3 }],
    ['estado', cambio('ev-6', 5, 'en_preparacion')],
    ['cargar', { comandas: [delApi(1, { mesa: 4 }), delApi(5, { mesa: 4 })], idCarga: 3 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'recibido'], [5, 'en_preparacion']])
  assert.deepEqual(contadores(estado), { recibido: 1, en_preparacion: 1, listo: 0 })
  assert.deepEqual(estado.cargas, [])
})

test('dos recargas solapadas: la nueva responde primero y la vieja no la pisa', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['creado', creado('ev-5', 5, 4)],
    ['cargando', { idCarga: 3 }],
    ['estado', cambio('ev-6', 1, 'listo')],
    ['cargar', { comandas: [delApi(1, { mesa: 4, estado: 'listo' }), delApi(5, { mesa: 4 })], idCarga: 3 }],
    ['creado', creado('ev-7', 7)],
    // La respuesta de la carga 2 llega la ultima y es la mas vieja.
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'listo'], [5, 'recibido'], [7, 'recibido']])
  assert.deepEqual(estado.cargas, [])
})

test('dos recargas solapadas: la vieja responde primero y la nueva completa', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['creado', creado('ev-5', 5, 4)],
    ['cargando', { idCarga: 3 }],
    ['estado', cambio('ev-6', 1, 'listo')],
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
    ['itemCancelado', quitado('ev-8', 5, 51)],
    ['cargar', { comandas: [delApi(1, { mesa: 4 }), delApi(5, { mesa: 4 })], idCarga: 3 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado), [
    { id: 1, estado: 'listo', quitados: [] },
    { id: 5, estado: 'recibido', quitados: [51] },
  ])
})

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

test('idempotencia: un order:created que ya viene en la respuesta no se duplica', () => {
  let estado = cargado([delApi(1, { mesa: 4 })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['creado', creado('ev-5', 5, 4)],
    // El GET se armo despues y ya trae el 5 (y mas avanzado).
    ['cargar', { comandas: [delApi(1, { mesa: 4 }), delApi(5, { mesa: 4, estado: 'en_preparacion' })], idCarga: 2 }],
    ['creado', creado('ev-5', 5, 4)],
    ['creado', creado('ev-5b', 5, 4)],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[1, 'recibido'], [5, 'en_preparacion']])
})

test('idempotencia: item:cancelado dos veces da lo mismo que una vez', () => {
  const base = cargado([delApi(1, { mesa: 4 })])
  const una = reducer(base, { tipo: 'itemCancelado', datos: quitado('ev-q', 1, 11) })
  // Mismo eventId: ni siquiera cambia el objeto.
  assert.equal(reducer(una, { tipo: 'itemCancelado', datos: quitado('ev-q', 1, 11) }), una)
  // Otro eventId para la misma linea: mismo tablero.
  assert.deepEqual(foto(reducer(una, { tipo: 'itemCancelado', datos: quitado('ev-q2', 1, 11) })), foto(una))
  // Y durante una recarga, anotado y reaplicado dos veces, tambien.
  const recargado = correr(base, [
    ['cargando', { idCarga: 2 }],
    ['itemCancelado', quitado('ev-q', 1, 11)],
    ['itemCancelado', quitado('ev-q2', 1, 11)],
    ['cargar', { comandas: [delApi(1, { mesa: 4 })], idCarga: 2 }],
  ])
  assert.deepEqual(foto(recargado), foto(una))
})

test('idempotencia: un order:status repetido no cambia nada', () => {
  const base = cargado([delApi(1, { mesa: 4 })])
  const una = reducer(base, { tipo: 'estado', datos: cambio('ev-1', 1, 'en_preparacion') })
  assert.equal(reducer(una, { tipo: 'estado', datos: cambio('ev-1', 1, 'en_preparacion') }), una)
  assert.deepEqual(foto(reducer(una, { tipo: 'estado', datos: cambio('ev-1b', 1, 'en_preparacion') })), foto(una))
})

// ---------------------------------------------------------------------------
// Sin resurrecciones
// ---------------------------------------------------------------------------

test('sin resurrecciones: ningun aviso reaplicado devuelve un pedido que la respuesta ya no trae', () => {
  // Durante la carga el 1 avanza, se le quita un plato y se mueve en local;
  // despues se entrega (su aviso aun no llega) y el GET ya no lo trae.
  let estado = cargado([delApi(1, { mesa: 4 }), delApi(2, { mesa: 4, estado: 'listo' })])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-1', 1, 'en_preparacion')],
    ['itemCancelado', quitado('ev-2', 1, 11)],
    ['local', { id_pedido: 1, nuevoEstado: 'listo' }],
    ['estado', cambio('ev-3', 2, 'listo')],
    ['cargar', { comandas: [], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado), [], 'el 1 (entregado) y el 2 (pagado) no vuelven')
})

test('sin resurrecciones: solo un order:created de un pedido nuevo lo agrega, y el 90 sigue funcionando', () => {
  let estado = cargado([])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['estado', cambio('ev-90', 90, 'en_preparacion')], // creado durante el corte
    ['estado', cambio('ev-80', 80, 'listo')], // se entrego antes del GET
    ['creado', creado('ev-91', 91, 3)], // nuevo de verdad
    ['cargar', { comandas: [delApi(90, { mesa: 2 })], idCarga: 2 }],
  ])
  comprobarBloques(estado)
  assert.deepEqual(foto(estado).map((p) => [p.id, p.estado]), [[90, 'en_preparacion'], [91, 'recibido']])
})

// ---------------------------------------------------------------------------
// Limpieza y tope de las anotaciones
// ---------------------------------------------------------------------------

test('limpieza: tras la respuesta o el error, la carga ya no esta en el estado', () => {
  let estado = cargado([delApi(1)])
  estado = correr(estado, [
    ['cargando', { idCarga: 2 }],
    ['cargando', { idCarga: 3 }],
    ['creado', creado('ev-5', 5)],
  ])
  assert.deepEqual(estado.cargas.map((c) => [c.id, c.avisos.length]), [[2, 1], [3, 1]])
  estado = reducer(estado, { tipo: 'cargar', datos: { comandas: [delApi(1)], idCarga: 2 } })
  assert.deepEqual(estado.cargas.map((c) => c.id), [3])
  estado = reducer(estado, { tipo: 'error', datos: { mensaje: 'Failed to fetch', idCarga: 3 } })
  assert.deepEqual(estado.cargas, [])
  // Sin cargas abiertas no se anota nada.
  estado = reducer(estado, { tipo: 'estado', datos: cambio('ev-6', 5, 'en_preparacion') })
  assert.deepEqual(estado.cargas, [])
})

test(`tope: una carga guarda como maximo ${MAX_EVENTOS_RECORDADOS} avisos (se descartan los mas viejos)`, () => {
  let estado = correr(cargado([]), [['cargando', { idCarga: 2 }]])
  const total = MAX_EVENTOS_RECORDADOS + 20
  for (let i = 1; i <= total; i++) {
    estado = reducer(estado, { tipo: 'creado', datos: creado(`ev-${i}`, i) })
  }
  const avisos = estado.cargas[0].avisos
  assert.equal(avisos.length, MAX_EVENTOS_RECORDADOS)
  assert.equal(avisos[0].datos.pedido.id_pedido, 21, 'los 20 mas viejos se descartan')
  assert.equal(avisos.at(-1).datos.pedido.id_pedido, total)

  // Documentado: los descartados no se reaplican; para esos manda el GET. Aqui
  // el GET trae del 1 al 10: del 11 al 20 no quedan (ni anotados ni en el GET).
  const respuesta = Array.from({ length: 10 }, (_, i) => delApi(i + 1))
  estado = reducer(estado, { tipo: 'cargar', datos: { comandas: respuesta, idCarga: 2 } })
  comprobarBloques(estado)
  const ids = new Set(foto(estado).map((p) => p.id))
  assert.equal(ids.size, 10 + MAX_EVENTOS_RECORDADOS)
  assert.ok(!ids.has(11) && !ids.has(20) && ids.has(21) && ids.has(total))
})

// ---------------------------------------------------------------------------
// Propiedades
// ---------------------------------------------------------------------------

/** Generador con semilla (mulberry32): mismas secuencias en cada corrida. */
function generador(semilla) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEMILLA = 318
const SECUENCIAS = 1000
const PASOS = 40
const SIGUIENTE = { recibido: 'en_preparacion', en_preparacion: 'listo' }

/**
 * Una secuencia: un servidor (la verdad), un socket que entrega en orden y se
 * puede caer (lo que se emite mientras esta caido se pierde) y el tablero, que
 * solo ve lo que le llega. Las recargas siguen a recargar(): se abren al
 * reconectar, al reintentar o cuando el servidor rechaza un PATCH, el GET se
 * arma en algun momento mientras estan abiertas y su respuesta (o su error)
 * llega despues, en cualquier orden.
 */
function simular(azar, stats, numero) {
  const elegir = (lista) => lista[Math.floor(azar() * lista.length)]
  const servidor = new Map() // id -> { mesa, estado, quitados: Set }
  let siguienteId = 1
  let siguienteEvento = 1
  let siguienteCarga = 1
  let conectado = true
  let epoca = 0 // sube con cada caida del socket
  let sincronizado = false
  let cola = [] // avisos emitidos aun no entregados
  const entregados = [] // todos los entregados, en orden
  let reenviablesDesde = 0 // los entregados desde aqui los recuerda el tablero
  let ultimaAplicada = 0
  let cargas = [] // { id, epoca, desde, foto }
  let estado = estadoInicial()

  const emitir = (tipo, datos) => {
    if (conectado) cola.push([tipo, { eventId: `ev-${numero}-${siguienteEvento++}`, ...datos }])
  }
  const fotoServidor = () =>
    [...servidor]
      .filter(([, p]) => ORDEN.includes(p.estado))
      .map(([id, p]) => ({ id, estado: p.estado, quitados: [...p.quitados].sort((x, y) => x - y) }))
      .sort((x, y) => x.id - y.id)
  const comandasServidor = () =>
    fotoServidor().map((p) => delApi(p.id, { mesa: servidor.get(p.id).mesa, estado: p.estado, cancelados: p.quitados }))
  const abrirCarga = () => {
    const id = siguienteCarga++
    cargas.push({ id, epoca: conectado ? epoca : -1, desde: entregados.length, foto: null })
    estado = reducer(estado, { tipo: 'cargando', datos: { idCarga: id } })
  }
  const responder = (carga) => {
    // Casos que interesa que la prueba genere de verdad.
    const durante = entregados.slice(carga.desde)
    for (const [tipo, datos] of durante) {
      const enFoto = carga.foto.find((c) => c.id_pedido === (datos.id_pedido ?? datos.pedido?.id_pedido))
      if (tipo === 'creado' && !enFoto) stats.creadoQueLaRespuestaNoTrae += 1
      if (tipo === 'estado' && enFoto && ORDEN.indexOf(datos.estado) >= 0 && ORDEN.indexOf(datos.estado) < ORDEN.indexOf(enFoto.estado)) {
        stats.avisoMasViejoQueLaRespuesta += 1
      }
    }
    estado = reducer(estado, { tipo: 'cargar', datos: { comandas: carga.foto, idCarga: carga.id } })
    cargas = cargas.filter((c) => c !== carga)
    if (carga.id > ultimaAplicada) {
      // La respuesta aplicada es el piso: ningun aviso reaplicado deja un
      // pedido mas atras de lo que ella trae.
      for (const c of estado.comandas) {
        const delGet = carga.foto.find((f) => f.id_pedido === c.id_pedido)
        if (delGet) {
          assert.ok(
            ORDEN.indexOf(c.estado) >= ORDEN.indexOf(delGet.estado),
            `secuencia ${numero}: el pedido ${c.id_pedido} retrocedio de ${delGet.estado} a ${c.estado}`
          )
        }
      }
      ultimaAplicada = carga.id
      reenviablesDesde = carga.desde
      if (carga.epoca === epoca && conectado) sincronizado = true
    }
  }
  const entregar = () => {
    const [tipo, datos] = cola.shift()
    entregados.push([tipo, datos])
    estado = reducer(estado, { tipo, datos })
    // Idempotencia: el mismo aviso otra vez no cambia nada.
    assert.equal(reducer(estado, { tipo, datos }), estado, `secuencia ${numero}: ${tipo} repetido cambio el estado`)
  }

  const pasos = {
    crear: () => {
      const id = siguienteId++
      const mesa = elegir([1, 2, 3, null])
      servidor.set(id, { mesa, estado: 'recibido', quitados: new Set() })
      const pedido = creado('x', id, mesa).pedido
      emitir('creado', { recibidoEnMs: AHORA, pedido })
    },
    avanzarOtraPantalla: () => {
      const candidatos = [...servidor].filter(([, p]) => SIGUIENTE[p.estado])
      if (!candidatos.length) return
      const [id, p] = elegir(candidatos)
      p.estado = SIGUIENTE[p.estado]
      emitir('estado', { id_pedido: id, estado: p.estado })
    },
    avanzarDesdeEsteKds: () => {
      const candidatos = estado.comandas.filter((c) => SIGUIENTE[c.estado])
      if (!candidatos.length) return
      const c = elegir(candidatos)
      const p = servidor.get(c.id_pedido)
      if (p.estado !== c.estado) {
        // El trigger rechaza la transicion: avanzar() recarga el tablero.
        abrirCarga()
        return
      }
      p.estado = SIGUIENTE[p.estado]
      estado = reducer(estado, { tipo: 'local', datos: { id_pedido: c.id_pedido, nuevoEstado: p.estado } })
      emitir('estado', { id_pedido: c.id_pedido, estado: p.estado })
    },
    entregar: () => {
      const candidatos = [...servidor].filter(([, p]) => p.estado === 'listo')
      if (!candidatos.length) return
      const [id, p] = elegir(candidatos)
      p.estado = 'entregado'
      emitir('estado', { id_pedido: id, estado: 'entregado' })
    },
    cancelarPedido: () => {
      const candidatos = [...servidor].filter(([, p]) => SIGUIENTE[p.estado])
      if (!candidatos.length) return
      const [id, p] = elegir(candidatos)
      p.estado = 'cancelado'
      emitir('estado', { id_pedido: id, estado: 'cancelado' })
    },
    quitarPlato: () => {
      const candidatos = [...servidor].filter(([id, p]) => SIGUIENTE[p.estado] && p.quitados.size < 2 && id)
      if (!candidatos.length) return
      const [id, p] = elegir(candidatos)
      const detalle = elegir([id * 10 + 1, id * 10 + 2].filter((d) => !p.quitados.has(d)))
      p.quitados.add(detalle)
      emitir('itemCancelado', { id_pedido: id, id_detalle: detalle })
    },
    entregarAviso: () => {
      if (cola.length) entregar()
    },
    reenviarAviso: () => {
      // El socket-server reintenta: repite un aviso que el tablero ya vio.
      const vistos = entregados.slice(reenviablesDesde)
      if (!vistos.length) return
      const [tipo, datos] = elegir(vistos)
      estado = reducer(estado, { tipo, datos })
    },
    caerSocket: () => {
      if (!conectado) return
      conectado = false
      epoca += 1
      sincronizado = false
      cola = []
    },
    reconectar: () => {
      if (conectado) return
      conectado = true
      abrirCarga()
    },
    reintentar: () => abrirCarga(),
    armarRespuesta: () => {
      const sinFoto = cargas.filter((c) => !c.foto)
      if (sinFoto.length) elegir(sinFoto).foto = comandasServidor()
    },
    llegaRespuesta: () => {
      const conFoto = cargas.filter((c) => c.foto)
      if (conFoto.length) responder(elegir(conFoto))
    },
    fallaRespuesta: () => {
      if (!cargas.length) return
      const carga = elegir(cargas)
      estado = reducer(estado, { tipo: 'error', datos: { mensaje: 'Failed to fetch', idCarga: carga.id } })
      cargas = cargas.filter((c) => c !== carga)
    },
  }
  const pesos = {
    crear: 4,
    avanzarOtraPantalla: 2,
    avanzarDesdeEsteKds: 3,
    entregar: 1,
    cancelarPedido: 1,
    quitarPlato: 1,
    entregarAviso: 8,
    reenviarAviso: 2,
    caerSocket: 1,
    reconectar: 2,
    reintentar: 1,
    armarRespuesta: 3,
    llegaRespuesta: 3,
    fallaRespuesta: 1,
  }
  const bolsa = Object.entries(pesos).flatMap(([nombre, peso]) => Array(peso).fill(nombre))

  const comprobar = (donde) => {
    comprobarBloques(estado, donde)
    // Limpieza y tope: en el estado solo quedan las cargas abiertas, ninguna
    // por encima del tope.
    assert.deepEqual(
      (estado.cargas || []).map((c) => c.id),
      cargas.map((c) => c.id),
      `${donde} cargas en el estado`
    )
    for (const c of estado.cargas || []) assert.ok(c.avisos.length <= MAX_EVENTOS_RECORDADOS, `${donde} tope`)
    if (sincronizado && cola.length === 0) {
      assert.deepEqual(foto(estado), fotoServidor(), `${donde} el tablero no coincide con el servidor`)
      stats.comparaciones += 1
    }
  }

  abrirCarga()
  for (let paso = 0; paso < PASOS; paso++) {
    const nombre = elegir(bolsa)
    pasos[nombre]()
    comprobar(`secuencia ${numero} (semilla ${SEMILLA}), paso ${paso} (${nombre}):`)
  }

  // Al final todo se calma: vuelve el socket, llegan los avisos y responden
  // las cargas. El tablero tiene que acabar igual que el servidor.
  if (!conectado) pasos.reconectar()
  while (cola.length) entregar()
  if (!sincronizado) abrirCarga()
  for (const carga of cargas) if (!carga.foto) carga.foto = comandasServidor()
  while (cargas.length) responder(elegir(cargas))
  assert.equal(sincronizado, true, `secuencia ${numero}: no llego a sincronizar`)
  comprobar(`secuencia ${numero} (semilla ${SEMILLA}), al final:`)
}

test(`propiedades: ${SECUENCIAS} secuencias al azar (semilla ${SEMILLA}) sin duplicar ni perder pedidos`, () => {
  const azar = generador(SEMILLA)
  const stats = { comparaciones: 0, creadoQueLaRespuestaNoTrae: 0, avisoMasViejoQueLaRespuesta: 0 }
  for (let numero = 0; numero < SECUENCIAS; numero++) simular(azar, stats, numero)

  // Que la prueba de verdad pase por los casos de la recarga.
  assert.ok(stats.comparaciones > SECUENCIAS, `comparaciones con el servidor: ${stats.comparaciones}`)
  assert.ok(stats.creadoQueLaRespuestaNoTrae > 0, 'genera created que la respuesta no trae')
  assert.ok(stats.avisoMasViejoQueLaRespuesta > 0, 'genera avisos mas viejos que la respuesta')
})
