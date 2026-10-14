import assert from 'node:assert'
import test from 'node:test'
import * as lib from '../src/lib/comandas.js'
import * as prefs from '../src/lib/preferencias.js'

// D-09: botones de avance, supervivencia de la columna "Listas" y preferencias
// de la pantalla. Todo logica pura.

const COMANDA = (id, estado) => ({
  id_pedido: id,
  codigo_pedido: `PED-261012-0000${id}`,
  id_mesa: 5,
  mesa_numero: 5,
  estado,
  notas_generales: null,
  minutos_transcurridos: 2,
  creado_en: '2026-10-12T20:00:00.000Z',
  items: [
    {
      id_detalle: id * 10,
      cantidad: 2,
      plato_nombre: 'Bowl Personalizado',
      notas_especiales: 'sin cebolla',
      comensal: 'Ana',
      ingredientes: [
        { id_ingrediente: 1, nombre: 'Arroz Integral', porcion: 'normal', id_paso: 1, paso: 'Elige tu Base' },
        { id_ingrediente: 4, nombre: 'Pollo', porcion: 'ligera', id_paso: 2, paso: 'Elige tu Proteina' },
        { id_ingrediente: 10, nombre: 'Aguacate', porcion: 'extra', id_paso: 3, paso: 'Anade Toppings' },
      ],
    },
  ],
})

// ---------------------------------------------------------------------------
// Que boton toca en cada columna
// ---------------------------------------------------------------------------

test('en Nuevas el boton empieza la preparacion', () => {
  assert.deepStrictEqual(lib.siguientePaso('recibido'), {
    estado: 'en_preparacion',
    etiqueta: 'Empezar',
  })
})

test('en En preparacion el boton marca listo', () => {
  assert.deepStrictEqual(lib.siguientePaso('en_preparacion'), {
    estado: 'listo',
    etiqueta: 'Marcar listo',
  })
})

test('en Listas no hay boton: sacarla es del mesero', () => {
  assert.strictEqual(lib.siguientePaso('listo'), null)
})

test('los estados que ya salieron tampoco tienen boton', () => {
  for (const estado of ['entregado', 'pagado', 'cancelado', undefined]) {
    assert.strictEqual(lib.siguientePaso(estado), null)
  }
})

test('el boton solo propone estados que acepta el backend', () => {
  const permitidos = ['en_preparacion', 'listo']
  for (const estado of ['recibido', 'en_preparacion']) {
    assert.ok(permitidos.includes(lib.siguientePaso(estado).estado))
  }
})

// ---------------------------------------------------------------------------
// Movimiento local tras el PATCH (sin esperar al socket)
// ---------------------------------------------------------------------------

test('marcar el estado mueve la comanda de columna en el acto', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'recibido')])
  const movido = lib.marcarEstadoLocal(inicial, 87, 'en_preparacion')

  assert.deepStrictEqual(lib.comandasDeColumna(movido, 'recibido'), [])
  assert.strictEqual(lib.comandasDeColumna(movido, 'en_preparacion').length, 1)
})

test('el movimiento local conserva los items de la comanda', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'en_preparacion')])
  const movido = lib.marcarEstadoLocal(inicial, 87, 'listo')

  const [comanda] = lib.comandasDeColumna(movido, 'listo')
  assert.strictEqual(comanda.items.length, 1)
  assert.strictEqual(comanda.items[0].comensal, 'Ana')
})

test('el order:status que llega despues deja el mismo resultado', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'recibido')])
  const local = lib.marcarEstadoLocal(inicial, 87, 'en_preparacion')
  const conEvento = lib.aplicarEstado(local, {
    eventId: 'evt-1',
    id_pedido: 87,
    estado: 'en_preparacion',
  })

  assert.strictEqual(conEvento.comandas[0].estado, 'en_preparacion', 'es idempotente')
  assert.strictEqual(conEvento.comandas.length, 1)
})

test('marcar un estado que saca del tablero quita la tarjeta', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'listo')])
  assert.deepStrictEqual(lib.marcarEstadoLocal(inicial, 87, 'entregado').comandas, [])
})

test('marcar una comanda que no esta en pantalla no cambia nada', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'recibido')])
  const igual = lib.marcarEstadoLocal(inicial, 404, 'listo')
  assert.strictEqual(igual.comandas.length, 1)
  assert.strictEqual(igual.comandas[0].estado, 'recibido')
})

// ---------------------------------------------------------------------------
// La columna "Listas" sobrevive a recargar y reconectar
// ---------------------------------------------------------------------------

test('una comanda listo que viene de la API se queda en Listas', () => {
  const estado = lib.cargarInicial(lib.estadoInicial(), [
    COMANDA(87, 'recibido'),
    COMANDA(88, 'listo'),
  ])

  assert.deepStrictEqual(
    lib.comandasDeColumna(estado, 'listo').map((c) => c.id_pedido),
    [88],
    'la API ya devuelve listo (Parte A), asi que no se descarta'
  )
})

