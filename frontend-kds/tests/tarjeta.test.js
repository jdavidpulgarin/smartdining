/**
 * Lo que la tarjeta muestra en la cabecera: quien pidio y que cuenta el reloj.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { comensalesDeComanda } from '../src/lib/comandas.js'
import { minutosDelReloj } from '../src/lib/pase.js'

const MINUTO = 60_000

function comanda(...comensales) {
  return { id_pedido: 1, items: comensales.map((comensal) => ({ comensal })) }
}

// ---------------------------------------------------------------------------
// Comensales en la cabecera
// ---------------------------------------------------------------------------

test('lista los comensales de la mesa', () => {
  assert.deepEqual(comensalesDeComanda(comanda('Ana', 'Luis')), ['Ana', 'Luis'])
})

test('quien pidio tres cosas sigue siendo una persona', () => {
  assert.deepEqual(comensalesDeComanda(comanda('Ana', 'Luis', 'Ana')), ['Ana', 'Luis'])
})

test('el orden es el de los platos, no alfabetico', () => {
  // La cabecera se lee junto a la lista de platos de debajo: si fueran ordenes
  // distintos, casar nombre con plato costaria mas de lo que ayuda.
  assert.deepEqual(comensalesDeComanda(comanda('Zoe', 'Ana')), ['Zoe', 'Ana'])
})

test('los items sin comensal no dejan huecos', () => {
  // El socket no siempre manda el comensal: un hueco o un guion en la cabecera
  // solo haria dudar de si falta alguien.
  const sinNombre = { items: [{ comensal: 'Ana' }, {}, { comensal: null }, { comensal: '  ' }] }

  assert.deepEqual(comensalesDeComanda(sinNombre), ['Ana'])
})

test('los nombres vienen recortados', () => {
  assert.deepEqual(comensalesDeComanda(comanda(' Ana ', 'Ana')), ['Ana'])
})

test('una comanda sin items o rota devuelve una lista vacia', () => {
  for (const rota of [undefined, null, {}, { items: null }, { items: 'nada' }, { items: [] }]) {
    assert.deepEqual(comensalesDeComanda(rota), [])
  }
})

// ---------------------------------------------------------------------------
// Que cuenta el reloj grande (el "N min en pase" de la columna del pase)
// ---------------------------------------------------------------------------

test('en el pase el reloj cuenta los minutos sin recoger, y lo dice', () => {
  // La tarjeta escribe "en pase" junto a la cifra solo si este flag es true:
  // sin el, el 9 de "9 min" parece el total desde que se pidio, que es otro
  // numero y mucho mayor.
  const ahora = Date.now()
  const lista = { estado: 'listo', listoEnMs: ahora - 9 * MINUTO }

  const reloj = minutosDelReloj(lista, 47, ahora)

  assert.equal(reloj.minutos, 9)
  assert.equal(reloj.enPase, true)
})

test('en Nuevas y En preparacion el reloj es el total y no lleva el "en pase"', () => {
  const ahora = Date.now()

  for (const estado of ['recibido', 'en_preparacion']) {
    const reloj = minutosDelReloj({ estado }, 12, ahora)
    assert.equal(reloj.minutos, 12, estado)
    assert.equal(reloj.enPase, false, estado)
  }
})

test('sin hora de "listo" el reloj cae al total y tampoco dice "en pase"', () => {
  // Mejor un dato real aunque sea otro que un 0 inventado; y si la cifra es el
  // total, llamarla "en pase" seria mentir.
  const reloj = minutosDelReloj({ estado: 'listo' }, 47, Date.now())

  assert.equal(reloj.minutos, 47)
  assert.equal(reloj.enPase, false)
})
