import assert from 'node:assert'
import test from 'node:test'
import * as lib from '../src/lib/comandas.js'
import * as pase from '../src/lib/pase.js'

// La columna LISTAS (el pase): orden, aviso de "sin recoger" y de donde sale la
// hora de paso a 'listo'. Logica pura.

const AHORA = Date.parse('2026-10-13T12:00:00.000Z')
const haceMinutos = (m) => new Date(AHORA - m * 60000).toISOString()

const COMANDA = (id, extra = {}) => ({
  id_pedido: id,
  codigo_pedido: `PED-261013-0000${id}`,
  id_mesa: 5,
  mesa_numero: 5,
  estado: 'listo',
  creado_en: haceMinutos(120),
  minutos_transcurridos: 120,
  items: [],
  ...extra,
})

// ---------------------------------------------------------------------------
// De donde sale la hora de paso a listo
// ---------------------------------------------------------------------------

test('listo_en de la API es la fuente preferida', () => {
  const comanda = COMANDA(1, { listo_en: haceMinutos(10), listoEnMs: AHORA - 99 * 60000 })
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 10, 'manda la base, no la marca local')
})

test('sin listo_en se usa la marca que anoto el KDS al recibir el evento', () => {
  const comanda = COMANDA(1, { listoEnMs: AHORA - 7 * 60000 })
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 7)
})

test('sin ninguna hora de listo se devuelve null, no cero', () => {
  const comanda = COMANDA(1)
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), null, 'null es "no puedo decirlo"')
  assert.strictEqual(
    pase.sinRecoger(comanda, AHORA),
    false,
    'sin dato no se acusa a nadie de haberla olvidado'
  )
})

test('un listo_en invalido cae a la marca local', () => {
  const comanda = COMANDA(1, { listo_en: 'no-es-fecha', listoEnMs: AHORA - 3 * 60000 })
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 3)
})

test('el tiempo en el pase no es el tiempo total', () => {
  // Pedida hace 2 horas, lista hace 5 minutos.
  const comanda = COMANDA(1, { listo_en: haceMinutos(5) })
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 5)
  assert.notStrictEqual(pase.minutosEnPase(comanda, AHORA), 120)
})

test('un reloj atrasado no da minutos negativos', () => {
  const comanda = COMANDA(1, { listo_en: new Date(AHORA + 60000).toISOString() })
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 0)
})

// ---------------------------------------------------------------------------
// Umbral de "sin recoger"
// ---------------------------------------------------------------------------

test('el umbral vive en un solo sitio y son 30 minutos', () => {
  assert.strictEqual(pase.UMBRAL_SIN_RECOGER_MIN, 30)
})

test('por debajo del umbral no se avisa', () => {
  for (const m of [0, 5, 29, 30]) {
    const comanda = COMANDA(1, { listo_en: haceMinutos(m) })
    assert.strictEqual(pase.sinRecoger(comanda, AHORA), false, `${m} min`)
  }
})

test('pasado el umbral se avisa', () => {
  for (const m of [31, 45, 120, 1410]) {
    const comanda = COMANDA(1, { listo_en: haceMinutos(m) })
    assert.strictEqual(pase.sinRecoger(comanda, AHORA), true, `${m} min`)
  }
})

test('el aviso dice cuanto lleva, con el tope +99', () => {
  assert.strictEqual(pase.textoSinRecoger(45), 'Sin recoger hace 45 min')
  assert.strictEqual(pase.textoSinRecoger(99), 'Sin recoger hace 99 min')
  assert.strictEqual(
    pase.textoSinRecoger(1410),
    'Sin recoger hace +99 min',
    'una comanda de ayer no muestra una cifra de cuatro digitos'
  )
})

test('el aviso no habla de retraso ni culpa a la cocina', () => {
  const texto = pase.textoSinRecoger(600)
  assert.ok(!/retras/i.test(texto))
  assert.ok(/sin recoger/i.test(texto), 'el sujeto es quien no la recogio')
})

// ---------------------------------------------------------------------------
// Orden del pase: la mas reciente arriba
// ---------------------------------------------------------------------------

test('el pase se ordena con la mas reciente arriba', () => {
  const ordenadas = pase.ordenarPase([
    COMANDA(1, { listo_en: haceMinutos(60) }),
    COMANDA(2, { listo_en: haceMinutos(2) }),
    COMANDA(3, { listo_en: haceMinutos(20) }),
  ])

  assert.deepStrictEqual(
    ordenadas.map((c) => c.id_pedido),
    [2, 3, 1]
  )
})

