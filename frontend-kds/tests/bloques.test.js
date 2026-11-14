/**
 * T10 · Una tarjeta por mesa: el agrupado, "Todo listo" y como se recalcula en
 * vivo con los eventos del socket.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agruparPorMesa,
  bloquesDeColumna,
  estadoDelBloque,
  marcarTodoListo,
  pasosHastaListo,
  preguntaTodoListo,
} from '../src/lib/bloques.js'
import {
  aplicarCreado,
  aplicarEstado,
  aplicarItemCancelado,
  cargarInicial,
  estadoInicial,
  lineaCancelada,
} from '../src/lib/comandas.js'

const MINUTO = 60_000
const AHORA = Date.parse('2026-11-13T20:00:00Z')

/** Comanda como la trae GET /kds/comandas, creada hace `hace` minutos. */
function comanda(id, { mesa = null, numero = mesa, hace = 0, estado = 'recibido', canal, items } = {}) {
  return {
    id_pedido: id,
    codigo_pedido: `PED-261113-${String(id).padStart(5, '0')}`,
    id_mesa: mesa,
    mesa_numero: mesa === null ? null : numero,
    canal: canal ?? (mesa === null ? 'para_llevar' : 'mesa'),
    estado,
    creado_en: new Date(AHORA - hace * MINUTO).toISOString(),
    items: items ?? [{ id_detalle: id * 10, cantidad: 1, plato_nombre: 'Bowl', comensal: `C${id}`, estado_item: 'pendiente' }],
  }
}

// ---------------------------------------------------------------------------
// Agrupar
// ---------------------------------------------------------------------------

test('t10: los pedidos de la misma mesa van en un solo bloque', () => {
  const bloques = agruparPorMesa(
    [comanda(1, { mesa: 7, numero: 3, hace: 5 }), comanda(2, { mesa: 9, hace: 4 }), comanda(3, { mesa: 7, numero: 3, hace: 2 })],
    AHORA
  )
  assert.equal(bloques.length, 2)
  assert.equal(bloques[0].titulo, 'Mesa 3')
  assert.equal(bloques[0].conMesa, true)
  assert.deepEqual(bloques[0].comandas.map((c) => c.id_pedido), [1, 3])
  assert.deepEqual(bloques[1].comandas.map((c) => c.id_pedido), [2])
})

test('t10: los pedidos sin mesa NO se agrupan y se rotulan por canal', () => {
  const bloques = agruparPorMesa(
    [
      comanda(1, { canal: 'para_llevar', hace: 3 }),
      comanda(2, { canal: 'domicilio', hace: 2 }),
      comanda(3, { canal: 'para_llevar', hace: 1 }),
    ],
    AHORA
  )
  assert.equal(bloques.length, 3)
  assert.deepEqual(
    bloques.map((b) => b.titulo),
    ['Para llevar #PED-261113-00001', 'Domicilio #PED-261113-00002', 'Para llevar #PED-261113-00003']
  )
  assert.ok(bloques.every((b) => !b.conMesa && b.comandas.length === 1))
})

test('t10: sin canal (llego por order:created) el pedido sin mesa sale como "Sin mesa #codigo"', () => {
  const sinCanal = { ...comanda(4), canal: null }
  assert.equal(agruparPorMesa([sinCanal], AHORA)[0].titulo, 'Sin mesa #PED-261113-00004')
})

test('t10: bloques ordenados por su comanda mas antigua; dentro, por creado_en', () => {
  const bloques = agruparPorMesa(
    [
      comanda(1, { mesa: 1, hace: 3 }),
      comanda(2, { mesa: 2, hace: 20 }),
      comanda(3, { canal: 'domicilio', hace: 10 }),
      comanda(4, { mesa: 1, hace: 30 }),
      comanda(5, { mesa: 2, hace: 1 }),
    ],
    AHORA
  )
  // Mesa 1 lleva 30 (pedido 4), Mesa 2 lleva 20, el domicilio 10.
  assert.deepEqual(bloques.map((b) => b.titulo), ['Mesa 1', 'Mesa 2', 'Domicilio #PED-261113-00003'])
  assert.deepEqual(bloques[0].comandas.map((c) => c.id_pedido), [4, 1])
  assert.deepEqual(bloques[1].comandas.map((c) => c.id_pedido), [2, 5])
})

test('t10: el tiempo del bloque es el de su comanda mas antigua', () => {
  const [bloque] = agruparPorMesa([comanda(1, { mesa: 1, hace: 4 }), comanda(2, { mesa: 1, hace: 17 })], AHORA)
  assert.equal(bloque.minutos, 17)
})

