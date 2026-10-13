import assert from 'node:assert'
import test from 'node:test'
import * as lib from '../src/lib/comandas.js'

const COMANDA_API = {
  id_pedido: 87,
  codigo_pedido: 'PED-261011-ABC12',
  id_mesa: 5,
  mesa_numero: 5,
  estado: 'recibido',
  notas_generales: 'Somos alergicos al mani',
  minutos_transcurridos: 3.2,
  items: [
    {
      id_detalle: 201,
      cantidad: 2,
      plato_nombre: 'Bowl Personalizado',
      notas_especiales: 'sin cebolla',
      comensal: 'Ana',
      ingredientes: [
        { id_ingrediente: 1, nombre: 'Arroz Integral', porcion: 'normal', paso: 'Elige tu Base' },
        { id_ingrediente: 10, nombre: 'Aguacate', porcion: 'extra', paso: 'Anade Toppings' },
      ],
    },
  ],
}

const PEDIDO_SOCKET = {
  id_pedido: 99,
  codigo_pedido: 'PED-261011-ZZZ99',
  id_mesa: 7,
  estado: 'recibido',
  notas_generales: null,
  items: [{ id_plato: 3, nombre: 'Hamburguesa Smart Angus', cantidad: 1, notas_especiales: null }],
}

const creado = (pedido, eventId) => ({ eventId, pedido })

// ---------------------------------------------------------------------------
// Carga inicial
// ---------------------------------------------------------------------------

test('la carga inicial deja las comandas de la API en su columna', () => {
  const estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])

  assert.strictEqual(estado.cargando, false)
  assert.strictEqual(estado.error, null)
  assert.strictEqual(estado.comandas.length, 1)
  assert.deepStrictEqual(
    lib.comandasDeColumna(estado, 'recibido').map((c) => c.id_pedido),
    [87]
  )
  assert.deepStrictEqual(lib.comandasDeColumna(estado, 'listo'), [])
})

test('la carga inicial descarta estados que no son del tablero', () => {
  const estado = lib.cargarInicial(lib.estadoInicial(), [
    COMANDA_API,
    { ...COMANDA_API, id_pedido: 88, estado: 'pagado' },
    { ...COMANDA_API, id_pedido: 89, estado: 'entregado' },
  ])

  assert.deepStrictEqual(
    estado.comandas.map((c) => c.id_pedido),
    [87]
  )
})

test('una carga inicial vacia deja el tablero sin comandas y sin error', () => {
  const estado = lib.cargarInicial(lib.estadoInicial(), [])
  assert.deepStrictEqual(estado.comandas, [])
  assert.strictEqual(estado.cargando, false)
  assert.strictEqual(estado.error, null)
})

test('marcarError conserva lo que ya se veia en pantalla', () => {
  const cargado = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  const conError = lib.marcarError(cargado, 'La red fallo')

  assert.strictEqual(conError.error, 'La red fallo')
  assert.strictEqual(conError.cargando, false)
  assert.strictEqual(conError.comandas.length, 1, 'no se vacia el tablero por un fallo de red')
})

// ---------------------------------------------------------------------------
// order:created
// ---------------------------------------------------------------------------

test('order:created agrega la comanda en Nuevas, al principio', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  const estado = lib.aplicarCreado(inicial, creado(PEDIDO_SOCKET, 'evt-1'))

  assert.deepStrictEqual(
    lib.comandasDeColumna(estado, 'recibido').map((c) => c.id_pedido),
    [99, 87],
    'lo que acaba de entrar va primero'
  )
})

test('order:created traduce el payload del socket a la forma de la tarjeta', () => {
  const estado = lib.aplicarCreado(lib.cargarInicial(lib.estadoInicial(), []), creado(PEDIDO_SOCKET, 'evt-1'))
  const comanda = estado.comandas[0]

  assert.strictEqual(comanda.codigo_pedido, 'PED-261011-ZZZ99')
  assert.strictEqual(comanda.id_mesa, 7)
  assert.strictEqual(comanda.mesa_numero, null, 'el socket no manda el numero de mesa')
  assert.strictEqual(comanda.minutos_transcurridos, 0)
  assert.ok(comanda.recibidoEnMs > 0, 'se guarda la hora de llegada local')
  assert.strictEqual(
    comanda.items[0].plato_nombre,
    'Hamburguesa Smart Angus',
    'el socket dice "nombre" y la API "plato_nombre": se aceptan los dos'
  )
})

test('un order:created con el mismo eventId se ignora', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [])
  estado = lib.aplicarCreado(estado, creado(PEDIDO_SOCKET, 'evt-1'))
  estado = lib.aplicarCreado(estado, creado(PEDIDO_SOCKET, 'evt-1'))

  assert.strictEqual(estado.comandas.length, 1, 'el reintento del socket no duplica la comanda')
})

