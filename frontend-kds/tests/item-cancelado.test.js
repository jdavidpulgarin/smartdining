/**
 * item:cancelado en el tablero (D-13 y #180): alguien quito UNA linea del
 * pedido. La linea se TACHA en vivo, igual que la trae la API al recargar
 * (GET /api/kds/comandas no filtra las canceladas: llegan con
 * estado_item 'cancelado').
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import * as lib from '../src/lib/comandas.js'

/** Una comanda como la da la API, con sus lineas vivas. */
function comandaApi(id_pedido, estado, items) {
  return {
    id_pedido,
    codigo_pedido: `PED-261112-${id_pedido}`,
    id_mesa: 4,
    mesa_numero: 4,
    estado,
    minutos_transcurridos: 2,
    items: items.map(([id_detalle, plato_nombre, comensal, estado_item = 'pendiente']) => ({
      id_detalle, cantidad: 1, plato_nombre, comensal, estado_item, notas_especiales: null, ingredientes: [],
    })),
  }
}

/** El payload de item:cancelado del socket-server (#181). */
function itemCancelado(eventId, id_pedido, id_detalle, extra = {}) {
  return {
    eventId, id_pedido, id_mesa: 4, codigo_pedido: `PED-261112-${id_pedido}`, id_detalle,
    nombre: 'Plato', comensal: 'Ana', total: 20000, estado_pedido: 'en_preparacion', origen: 'personal',
    emitidoEn: '2026-11-12T15:00:00.000Z', ...extra,
  }
}

const tablero = (...comandas) => lib.cargarInicial(lib.estadoInicial(), comandas)
const lineas = (estado, idPedido) => estado.comandas.find((c) => c.id_pedido === idPedido).items
const estadosDe = (estado, idPedido) => lineas(estado, idPedido).map((i) => i.estado_item)

test('item:cancelado tacha una linea de una comanda EN PREPARACION (cocinando) y deja las demas', () => {
  const inicio = tablero(comandaApi(10, 'en_preparacion', [[1, 'Bandeja', 'Ana', 'cocinando'], [2, 'Limonada', 'Luis']]))

  const despues = lib.aplicarItemCancelado(inicio, itemCancelado('e-1', 10, 1))

  assert.deepEqual(estadosDe(despues, 10), ['cancelado', 'pendiente'])
  assert.equal(lib.lineaCancelada(lineas(despues, 10)[0]), true)
  assert.equal(lib.lineaCancelada(lineas(despues, 10)[1]), false)
  assert.equal(despues.comandas[0].estado, 'en_preparacion', 'la comanda no cambia de columna')
  assert.notEqual(despues, inicio, 'estado nuevo (React detecta el cambio)')
  assert.equal(inicio.comandas[0].items[0].estado_item, 'cocinando', 'no modifica el estado que recibe')
})

test('item:cancelado tacha una linea de una comanda LISTA en el pase', () => {
  const inicio = tablero(comandaApi(11, 'listo', [[3, 'Alitas', 'Ana', 'listo'], [4, 'Nachos', 'Beto', 'listo']]))

  const despues = lib.aplicarItemCancelado(inicio, itemCancelado('e-2', 11, 4, { estado_pedido: 'listo' }))

  assert.deepEqual(estadosDe(despues, 11), ['listo', 'cancelado'])
  assert.equal(lib.comandasDeColumna(despues, 'listo').length, 1, 'sigue en el pase')
})

test('un item:cancelado repetido (mismo eventId) se ignora', () => {
  const inicio = tablero(comandaApi(12, 'recibido', [[5, 'Bandeja', 'Ana'], [6, 'Jugo', 'Ana']]))
  const una = lib.aplicarItemCancelado(inicio, itemCancelado('e-3', 12, 5))

  const dos = lib.aplicarItemCancelado(una, itemCancelado('e-3', 12, 5))

  assert.equal(dos, una, 'mismo estado: no se vuelve a aplicar')
  assert.equal(dos.eventos.filter((e) => e === 'e-3').length, 1)
})

test('item:cancelado de una comanda que el tablero no tiene se ignora (no inventa una tarjeta)', () => {
  const inicio = tablero(comandaApi(13, 'recibido', [[7, 'Bandeja', 'Ana']]))

  const despues = lib.aplicarItemCancelado(inicio, itemCancelado('e-4', 999, 7))

  assert.deepEqual(despues.comandas, inicio.comandas)
  assert.deepEqual(estadosDe(despues, 13), ['pendiente'])
  assert.ok(despues.eventos.includes('e-4'), 'se recuerda el eventId, como order:status')
})