test('t10: el bloque va en la columna de su pedido mas atrasado', () => {
  assert.equal(estadoDelBloque([{ estado: 'listo' }, { estado: 'recibido' }]), 'recibido')
  assert.equal(estadoDelBloque([{ estado: 'listo' }, { estado: 'en_preparacion' }]), 'en_preparacion')
  assert.equal(estadoDelBloque([{ estado: 'listo' }]), 'listo')

  const estado = cargarInicial(estadoInicial(), [
    comanda(1, { mesa: 1, hace: 9, estado: 'listo' }),
    comanda(2, { mesa: 1, hace: 2, estado: 'recibido' }),
    comanda(3, { mesa: 2, hace: 5, estado: 'en_preparacion' }),
  ])
  const nuevas = bloquesDeColumna(estado, 'recibido', AHORA)
  assert.deepEqual(nuevas.map((b) => b.titulo), ['Mesa 1'])
  assert.deepEqual(nuevas[0].comandas.map((c) => c.id_pedido), [1, 2], 'el pedido listo va dentro de su mesa')
  assert.deepEqual(bloquesDeColumna(estado, 'en_preparacion', AHORA).map((b) => b.titulo), ['Mesa 2'])
  assert.equal(bloquesDeColumna(estado, 'listo', AHORA).length, 0, 'una mesa no se parte en dos columnas')
})

test('t10: el numero de mesa sale del pedido que lo trae aunque el primero llegara por socket', () => {
  const porSocket = { ...comanda(1, { mesa: 7, hace: 6 }), mesa_numero: null }
  const [bloque] = agruparPorMesa([porSocket, comanda(2, { mesa: 7, numero: 3, hace: 1 })], AHORA)
  assert.equal(bloque.titulo, 'Mesa 3')
  assert.equal(agruparPorMesa([porSocket], AHORA)[0].titulo, 'Mesa 7', 'sin numero, el id_mesa (como la tarjeta)')
})

test('t10: la pregunta de confirmacion nombra la mesa', () => {
  const [bloque] = agruparPorMesa([comanda(1, { mesa: 4 })], AHORA)
  assert.equal(preguntaTodoListo(bloque), '¿Marcar todos los pedidos de la Mesa 4 como listos?')
})

// ---------------------------------------------------------------------------
// Todo listo
// ---------------------------------------------------------------------------

/** Doble de `avanzar`: anota cada llamada y contesta lo que diga `respuesta`. */
function avanzarFalso(respuesta = () => ({ ok: true })) {
  const llamadas = []
  const avanzar = async (id, estado) => {
    llamadas.push(`${id}:${estado}`)
    const r = respuesta(id, estado)
    return r.ok ? { estado, ...r } : r
  }
  return { avanzar, llamadas }
}

test('t10: pasos hasta listo', () => {
  assert.deepEqual(pasosHastaListo('recibido'), ['en_preparacion', 'listo'])
  assert.deepEqual(pasosHastaListo('en_preparacion'), ['listo'])
  for (const e of ['listo', 'entregado', 'cancelado', 'pagado']) assert.deepEqual(pasosHastaListo(e), [])
})

test('t10: todo listo hace recibido -> en_preparacion -> listo en orden, uno por uno, y salta los que no tocan', async () => {
  const { avanzar, llamadas } = avanzarFalso()
  const r = await marcarTodoListo(
    [
      { id_pedido: 1, estado: 'recibido' },
      { id_pedido: 2, estado: 'listo' },
      { id_pedido: 3, estado: 'en_preparacion' },
      { id_pedido: 4, estado: 'entregado' },
      { id_pedido: 5, estado: 'cancelado' },
    ],
    avanzar
  )
  assert.deepEqual(llamadas, ['1:en_preparacion', '1:listo', '3:listo'])
  assert.deepEqual(r, { listos: [1, 3], fallidos: [] })
})

test('t10: todo listo no lanza dos PATCH a la vez', async () => {
  let enCurso = 0
  let maximo = 0
  const avanzar = async (_id, estado) => {
    enCurso += 1
    maximo = Math.max(maximo, enCurso)
    await new Promise((resolver) => setTimeout(resolver, 2))
    enCurso -= 1
    return { ok: true, estado }
  }
  await marcarTodoListo([{ id_pedido: 1, estado: 'recibido' }, { id_pedido: 2, estado: 'recibido' }], avanzar)
  assert.equal(maximo, 1)
})

test('t10: si uno falla, sigue con los demas y lo reporta con el mensaje del backend', async () => {
  const { avanzar, llamadas } = avanzarFalso((id, estado) =>
    id === 1 && estado === 'listo'
      ? { ok: false, mensaje: 'Transición no permitida: en_preparacion → listo' }
      : { ok: true }
  )
  const r = await marcarTodoListo(
    [
      { id_pedido: 1, codigo_pedido: 'PED-A', estado: 'recibido' },
      { id_pedido: 2, codigo_pedido: 'PED-B', estado: 'recibido' },
    ],
    avanzar
  )
  assert.deepEqual(llamadas, ['1:en_preparacion', '1:listo', '2:en_preparacion', '2:listo'])
  assert.deepEqual(r.listos, [2])
  assert.deepEqual(r.fallidos, [
    { id_pedido: 1, codigo_pedido: 'PED-A', mensaje: 'Transición no permitida: en_preparacion → listo' },
  ])
})