test('un order:created de un id_pedido que ya esta en pantalla no duplica ni lo devuelve a Nuevas', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [
    { ...COMANDA_API, estado: 'en_preparacion' },
  ])
  // Mismo pedido, otro eventId (no lo filtra la dedup por evento).
  const estado = lib.aplicarCreado(inicial, creado({ ...COMANDA_API, estado: 'recibido' }, 'evt-otro'))

  assert.strictEqual(estado.comandas.length, 1)
  assert.strictEqual(
    estado.comandas[0].estado,
    'en_preparacion',
    'una comanda que ya se esta cocinando no vuelve a Nuevas'
  )
})

test('un order:created sin pedido o sin id_pedido no rompe nada', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])

  assert.strictEqual(lib.aplicarCreado(inicial, { eventId: 'x' }).comandas.length, 1)
  assert.strictEqual(lib.aplicarCreado(inicial, { eventId: 'y', pedido: {} }).comandas.length, 1)
  assert.strictEqual(lib.aplicarCreado(inicial, undefined).comandas.length, 1)
})

test('order:created sin eventId se aplica igual (no se puede deduplicar)', () => {
  const estado = lib.aplicarCreado(lib.cargarInicial(lib.estadoInicial(), []), { pedido: PEDIDO_SOCKET })
  assert.strictEqual(estado.comandas.length, 1)
})

// ---------------------------------------------------------------------------
// order:status
// ---------------------------------------------------------------------------

test('order:status mueve la comanda de columna', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  const estado = lib.aplicarEstado(inicial, {
    eventId: 'evt-2',
    id_pedido: 87,
    estado_anterior: 'recibido',
    estado: 'en_preparacion',
  })

  assert.deepStrictEqual(lib.comandasDeColumna(estado, 'recibido'), [])
  assert.deepStrictEqual(
    lib.comandasDeColumna(estado, 'en_preparacion').map((c) => c.id_pedido),
    [87]
  )
})

test('order:status a listo la lleva a la tercera columna conservando sus items', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  const estado = lib.aplicarEstado(inicial, { eventId: 'evt-3', id_pedido: 87, estado: 'listo' })

  const [comanda] = lib.comandasDeColumna(estado, 'listo')
  assert.ok(comanda)
  assert.strictEqual(comanda.items.length, 1, 'mover de columna no pierde los items')
})

for (const estadoFinal of ['entregado', 'pagado', 'cancelado']) {
  test(`order:status a ${estadoFinal} quita la comanda del tablero`, () => {
    const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
    const estado = lib.aplicarEstado(inicial, {
      eventId: `evt-${estadoFinal}`,
      id_pedido: 87,
      estado: estadoFinal,
    })

    assert.deepStrictEqual(estado.comandas, [], 'ya no es asunto de la cocina')
  })
}

test('un order:status con el mismo eventId se ignora', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  estado = lib.aplicarEstado(estado, { eventId: 'evt-4', id_pedido: 87, estado: 'en_preparacion' })
  // El mismo evento reenviado, aunque entre medias "volviera" a recibido.
  estado = lib.aplicarEstado(estado, { eventId: 'evt-4', id_pedido: 87, estado: 'recibido' })

  assert.strictEqual(estado.comandas[0].estado, 'en_preparacion')
})

test('un order:status de un pedido que no esta en pantalla no inventa una tarjeta', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  const estado = lib.aplicarEstado(inicial, { eventId: 'evt-5', id_pedido: 404, estado: 'listo' })

  assert.strictEqual(estado.comandas.length, 1, 'order:status no trae items: no sirve una tarjeta vacia')
  assert.deepStrictEqual(lib.comandasDeColumna(estado, 'listo'), [])
})

test('un order:status sin id_pedido no rompe nada', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  assert.strictEqual(lib.aplicarEstado(inicial, { eventId: 'z' }).comandas.length, 1)
  assert.strictEqual(lib.aplicarEstado(inicial, undefined).comandas.length, 1)
})

// ---------------------------------------------------------------------------
// Reconexion
// ---------------------------------------------------------------------------

test('al reconectar, la carga inicial REEMPLAZA el estado en vez de mezclarlo', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  estado = lib.aplicarCreado(estado, creado(PEDIDO_SOCKET, 'evt-6'))
  assert.strictEqual(estado.comandas.length, 2)

  // Mientras el socket estuvo caido, el pedido 87 se entrego y entro otro.
  const trasReconectar = lib.cargarInicial(estado, [
    { ...COMANDA_API, id_pedido: 120, codigo_pedido: 'PED-261011-NEW20', estado: 'en_preparacion' },
  ])

  assert.deepStrictEqual(
    trasReconectar.comandas.map((c) => c.id_pedido),
    [120],
    'manda la API: no quedan comandas fantasma del estado anterior'
  )
})

