/**
 * T10 · Una tarjeta por mesa: el agrupado, "Todo listo" y como se recalcula en
 * vivo con los eventos del socket.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agruparPorMesa,
  bloquesDeColumna,
  descartarFallosDelBloque,
  marcarTodoListo,
  pasosHastaListo,
  preguntaTodoListo,
  textoOtrasColumnas,
  todoListoDelBloque,
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

test('t10: cada pedido va en la columna de su estado; la mesa se parte por columnas', () => {
  const estado = cargarInicial(estadoInicial(), [
    comanda(1, { mesa: 1, hace: 9, estado: 'listo' }),
    comanda(2, { mesa: 1, hace: 2, estado: 'recibido' }),
    comanda(3, { mesa: 2, hace: 5, estado: 'en_preparacion' }),
  ])
  const nuevas = bloquesDeColumna(estado, 'recibido', AHORA)
  assert.deepEqual(nuevas.map((b) => b.titulo), ['Mesa 1'])
  assert.deepEqual(nuevas[0].comandas.map((c) => c.id_pedido), [2], 'el pedido listo NO va en Nuevas')
  assert.equal(nuevas[0].estado, 'recibido')
  assert.deepEqual(bloquesDeColumna(estado, 'en_preparacion', AHORA).map((b) => b.titulo), ['Mesa 2'])
  const listas = bloquesDeColumna(estado, 'listo', AHORA)
  assert.deepEqual(listas.map((b) => b.titulo), ['Mesa 1'])
  assert.deepEqual(listas[0].comandas.map((c) => c.id_pedido), [1])
  assert.notEqual(listas[0].clave, nuevas[0].clave, 'la clave es mesa + estado')
})

test('t10: el numero de mesa sale del pedido que lo trae aunque el primero llegara por socket', () => {
  const porSocket = { ...comanda(1, { mesa: 7, hace: 6 }), mesa_numero: null }
  const [bloque] = agruparPorMesa([porSocket, comanda(2, { mesa: 7, numero: 3, hace: 1 })], AHORA)
  assert.equal(bloque.titulo, 'Mesa 3')
  assert.equal(agruparPorMesa([porSocket], AHORA)[0].titulo, 'Mesa 7', 'sin numero, el id_mesa (como la tarjeta)')
})

test('t10: la pregunta de confirmacion nombra la mesa', () => {
  const [bloque] = agruparPorMesa([comanda(1, { mesa: 4 })], AHORA)
  assert.equal(preguntaTodoListo(bloque), '¿Marcar como listo el pedido nuevo de la Mesa 4?')
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

test('t10: un order:status mueve el pedido a la columna de su nuevo estado', () => {
  let estado = tableroConMesa1()
  estado = aplicarEstado(estado, { eventId: 'ev-6', id_pedido: 1, estado: 'en_preparacion' })
  assert.deepEqual(bloquesDeColumna(estado, 'en_preparacion', AHORA).map((b) => b.titulo), ['Mesa 1'])
  assert.deepEqual(bloquesDeColumna(estado, 'recibido', AHORA).map((b) => b.titulo), ['Mesa 2'])
})

// ---------------------------------------------------------------------------
// Un bloque por mesa Y estado
// ---------------------------------------------------------------------------

/** Mesa 4 con un pedido en cada estado, mas otra mesa y un para llevar. */
function tableroTresEstados() {
  return cargarInicial(estadoInicial(), [
    { ...comanda(1, { mesa: 4, hace: 25, estado: 'listo' }), listo_en: new Date(AHORA - 3 * MINUTO).toISOString() },
    comanda(2, { mesa: 4, hace: 15, estado: 'en_preparacion' }),
    comanda(3, { mesa: 4, hace: 4, estado: 'recibido' }),
    comanda(4, { mesa: 9, hace: 10, estado: 'recibido' }),
    comanda(5, { canal: 'para_llevar', hace: 7, estado: 'en_preparacion' }),
  ])
}

const titulos = (estado, columna) => bloquesDeColumna(estado, columna, AHORA).map((b) => b.titulo)