test('item:cancelado de una linea que la comanda no tiene, o sin id_detalle, no toca nada', () => {
  const inicio = tablero(comandaApi(14, 'recibido', [[8, 'Bandeja', 'Ana']]))

  assert.deepEqual(lib.aplicarItemCancelado(inicio, itemCancelado('e-5', 14, 404)).comandas, inicio.comandas)
  assert.equal(lib.aplicarItemCancelado(inicio, itemCancelado('e-6', 14, null)), inicio)
  assert.equal(lib.aplicarItemCancelado(inicio, null), inicio)
})

test('la ULTIMA linea viva: se tacha y la comanda se queda; la saca el order:status -> cancelado que llega despues', () => {
  const inicio = tablero(comandaApi(15, 'recibido', [[9, 'Bandeja', 'Ana', 'cancelado'], [10, 'Jugo', 'Ana']]))

  const sinVivas = lib.aplicarItemCancelado(inicio, itemCancelado('e-7', 15, 10, { estado_pedido: 'cancelado' }))
  assert.deepEqual(estadosDe(sinVivas, 15), ['cancelado', 'cancelado'])
  assert.equal(sinVivas.comandas.length, 1, 'no se saca por adelantado')

  const tras = lib.aplicarEstado(sinVivas, { eventId: 'e-8', id_pedido: 15, estado: 'cancelado', estado_anterior: 'recibido' })
  assert.equal(tras.comandas.length, 0, 'el order:status la saca del tablero, como hoy')
})

test('al RECARGAR, la linea cancelada se ve igual que en vivo', () => {
  // En vivo: la API la dio viva y llego el item:cancelado.
  const enVivo = lib.aplicarItemCancelado(
    tablero(comandaApi(16, 'en_preparacion', [[11, 'Bandeja', 'Ana'], [12, 'Jugo', 'Luis']])),
    itemCancelado('e-9', 16, 11)
  )
  // Al recargar: la API ya la trae con estado_item 'cancelado' (no la filtra).
  const recargado = tablero(comandaApi(16, 'en_preparacion', [[11, 'Bandeja', 'Ana', 'cancelado'], [12, 'Jugo', 'Luis']]))

  const vista = (estado) => lineas(estado, 16).map((i) => [i.id_detalle, lib.lineaCancelada(i)])
  assert.deepEqual(vista(enVivo), vista(recargado))
  assert.deepEqual(vista(enVivo), [[11, true], [12, false]])
  assert.deepEqual(lib.comensalesDeComanda(enVivo.comandas[0]), lib.comensalesDeComanda(recargado.comandas[0]))
})

test('la cabecera no cuenta al comensal de una linea cancelada (si no le queda otra viva)', () => {
  const comanda = comandaApi(17, 'recibido', [[13, 'Bandeja', 'Ana', 'cancelado'], [14, 'Jugo', 'Luis'], [15, 'Arepa', 'Ana', 'cancelado']])
  assert.deepEqual(lib.comensalesDeComanda(comanda), ['Luis'])

  const conOtraViva = comandaApi(18, 'recibido', [[16, 'Bandeja', 'Ana', 'cancelado'], [17, 'Jugo', 'Ana']])
  assert.deepEqual(lib.comensalesDeComanda(conOtraViva), ['Ana'])
})

test('una comanda que entra por order:created trae sus lineas vivas (estado_item pendiente)', () => {
  const estado = lib.aplicarCreado(lib.estadoInicial(), {
    eventId: 'e-10',
    pedido: { id_pedido: 19, id_mesa: 4, estado: 'recibido', items: [{ id_detalle: 18, cantidad: 1, nombre: 'Bandeja' }] },
  })
  assert.equal(estado.comandas[0].items[0].estado_item, 'pendiente')
  assert.equal(lib.lineaCancelada(estado.comandas[0].items[0]), false)

  const cancelada = lib.aplicarItemCancelado(estado, itemCancelado('e-11', 19, 18))
  assert.equal(lib.lineaCancelada(cancelada.comandas[0].items[0]), true)
})