test('las comandas sin hora de listo caen al final', () => {
  const ordenadas = pase.ordenarPase([
    COMANDA(1),
    COMANDA(2, { listo_en: haceMinutos(30) }),
    COMANDA(3),
    COMANDA(4, { listo_en: haceMinutos(1) }),
  ])

  assert.deepStrictEqual(
    ordenadas.map((c) => c.id_pedido),
    [4, 2, 1, 3],
    'primero las que si tienen hora, de la mas nueva a la mas vieja'
  )
})

test('ordenar no modifica el arreglo recibido', () => {
  const original = [COMANDA(1, { listo_en: haceMinutos(60) }), COMANDA(2, { listo_en: haceMinutos(2) })]
  const copia = [...original]
  pase.ordenarPase(original)
  assert.deepStrictEqual(original.map((c) => c.id_pedido), copia.map((c) => c.id_pedido))
})

// ---------------------------------------------------------------------------
// Integracion con el tablero
// ---------------------------------------------------------------------------

test('la columna LISTAS llega ya ordenada, las otras no se tocan', () => {
  const estado = lib.cargarInicial(lib.estadoInicial(), [
    COMANDA(10, { estado: 'recibido', listo_en: null }),
    COMANDA(11, { estado: 'recibido', listo_en: null }),
    COMANDA(1, { listo_en: haceMinutos(60) }),
    COMANDA(2, { listo_en: haceMinutos(2) }),
  ])

  assert.deepStrictEqual(
    lib.comandasDeColumna(estado, 'listo').map((c) => c.id_pedido),
    [2, 1],
    'el pase se invierte'
  )
  assert.deepStrictEqual(
    lib.comandasDeColumna(estado, 'recibido').map((c) => c.id_pedido),
    [10, 11],
    'Nuevas conserva el orden de la API: lo mas viejo primero'
  )
})

test('un order:status a listo anota la hora del evento', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(1, { estado: 'en_preparacion' })])
  const emitido = new Date(AHORA - 4 * 60000).toISOString()

  const estado = lib.aplicarEstado(inicial, {
    eventId: 'evt-1',
    id_pedido: 1,
    estado: 'listo',
    emitidoEn: emitido,
  })

  const [comanda] = lib.comandasDeColumna(estado, 'listo')
  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 4, 'usa el emitidoEn del socket-server')
})

test('un order:status a listo sin emitidoEn usa la hora de llegada', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(1, { estado: 'en_preparacion' })])
  const estado = lib.aplicarEstado(inicial, { eventId: 'evt-2', id_pedido: 1, estado: 'listo' })

  const [comanda] = lib.comandasDeColumna(estado, 'listo')
  assert.ok(Number.isFinite(comanda.listoEnMs), 'queda una marca utilizable')
  assert.strictEqual(pase.minutosEnPase(comanda, comanda.listoEnMs), 0)
})

test('un order:status que NO es listo no deja marca de pase', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(1, { estado: 'recibido' })])
  const estado = lib.aplicarEstado(inicial, {
    eventId: 'evt-3',
    id_pedido: 1,
    estado: 'en_preparacion',
  })

  assert.strictEqual(estado.comandas[0].listoEnMs, undefined)
})

test('el PATCH propio tambien anota la hora al marcar listo', () => {
  const inicial = lib.cargarInicial(lib.estadoInicial(), [COMANDA(1, { estado: 'en_preparacion' })])
  const estado = lib.marcarEstadoLocal(inicial, 1, 'listo')

  const [comanda] = lib.comandasDeColumna(estado, 'listo')
  assert.ok(Number.isFinite(comanda.listoEnMs))
})

test('la hora de listo sobrevive a una recarga porque la manda la API', () => {
  let estado = lib.cargarInicial(lib.estadoInicial(), [COMANDA(1, { estado: 'en_preparacion' })])
  estado = lib.marcarEstadoLocal(estado, 1, 'listo')

  // Recarga: la API devuelve la comanda con su listo_en de historial_estados.
  const trasRecargar = lib.cargarInicial(estado, [COMANDA(1, { listo_en: haceMinutos(40) })])
  const [comanda] = lib.comandasDeColumna(trasRecargar, 'listo')

  assert.strictEqual(pase.minutosEnPase(comanda, AHORA), 40)
  assert.strictEqual(pase.sinRecoger(comanda, AHORA), true, 'y sigue marcada como olvidada')
})