test('por estado: una mesa con pedidos en los tres estados sale en las tres columnas', () => {
  const estado = tableroTresEstados()
  for (const columna of ['recibido', 'en_preparacion', 'listo']) {
    const mesa4 = bloquesDeColumna(estado, columna, AHORA).filter((b) => b.id_mesa === 4)
    assert.equal(mesa4.length, 1, `un bloque de la Mesa 4 en ${columna}`)
    assert.equal(mesa4[0].clave, `mesa:4:${columna}`)
    assert.equal(mesa4[0].estado, columna)
    assert.ok(mesa4[0].comandas.every((c) => c.estado === columna), 'solo pedidos de su estado')
    assert.equal(mesa4[0].comandas.length, 1)
  }
})

test('por estado: el tiempo del bloque sale del pedido mas antiguo DE ESE bloque', () => {
  const estado = tableroTresEstados()
  const minutosMesa4 = (columna) => bloquesDeColumna(estado, columna, AHORA).find((b) => b.id_mesa === 4).minutos
  assert.equal(minutosMesa4('recibido'), 4, 'no los 25 del pedido que ya esta listo')
  assert.equal(minutosMesa4('en_preparacion'), 15)
  assert.equal(minutosMesa4('listo'), 25)
  // Y Nuevas sigue ordenada por antiguedad del bloque: Mesa 9 (10) antes que Mesa 4 (4).
  assert.deepEqual(titulos(estado, 'recibido'), ['Mesa 9', 'Mesa 4'])
})

test('por estado: Empezar un pedido mueve SOLO ese pedido a En preparacion', () => {
  let estado = cargarInicial(estadoInicial(), [comanda(1, { mesa: 4, hace: 12 }), comanda(2, { mesa: 4, hace: 6 })])
  assert.deepEqual(bloquesDeColumna(estado, 'recibido', AHORA)[0].comandas.map((c) => c.id_pedido), [1, 2])

  estado = aplicarEstado(estado, { eventId: 'ev-empezar', id_pedido: 1, estado: 'en_preparacion' })
  const nuevas = bloquesDeColumna(estado, 'recibido', AHORA)
  const prep = bloquesDeColumna(estado, 'en_preparacion', AHORA)
  assert.deepEqual(nuevas.map((b) => b.comandas.map((c) => c.id_pedido)), [[2]], 'el otro sigue en Nuevas')
  assert.deepEqual(prep.map((b) => b.comandas.map((c) => c.id_pedido)), [[1]])
  assert.equal(prep[0].titulo, 'Mesa 4')
  assert.equal(nuevas[0].minutos, 6, 'Nuevas ya no cuenta el tiempo del que se empezo')
})

test('por estado: los contadores (tarjetas por columna) cuentan cada columna', () => {
  const estado = tableroTresEstados()
  const contar = (columna) => bloquesDeColumna(estado, columna, AHORA).length
  assert.equal(contar('recibido'), 2, 'Mesa 4 y Mesa 9')
  assert.equal(contar('en_preparacion'), 2, 'Mesa 4 y el para llevar')
  assert.equal(contar('listo'), 1, 'Mesa 4')

  // Dos pedidos de la misma mesa en la misma columna siguen siendo UNA tarjeta.
  const dos = cargarInicial(estadoInicial(), [comanda(1, { mesa: 4, hace: 5 }), comanda(2, { mesa: 4, hace: 2 })])
  assert.equal(bloquesDeColumna(dos, 'recibido', AHORA).length, 1)
  assert.equal(bloquesDeColumna(dos, 'en_preparacion', AHORA).length, 0)
})