test('al reconectar se olvidan los eventId vistos', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [])
  estado = lib.aplicarCreado(estado, creado(PEDIDO_SOCKET, 'evt-7'))
  assert.ok(lib.esEventoRepetido(estado, 'evt-7'))

  const trasReconectar = lib.cargarInicial(estado, [])
  assert.strictEqual(
    lib.esEventoRepetido(trasReconectar, 'evt-7'),
    false,
    'son de la sesion anterior del socket: recordarlos podria descartar un evento legitimo'
  )
})

test('la ventana de eventos recordados no crece sin tope', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [])
  for (let i = 0; i < lib.MAX_EVENTOS_RECORDADOS + 50; i++) {
    estado = lib.aplicarEstado(estado, { eventId: `evt-${i}`, id_pedido: 87, estado: 'listo' })
  }

  assert.strictEqual(estado.eventos.length, lib.MAX_EVENTOS_RECORDADOS)
  assert.ok(lib.esEventoRepetido(estado, `evt-${lib.MAX_EVENTOS_RECORDADOS + 49}`), 'recuerda los ultimos')
  assert.strictEqual(lib.esEventoRepetido(estado, 'evt-0'), false, 'olvida los mas viejos')
})

// ---------------------------------------------------------------------------
// Tolerancia a payloads del backend actual (sin PR #32)
// ---------------------------------------------------------------------------

test('una comanda sin comensal ni ingredientes se normaliza sin errores', () => {
  const sinConstructor = {
    id_pedido: 50,
    codigo_pedido: 'PED-261011-OLD50',
    id_mesa: 2,
    mesa_numero: 2,
    estado: 'recibido',
    minutos_transcurridos: 1,
    items: [{ id_detalle: 9, cantidad: 1, plato_nombre: 'Limonada de Coco', notas_especiales: null }],
  }

  const estado = lib.cargarInicial(lib.estadoInicial(), [sinConstructor])
  assert.strictEqual(estado.comandas.length, 1)

  const porSocket = lib.aplicarCreado(estado, creado(sinConstructor, 'evt-8')).comandas
  // Ya estaba por id_pedido, asi que se prueba la normalizacion directa.
  const comanda = lib.comandaDesdePedido(sinConstructor)
  assert.strictEqual(comanda.items[0].comensal, null)
  assert.deepStrictEqual(comanda.items[0].ingredientes, [])
  assert.deepStrictEqual(lib.ingredientesPorPaso(comanda.items[0]), [])
  assert.strictEqual(porSocket.length, 1)
})

test('un pedido sin items se normaliza a una lista vacia', () => {
  const comanda = lib.comandaDesdePedido({ id_pedido: 1, id_mesa: 1, estado: 'recibido' })
  assert.deepStrictEqual(comanda.items, [])
})

test('los ingredientes se agrupan por paso, en el orden en que llegan', () => {
  const grupos = lib.ingredientesPorPaso(COMANDA_API.items[0])

  assert.deepStrictEqual(
    grupos.map((g) => g.paso),
    ['Elige tu Base', 'Anade Toppings']
  )
  assert.deepStrictEqual(
    grupos[1].ingredientes.map((i) => `${i.nombre}/${i.porcion}`),
    ['Aguacate/extra']
  )
})

test('varios ingredientes del mismo paso caen en un solo grupo', () => {
  const grupos = lib.ingredientesPorPaso({
    ingredientes: [
      { nombre: 'Maiz', porcion: 'normal', paso: 'Anade Toppings' },
      { nombre: 'Queso', porcion: 'extra', paso: 'Anade Toppings' },
    ],
  })

  assert.strictEqual(grupos.length, 1)
  assert.strictEqual(grupos[0].ingredientes.length, 2)
})

test('un ingrediente sin paso cae en un grupo generico', () => {
  const grupos = lib.ingredientesPorPaso({ ingredientes: [{ nombre: 'Tocineta', porcion: 'extra' }] })
  assert.deepStrictEqual(grupos.map((g) => g.paso), ['Ingredientes'])
})

// ---------------------------------------------------------------------------
// Cronometro
// ---------------------------------------------------------------------------

test('los minutos parten de la API y avanzan con el reloj local', () => {
  const estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA_API])
  const comanda = estado.comandas[0]

  // La comanda de la API no trae recibidoEnMs: se usa su valor tal cual.
  assert.strictEqual(lib.minutosDeEspera(comanda), 3)

  const porSocket = lib.comandaDesdePedido(PEDIDO_SOCKET, 1_000_000)
  assert.strictEqual(lib.minutosDeEspera(porSocket, 1_000_000), 0)
  assert.strictEqual(lib.minutosDeEspera(porSocket, 1_000_000 + 5 * 60_000), 5)
})

test('las columnas del tablero son las tres de cocina, en orden', () => {
  assert.deepStrictEqual(
    lib.COLUMNAS.map((c) => c.estado),
    ['recibido', 'en_preparacion', 'listo']
  )
})
