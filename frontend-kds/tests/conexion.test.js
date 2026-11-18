/**
 * Que pasa en la pantalla cuando se cae algo.
 *
 * Son dos caidas distintas y la diferencia importa: el socket (tiempo real) y
 * la API (HTTP). El KDS avanza las comandas por HTTP, asi que un socket caido
 * NO impide trabajar, y bloquear el boton por eso le quitaria al cocinero una
 * accion que si habria funcionado.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { avisoDelTablero, debeEsperarConexion } from '../src/lib/comandas.js'

// ---------------------------------------------------------------------------
// El aviso de arriba del tablero
// ---------------------------------------------------------------------------

test('con todo en orden no hay aviso', () => {
  assert.equal(avisoDelTablero({ conectado: true, error: null }), null)
})

test('el socket caido avisa aunque la API no haya dado ningun error', () => {
  // Este es el caso que antes no pintaba nada: la ultima carga fue bien, no hay
  // error que mostrar, y sin embargo la pantalla esta congelada.
  assert.equal(avisoDelTablero({ conectado: false, error: null }), 'desconexion')
})

test('con el socket vivo, un fallo de la API se muestra como error', () => {
  assert.equal(avisoDelTablero({ conectado: true, error: 'Error 500' }), 'error')
})

test('si se caen las dos cosas manda el aviso de conexion', () => {
  // Dos avisos rojos apilados no informan el doble. El de conexion es el que
  // dice que hacer, y el mensaje de la API casi siempre seria consecuencia.
  assert.equal(avisoDelTablero({ conectado: false, error: 'Error de red' }), 'desconexion')
})

// ---------------------------------------------------------------------------
// El boton de la tarjeta tras un PATCH fallido
// ---------------------------------------------------------------------------

test('si el PATCH salio bien el boton nunca espera', () => {
  assert.equal(debeEsperarConexion({ ok: true }, false), false)
  assert.equal(debeEsperarConexion(null, false), false)
  assert.equal(debeEsperarConexion(undefined, true), false)
})

test('el socket caido por si solo NO bloquea el boton', () => {
  // Nada ha fallado todavia: el avance va por HTTP y puede funcionar
  // perfectamente con el tiempo real caido.
  assert.equal(debeEsperarConexion(null, false), false)
})

test('un rechazo del servidor deja el boton activo para reintentar', () => {
  // Un 409 del trigger o un 500 son respuestas: el servidor esta ahi. Puede ser
  // un choque puntual, y lo sensato es dejar tocar otra vez.
  const rechazo = { ok: false, mensaje: 'La comanda ya estaba lista', sinRespuesta: false }

  assert.equal(debeEsperarConexion(rechazo, true), false)
  assert.equal(debeEsperarConexion(rechazo, false), false)
})

test('el boton espera solo si el PATCH no llego Y el socket esta caido', () => {
  const sinRed = { ok: false, mensaje: 'Failed to fetch', sinRespuesta: true }

  // Con el socket caido hay quien lo desbloquee: la reconexion.
  assert.equal(debeEsperarConexion(sinRed, false), true)
})

test('sin respuesta pero con el socket vivo, el boton sigue activo', () => {
  // Si se bloqueara aqui no habria reconexion que lo despertara y la tarjeta se
  // quedaria muerta hasta recargar la pagina.
  const sinRed = { ok: false, mensaje: 'Failed to fetch', sinRespuesta: true }

  assert.equal(debeEsperarConexion(sinRed, true), false)
})
