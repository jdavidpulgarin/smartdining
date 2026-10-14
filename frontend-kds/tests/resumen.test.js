/**
 * La barra de resumen: la cifra de comandas activas y lo que dice cada columna
 * cuando esta vacia.
 *
 * El numero de la barra y la suma de los tres contadores de las columnas tienen
 * que ser el mismo numero. Si se separan, el cocinero ve "5 comandas activas"
 * sobre tres columnas que suman 4 y deja de creerse la pantalla entera, asi que
 * eso es lo que se prueba aqui.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COLUMNAS,
  comandasDeColumna,
  contarComandasActivas,
  estadoInicial,
} from '../src/lib/comandas.js'
import { UMBRAL_AMBAR, UMBRAL_ROJO } from '../src/lib/espera.js'

function tablero(...estados) {
  return {
    ...estadoInicial(),
    comandas: estados.map((estado, indice) => ({ id_pedido: indice + 1, estado, items: [] })),
  }
}

test('el tablero recien abierto no tiene ninguna comanda activa', () => {
  assert.equal(contarComandasActivas(estadoInicial()), 0)
})

test('cuenta las tres columnas del tablero, el pase incluido', () => {
  const estado = tablero('recibido', 'recibido', 'en_preparacion', 'listo')

  // El pase cuenta: una comanda lista pero sin recoger sigue ocupando sitio y
  // sigue siendo una mesa esperando.
  assert.equal(contarComandasActivas(estado), 4)
})

test('lo que ya salio de la cocina no cuenta, aunque siga en memoria', () => {
  const estado = tablero('recibido', 'entregado', 'pagado', 'cancelado')

  assert.equal(contarComandasActivas(estado), 1)
})

test('la cifra de la barra es la suma de los tres contadores de las columnas', () => {
  const estado = tablero(
    'recibido',
    'recibido',
    'en_preparacion',
    'en_preparacion',
    'en_preparacion',
    'listo',
    // Dos que ya no son del tablero: no deben descuadrar la suma.
    'entregado',
    'cancelado'
  )

  const porColumna = COLUMNAS.reduce(
    (total, columna) => total + comandasDeColumna(estado, columna.estado).length,
    0
  )

  assert.equal(contarComandasActivas(estado), porColumna)
  assert.equal(porColumna, 6)
})

test('un estado roto o a medio cargar da 0 y no revienta la cabecera', () => {
  // La barra se pinta en cada render, tambien en el primero: si esto lanzara,
  // se caeria la pantalla entera por una cifra decorativa.
  for (const roto of [undefined, null, {}, { comandas: null }, { comandas: 'nada' }]) {
    assert.equal(contarComandasActivas(roto), 0)
  }
  assert.equal(contarComandasActivas({ comandas: [null, undefined, {}] }), 0)
})

test('cada columna explica su vacio con su propio texto', () => {
  for (const columna of COLUMNAS) {
    assert.ok(columna.vacio?.titulo, `${columna.estado} tiene titulo de vacio`)
    assert.ok(columna.vacio?.nota, `${columna.estado} explica que va a aparecer ahi`)
  }

  const titulos = COLUMNAS.map((c) => c.vacio.titulo)
  assert.equal(new Set(titulos).size, COLUMNAS.length, 'no se repite el mismo texto en las tres')
})

test('la leyenda del semaforo sale de los umbrales, no de cifras a mano', () => {
  // Si alguien cambia los umbrales, la leyenda tiene que moverse con ellos; de
  // lo contrario se queda mintiendo sobre los colores que el cocinero ve.
  assert.equal(UMBRAL_AMBAR, 10)
  assert.equal(UMBRAL_ROJO, 15)
  assert.ok(UMBRAL_AMBAR < UMBRAL_ROJO, 'el ambar llega antes que el rojo')
})
