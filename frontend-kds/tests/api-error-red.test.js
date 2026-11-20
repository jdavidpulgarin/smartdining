/**
 * El cliente de la API ante un fallo de RED frente a un error del BACKEND.
 *
 * Sin red, el navegador lanza un TypeError con su propio texto en ingles
 * ("Failed to fetch"), y ese texto acababa en la pantalla de cocina. Ahora el
 * cliente lo cambia por un mensaje en espanol, SIN status, que es lo que la
 * logica usa para saber que no hubo respuesta (sinRespuesta, aviso 'error').
 * Lo que manda el backend, con su status y su texto, no se toca.
 *
 * fetch se simula en cada prueba: aqui no sale nada a la red.
 */

import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  ErrorApi,
  MENSAJE_SIN_CONEXION,
  cambiarEstadoComanda,
  cambiarDisponibilidadIngrediente,
  login,
  obtenerComandas,
  obtenerMenu,
} from '../src/services/api.js'

const fetchOriginal = globalThis.fetch

afterEach(() => {
  globalThis.fetch = fetchOriginal
})

/** Una respuesta del backend con su status y su cuerpo JSON (o sin cuerpo). */
function responder(status, cuerpo, cabeceras = {}) {
  globalThis.fetch = async () =>
    new Response(cuerpo === undefined ? null : JSON.stringify(cuerpo), {
      status,
      headers: { 'Content-Type': 'application/json', ...cabeceras },
    })
}

/** Lo que hace el navegador cuando la peticion no llega: rechaza con TypeError. */
function sinRed(texto = 'Failed to fetch') {
  const original = new TypeError(texto)
  globalThis.fetch = async () => {
    throw original
  }
  return original
}

// ---------------------------------------------------------------------------
// Sin red
// ---------------------------------------------------------------------------

test('sin red, el error sale en espanol y sin status', async () => {
  const original = sinRed()

  await assert.rejects(obtenerComandas('token'), (error) => {
    assert.ok(error instanceof ErrorApi)
    assert.equal(error.message, MENSAJE_SIN_CONEXION)
    assert.equal(error.message, 'Sin conexión con el servidor. Intenta de nuevo.')
    // Sin status: asi useTablero sigue marcando sinRespuesta (!error.status) y
    // el cajon de agotados sigue mostrando 'error' y no 'prohibido'.
    assert.equal(error.status, null)
    assert.equal(!error.status, true)
    // El original se conserva para depurar.
    assert.equal(error.cause, original)
    return true
  })
})

test('sin red, el mensaje no depende del texto de cada navegador', async () => {
  for (const texto of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
    sinRed(texto)
    await assert.rejects(cambiarEstadoComanda('token', 7, 'listo'), {
      message: MENSAJE_SIN_CONEXION,
      status: null,
    })
  }
})

test('sin red, todas las llamadas pasan por el mismo cliente: tambien agotados y login', async () => {
  sinRed()
  await assert.rejects(obtenerMenu(), { message: MENSAJE_SIN_CONEXION, status: null })
  await assert.rejects(cambiarDisponibilidadIngrediente('token', 3, false), {
    message: MENSAJE_SIN_CONEXION,
    status: null,
  })
  await assert.rejects(login('cocina@demo.local', 'x'), { message: MENSAJE_SIN_CONEXION, status: null })
})

test('si la conexion se corta a mitad del cuerpo, es el mismo error de red', async () => {
  const original = new TypeError('terminated')
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => {
      throw original
    },
  })

  await assert.rejects(obtenerComandas('token'), (error) => {
    assert.ok(error instanceof ErrorApi)
    assert.equal(error.message, MENSAJE_SIN_CONEXION)
    assert.equal(error.status, null)
    assert.equal(error.cause, original)
    return true
  })
})

test('un error que no es de red (p. ej. una peticion abortada) sale tal cual', async () => {
  const abortada = new DOMException('The operation was aborted.', 'AbortError')
  globalThis.fetch = async () => {
    throw abortada
  }

  await assert.rejects(obtenerComandas('token'), (error) => {
    assert.equal(error, abortada)
    return true
  })
})

// ---------------------------------------------------------------------------
// Errores del backend: se quedan como estaban
// ---------------------------------------------------------------------------

test('un error del backend conserva su mensaje y su status', async () => {
  responder(409, { error: 'La comanda ya estaba lista' })

  await assert.rejects(cambiarEstadoComanda('token', 7, 'listo'), (error) => {
    assert.ok(error instanceof ErrorApi)
    assert.equal(error.message, 'La comanda ya estaba lista')
    assert.equal(error.status, 409)
    assert.equal(error.cause, undefined)
    return true
  })
})

test('un 500 sin cuerpo sigue diciendo "Error 500"', async () => {
  responder(500)
  await assert.rejects(obtenerComandas('token'), { message: 'Error 500', status: 500 })
})

test('un 429 sin cuerpo conserva su aviso y su espera', async () => {
  responder(429)
  await assert.rejects(obtenerComandas('token'), {
    message: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo',
    status: 429,
    retryAfter: 60,
  })
})

test('un 403 del backend no se confunde con un fallo de red', async () => {
  responder(403, { error: 'No tienes permisos' })
  await assert.rejects(obtenerMenu(), { message: 'No tienes permisos', status: 403 })
})

test('con respuesta correcta no cambia nada', async () => {
  responder(200, { comandas: [{ id_pedido: 1 }] })
  assert.deepEqual(await obtenerComandas('token'), [{ id_pedido: 1 }])
})