test('tras reconectar, una comanda listo sigue en Listas', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'recibido')])
  estado = lib.marcarEstadoLocal(estado, 87, 'listo')
  assert.strictEqual(lib.comandasDeColumna(estado, 'listo').length, 1)

  // Reconexion: la API responde con esa misma comanda, ya en listo.
  const trasReconectar = lib.cargarInicial(estado, [COMANDA(87, 'listo')])

  assert.deepStrictEqual(
    lib.comandasDeColumna(trasReconectar, 'listo').map((c) => c.id_pedido),
    [87],
    'ya no se vacia la columna al reconectar'
  )
})

test('al reconectar sigue mandando la API: lo que ya no esta, se va', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'listo'), COMANDA(88, 'listo')])
  // Mientras el socket estuvo caido, el mesero entrego la 88.
  estado = lib.cargarInicial(estado, [COMANDA(87, 'listo')])

  assert.deepStrictEqual(
    estado.comandas.map((c) => c.id_pedido),
    [87],
    'no quedan comandas fantasma'
  )
})

test('un order:status a listo sigue moviendo la comanda a Listas', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(87, 'en_preparacion')])
  const estado = lib.aplicarEstado(inicial, { eventId: 'evt-2', id_pedido: 87, estado: 'listo' })

  assert.strictEqual(lib.comandasDeColumna(estado, 'listo').length, 1)
})

// ---------------------------------------------------------------------------
// Ingredientes: orden por paso y deteccion de porciones
// ---------------------------------------------------------------------------

test('los ingredientes se agrupan en el orden de los pasos', () => {
  const grupos = lib.ingredientesPorPaso(COMANDA(87, 'recibido').items[0])

  assert.deepStrictEqual(
    grupos.map((g) => g.paso),
    ['Elige tu Base', 'Elige tu Proteina', 'Anade Toppings'],
    'el orden lo pone la base (pasos_constructor.orden) y aqui se respeta'
  )
})

test('se distinguen extra, ligera y normal', () => {
  const grupos = lib.ingredientesPorPaso(COMANDA(87, 'recibido').items[0])
  const porciones = grupos.flatMap((g) => g.ingredientes.map((i) => [i.nombre, i.porcion]))

  assert.deepStrictEqual(porciones, [
    ['Arroz Integral', 'normal'],
    ['Pollo', 'ligera'],
    ['Aguacate', 'extra'],
  ])

  const extras = porciones.filter(([, porcion]) => porcion === 'extra')
  assert.strictEqual(extras.length, 1, 'el extra se puede detectar para resaltarlo')
})

test('un plato normal sin ingredientes no rompe', () => {
  const simple = {
    id_detalle: 9,
    cantidad: 1,
    plato_nombre: 'Limonada de Coco',
    notas_especiales: null,
  }
  assert.deepStrictEqual(lib.ingredientesPorPaso(simple), [])

  const estado = lib.cargarInicial(lib.estadoInicial(), [
    { ...COMANDA(90, 'recibido'), items: [simple] },
  ])
  assert.strictEqual(estado.comandas[0].items[0].plato_nombre, 'Limonada de Coco')
})

test('varios ingredientes del mismo paso quedan juntos', () => {
  const grupos = lib.ingredientesPorPaso({
    ingredientes: [
      { nombre: 'Maiz', porcion: 'normal', paso: 'Anade Toppings' },
      { nombre: 'Queso', porcion: 'extra', paso: 'Anade Toppings' },
    ],
  })
  assert.strictEqual(grupos.length, 1)
  assert.strictEqual(grupos[0].ingredientes.length, 2)
})

// ---------------------------------------------------------------------------
// Preferencias de la pantalla
// ---------------------------------------------------------------------------

test('sin eleccion guardada el tema por defecto es oscuro', () => {
  assert.strictEqual(prefs.temaInicial(null, null), 'oscuro')
  assert.strictEqual(prefs.temaInicial(null, false), 'oscuro')
})

test('sin eleccion guardada se respeta prefers-color-scheme: light', () => {
  assert.strictEqual(prefs.temaInicial(null, true), 'claro')
})

test('la eleccion guardada manda sobre la preferencia del sistema', () => {
  assert.strictEqual(prefs.temaInicial('oscuro', true), 'oscuro')
  assert.strictEqual(prefs.temaInicial('claro', false), 'claro')
})

test('un valor guardado corrupto no deja la pantalla sin tema', () => {
  assert.strictEqual(prefs.temaInicial('azul-fosforito', null), 'oscuro')
})

test('el sonido arranca apagado hasta que alguien lo activa', () => {
  assert.strictEqual(prefs.sonidoInicial(null), false)
  assert.strictEqual(prefs.sonidoInicial('false'), false)
  assert.strictEqual(prefs.sonidoInicial('true'), true)
})

test('leer y guardar preferencias no lanza si el storage no existe', () => {
  // En node no hay localStorage: las funciones tienen que degradarse solas,
  // igual que en un navegador con el almacenamiento bloqueado.
  assert.strictEqual(prefs.leerPreferencia(prefs.CLAVE_TEMA), null)
  assert.strictEqual(prefs.guardarPreferencia(prefs.CLAVE_TEMA, 'oscuro'), false)
})