test('por estado: "+N pedidos de esta mesa en otras columnas"', () => {
  assert.equal(textoOtrasColumnas(0), '')
  assert.equal(textoOtrasColumnas(undefined), '')
  assert.equal(textoOtrasColumnas(1), '+1 pedido de esta mesa en otras columnas')
  assert.equal(textoOtrasColumnas(3), '+3 pedidos de esta mesa en otras columnas')

  const bloques = agruparPorMesa(
    [
      comanda(1, { mesa: 4, estado: 'recibido', hace: 3 }),
      comanda(2, { mesa: 4, estado: 'recibido', hace: 2 }),
      comanda(3, { mesa: 4, estado: 'en_preparacion', hace: 8 }),
      comanda(4, { mesa: 9, estado: 'recibido', hace: 1 }),
      comanda(5, { canal: 'domicilio', estado: 'recibido', hace: 1 }),
    ],
    AHORA
  )
  const otras = (clave) => bloques.find((b) => b.clave === clave).enOtrasColumnas
  assert.equal(otras('mesa:4:recibido'), 1, 'el de En preparacion')
  assert.equal(otras('mesa:4:en_preparacion'), 2, 'los dos de Nuevas')
  assert.equal(otras('mesa:9:recibido'), 0, 'otra mesa no cuenta')
  assert.equal(otras('pedido:5'), 0, 'sin mesa, nunca')
})

test('por estado: Todo listo solo toca los pedidos de su bloque', async () => {
  const estado = tableroTresEstados()
  const [nuevasMesa4] = bloquesDeColumna(estado, 'recibido', AHORA).filter((b) => b.id_mesa === 4)
  const { avanzar, llamadas } = avanzarFalso()
  const r = await marcarTodoListo(nuevasMesa4.comandas, avanzar)
  assert.deepEqual(llamadas, ['3:en_preparacion', '3:listo'], 'ni el 2 (en preparacion) ni el 1 (listo)')
  assert.deepEqual(r.listos, [3])
})

test('por estado: corriendo y fallos siguen a los pedidos aunque cambien de bloque', () => {
  let estado = cargarInicial(estadoInicial(), [
    comanda(1, { mesa: 4, hace: 9 }),
    comanda(2, { mesa: 4, hace: 5 }),
    comanda(3, { mesa: 4, hace: 20, estado: 'en_preparacion' }),
  ])
  const [origen] = bloquesDeColumna(estado, 'recibido', AHORA)
  let todoListo = { [origen.clave]: { corriendo: true, fallidos: [], ids: [1, 2] } }

  // A mitad de camino el pedido 1 ya paso a En preparacion: entra en el bloque
  // de la Mesa 4 de esa columna, que se muestra corriendo.
  estado = aplicarEstado(estado, { eventId: 'ev-tl-1', id_pedido: 1, estado: 'en_preparacion' })
  const [prep] = bloquesDeColumna(estado, 'en_preparacion', AHORA)
  assert.deepEqual(prep.comandas.map((c) => c.id_pedido), [3, 1])
  assert.equal(todoListoDelBloque(prep, todoListo).corriendo, true)

  // Termina: el 1 llega a listo y el 2 falla en Nuevas. El aviso sale en el
  // bloque donde esta el 2, no en el de Listas ni en el de En preparacion.
  estado = aplicarEstado(estado, { eventId: 'ev-tl-2', id_pedido: 1, estado: 'listo' })
  const fallo = { id_pedido: 2, codigo_pedido: 'PED-261113-00002', mensaje: 'red caida' }
  todoListo = { [origen.clave]: { corriendo: false, fallidos: [fallo], ids: [1, 2] } }
  const [nuevas] = bloquesDeColumna(estado, 'recibido', AHORA)
  const [listas] = bloquesDeColumna(estado, 'listo', AHORA)
  const [prep2] = bloquesDeColumna(estado, 'en_preparacion', AHORA)
  assert.deepEqual(todoListoDelBloque(nuevas, todoListo), { corriendo: false, fallidos: [fallo] })
  assert.equal(todoListoDelBloque(listas, todoListo), null)
  assert.equal(todoListoDelBloque(prep2, todoListo), null, 'el pedido 3 no estaba en el Todo listo')

  // Cerrar el aviso quita solo los fallos de ese bloque.
  const otroFallo = { id_pedido: 3, codigo_pedido: 'PED-261113-00003', mensaje: 'x' }
  todoListo = {
    a: { corriendo: false, fallidos: [fallo], ids: [2] },
    b: { corriendo: false, fallidos: [otroFallo], ids: [3] },
  }
  assert.deepEqual(descartarFallosDelBloque(todoListo, nuevas), { b: todoListo.b })
})