test('t10: un fallo en el primer paso no intenta el segundo; una excepcion cuenta como fallo', async () => {
  const llamadas = []
  const avanzar = async (id, estado) => {
    llamadas.push(`${id}:${estado}`)
    if (id === 1) throw new Error('red caida')
    return { ok: true, estado }
  }
  const r = await marcarTodoListo([{ id_pedido: 1, estado: 'recibido' }, { id_pedido: 2, estado: 'en_preparacion' }], avanzar)
  assert.deepEqual(llamadas, ['1:en_preparacion', '2:listo'])
  assert.deepEqual(r.fallidos.map((f) => [f.id_pedido, f.mensaje]), [[1, 'red caida']])
})

test('t10: si el servidor ya lo deja en listo, no se pide el paso que sobra', async () => {
  const { avanzar, llamadas } = avanzarFalso(() => ({ ok: true, estado: 'listo' }))
  const r = await marcarTodoListo([{ id_pedido: 1, estado: 'recibido' }], avanzar)
  assert.deepEqual(llamadas, ['1:en_preparacion'])
  assert.deepEqual(r.listos, [1])
})

// ---------------------------------------------------------------------------
// En vivo
// ---------------------------------------------------------------------------

function tableroConMesa1() {
  return cargarInicial(estadoInicial(), [
    comanda(1, { mesa: 1, hace: 8 }),
    comanda(2, { mesa: 2, hace: 4 }),
  ])
}

test('t10: un order:created nuevo de la Mesa 1 entra en el bloque que ya tiene', () => {
  const evento = {
    eventId: 'ev-1',
    recibidoEnMs: AHORA,
    pedido: {
      id_pedido: 3,
      codigo_pedido: 'PED-261113-00003',
      id_mesa: 1,
      estado: 'recibido',
      items: [{ id_detalle: 30, nombre: 'Arepa', cantidad: 2, comensal: 'Ana', estado_item: 'pendiente' }],
    },
  }
  let estado = aplicarCreado(tableroConMesa1(), evento)
  const bloques = agruparPorMesa(estado.comandas, AHORA)
  assert.equal(bloques.length, 2, 'no se abre un bloque nuevo')
  assert.equal(bloques[0].titulo, 'Mesa 1', 'el titulo usa el numero del pedido que vino de la API')
  assert.deepEqual(bloques[0].comandas.map((c) => c.id_pedido), [1, 3])
  assert.equal(bloques[0].minutos, 8, 'el tiempo sigue siendo el del mas antiguo')

  // El mismo evento repetido (eventId) no duplica nada.
  estado = aplicarCreado(estado, evento)
  assert.equal(agruparPorMesa(estado.comandas, AHORA)[0].comandas.length, 2)
})

test('t10: un item:cancelado tacha la linea dentro del bloque', () => {
  const estado = aplicarItemCancelado(tableroConMesa1(), { eventId: 'ev-2', id_pedido: 1, id_detalle: 10 })
  const [bloque] = agruparPorMesa(estado.comandas, AHORA)
  assert.equal(bloque.titulo, 'Mesa 1')
  assert.ok(lineaCancelada(bloque.comandas[0].items[0]))
})

test('t10: un pedido entregado o cancelado sale del bloque, y el bloque vacio desaparece', () => {
  let estado = aplicarCreado(tableroConMesa1(), {
    eventId: 'ev-3',
    pedido: { id_pedido: 3, id_mesa: 1, estado: 'recibido', items: [] },
  })
  estado = aplicarEstado(estado, { eventId: 'ev-4', id_pedido: 1, estado: 'entregado' })
  let bloques = agruparPorMesa(estado.comandas, AHORA)
  assert.deepEqual(bloques.find((b) => b.id_mesa === 1).comandas.map((c) => c.id_pedido), [3])

  estado = aplicarEstado(estado, { eventId: 'ev-5', id_pedido: 3, estado: 'cancelado' })
  bloques = agruparPorMesa(estado.comandas, AHORA)
  assert.equal(bloques.some((b) => b.id_mesa === 1), false)
  assert.deepEqual(bloques.map((b) => b.titulo), ['Mesa 2'])
})

test('t10: un order:status mueve el bloque de columna cuando cambia su pedido mas atrasado', () => {
  let estado = tableroConMesa1()
  estado = aplicarEstado(estado, { eventId: 'ev-6', id_pedido: 1, estado: 'en_preparacion' })
  assert.deepEqual(bloquesDeColumna(estado, 'en_preparacion', AHORA).map((b) => b.titulo), ['Mesa 1'])
  assert.deepEqual(bloquesDeColumna(estado, 'recibido', AHORA).map((b) => b.titulo), ['Mesa 2'])
})