test('por estado: la pregunta de Todo listo dice el estado y cuantos pedidos', () => {
  const pregunta = (comandas, columna) =>
    preguntaTodoListo(agruparPorMesa(comandas, AHORA).find((b) => b.estado === columna))
  const prep = (id) => comanda(id, { mesa: 4, estado: 'en_preparacion', hace: id })
  const nueva = (id) => comanda(id, { mesa: 4, estado: 'recibido', hace: id })

  assert.equal(pregunta([prep(1), prep(2)], 'en_preparacion'), '¿Marcar como listos los 2 pedidos en preparación de la Mesa 4?')
  assert.equal(pregunta([prep(1), nueva(2)], 'en_preparacion'), '¿Marcar como listo el pedido en preparación de la Mesa 4?')
  assert.equal(pregunta([nueva(1), nueva(2), prep(3)], 'recibido'), '¿Marcar como listos los 2 pedidos nuevos de la Mesa 4?')
  assert.equal(pregunta([nueva(1)], 'recibido'), '¿Marcar como listo el pedido nuevo de la Mesa 4?')

  // Para llevar / domicilio: la pregunta de siempre.
  const [llevar] = agruparPorMesa([comanda(5, { canal: 'para_llevar', estado: 'en_preparacion' })], AHORA)
  assert.equal(preguntaTodoListo(llevar), '¿Marcar todos los pedidos de la Para llevar #PED-261113-00005 como listos?')
})

test('por estado: para llevar y domicilio siguen con un bloque por pedido, en su columna', () => {
  const estado = cargarInicial(estadoInicial(), [
    comanda(1, { canal: 'para_llevar', hace: 12, estado: 'recibido' }),
    comanda(2, { canal: 'para_llevar', hace: 8, estado: 'recibido' }),
    comanda(3, { canal: 'domicilio', hace: 6, estado: 'en_preparacion' }),
    { ...comanda(4, { canal: 'domicilio', hace: 30, estado: 'listo' }), listo_en: new Date(AHORA - 10 * MINUTO).toISOString() },
    { ...comanda(5, { canal: 'para_llevar', hace: 20, estado: 'listo' }), listo_en: new Date(AHORA - 1 * MINUTO).toISOString() },
  ])
  assert.deepEqual(titulos(estado, 'recibido'), ['Para llevar #PED-261113-00001', 'Para llevar #PED-261113-00002'])
  assert.deepEqual(titulos(estado, 'en_preparacion'), ['Domicilio #PED-261113-00003'])
  // Listas conserva su orden: lo que acaba de salir, arriba.
  assert.deepEqual(titulos(estado, 'listo'), ['Para llevar #PED-261113-00005', 'Domicilio #PED-261113-00004'])
  const todos = agruparPorMesa(estado.comandas, AHORA)
  assert.ok(todos.every((b) => !b.conMesa && b.comandas.length === 1 && b.enOtrasColumnas === 0))
  assert.deepEqual(todos.map((b) => b.clave).sort(), ['pedido:1', 'pedido:2', 'pedido:3', 'pedido:4', 'pedido:5'])
  assert.equal(todos.find((b) => b.clave === 'pedido:4').minutos, 30)
})

test('por estado: Listas ordena los bloques de mesa por el ultimo que salio', () => {
  const estado = cargarInicial(estadoInicial(), [
    { ...comanda(1, { mesa: 1, hace: 40, estado: 'listo' }), listo_en: new Date(AHORA - 9 * MINUTO).toISOString() },
    { ...comanda(2, { mesa: 2, hace: 30, estado: 'listo' }), listo_en: new Date(AHORA - 2 * MINUTO).toISOString() },
    comanda(3, { mesa: 1, hace: 1, estado: 'recibido' }),
  ])
  assert.deepEqual(titulos(estado, 'listo'), ['Mesa 2', 'Mesa 1'])
})
