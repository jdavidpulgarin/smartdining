import assert from 'node:assert'
import test from 'node:test'
import * as espera from '../src/lib/espera.js'

// Cronometro y semaforo de tiempos (D-09): umbrales, formato con tope y la
// senal no-visual. Logica pura, sin React ni reloj real.

// ---------------------------------------------------------------------------
// Umbrales
// ---------------------------------------------------------------------------

test('menos de 10 minutos va en tiempo', () => {
  for (const m of [0, 1, 5, 9, 9.9]) {
    assert.strictEqual(espera.nivelDeEspera(m), 'normal', `${m} min`)
  }
})

test('de 10 a 15 minutos es ambar', () => {
  for (const m of [10, 12, 15]) {
    assert.strictEqual(espera.nivelDeEspera(m), 'ambar', `${m} min`)
  }
})

test('por encima de 15 minutos es rojo', () => {
  for (const m of [15.1, 16, 40, 19000]) {
    assert.strictEqual(espera.nivelDeEspera(m), 'rojo', `${m} min`)
  }
})

test('los umbrales son los de la cocina: 10 y 15', () => {
  assert.strictEqual(espera.UMBRAL_AMBAR, 10)
  assert.strictEqual(espera.UMBRAL_ROJO, 15)
  // Justo en el limite inferior ya avisa, y justo en el superior todavia no es rojo.
  assert.strictEqual(espera.nivelDeEspera(espera.UMBRAL_AMBAR), 'ambar')
  assert.strictEqual(espera.nivelDeEspera(espera.UMBRAL_ROJO), 'ambar')
})

test('un valor sin sentido no inventa una alarma', () => {
  for (const m of [undefined, null, NaN, 'hola']) {
    assert.strictEqual(espera.nivelDeEspera(m), 'normal')
  }
})

// ---------------------------------------------------------------------------
// Formato con tope
// ---------------------------------------------------------------------------

test('el texto son minutos hasta el tope', () => {
  assert.strictEqual(espera.textoDeEspera(0), '0 min')
  assert.strictEqual(espera.textoDeEspera(7), '7 min')
  assert.strictEqual(espera.textoDeEspera(59), '59 min')
  assert.strictEqual(espera.textoDeEspera(99), '99 min')
})

test('desde 100 minutos se muestra "+99 min"', () => {
  assert.strictEqual(espera.textoDeEspera(100), '+99 min')
  assert.strictEqual(espera.textoDeEspera(101), '+99 min')
  assert.strictEqual(
    espera.textoDeEspera(19056),
    '+99 min',
    'los datos sembrados traen comandas de hace semanas: no se pinta la cifra real'
  )
})

test('los minutos se truncan y nunca salen negativos', () => {
  assert.strictEqual(espera.textoDeEspera(3.9), '3 min')
  assert.strictEqual(espera.textoDeEspera(-5), '0 min')
  assert.strictEqual(espera.textoDeEspera(undefined), '0 min')
})

// ---------------------------------------------------------------------------
// Senal accesible (no solo color)
// ---------------------------------------------------------------------------

test('cada nivel trae signo y etiqueta, no solo color', () => {
  const normal = espera.senalDeEspera(2)
  const ambar = espera.senalDeEspera(12)
  const rojo = espera.senalDeEspera(30)

  assert.strictEqual(normal.nivel, 'normal')
  assert.strictEqual(ambar.nivel, 'ambar')
  assert.strictEqual(rojo.nivel, 'rojo')

  for (const senal of [normal, ambar, rojo]) {
    assert.ok(senal.signo, 'hay un signo visible')
    assert.ok(senal.etiqueta, 'hay un texto para lectores de pantalla')
  }

  // Los tres se distinguen entre si sin mirar el color.
  assert.notStrictEqual(normal.signo, ambar.signo)
  assert.notStrictEqual(ambar.signo, rojo.signo)
  assert.notStrictEqual(ambar.etiqueta, rojo.etiqueta)
})

// ---------------------------------------------------------------------------
// Minutos desde la creacion
// ---------------------------------------------------------------------------

test('con creado_en se cuentan los minutos desde esa hora', () => {
  const creado = '2026-10-12T20:00:00.000Z'
  const ahora = Date.parse(creado) + 7 * 60000

  assert.strictEqual(espera.minutosDesdeCreacion({ creado_en: creado }, ahora), 7)
})

test('creado_en manda sobre los minutos que vinieron en la carga', () => {
  const creado = '2026-10-12T20:00:00.000Z'
  const ahora = Date.parse(creado) + 20 * 60000

  assert.strictEqual(
    espera.minutosDesdeCreacion({ creado_en: creado, minutos_transcurridos: 3 }, ahora),
    20,
    'la hora de creacion sobrevive a recargas; los minutos de la carga, no'
  )
})

test('sin creado_en se usa la hora de llegada local del evento', () => {
  const llegada = 1_000_000
  const comanda = { recibidoEnMs: llegada, minutos_transcurridos: 0 }

  assert.strictEqual(espera.minutosDesdeCreacion(comanda, llegada), 0)
  assert.strictEqual(espera.minutosDesdeCreacion(comanda, llegada + 5 * 60000), 5)
})

test('sin creado_en ni llegada se usan los minutos de la API', () => {
  assert.strictEqual(espera.minutosDesdeCreacion({ minutos_transcurridos: 12.7 }, 0), 12)
})

test('una comanda sin ningun dato de tiempo no rompe', () => {
  assert.strictEqual(espera.minutosDesdeCreacion({}, Date.now()), 0)
  assert.strictEqual(espera.minutosDesdeCreacion(undefined, Date.now()), 0)
})

test('un creado_en invalido cae al siguiente criterio', () => {
  const comanda = { creado_en: 'no-es-una-fecha', minutos_transcurridos: 4 }
  assert.strictEqual(espera.minutosDesdeCreacion(comanda, Date.now()), 4)
})

test('un reloj atrasado no produce minutos negativos', () => {
  const creado = '2026-10-12T20:00:00.000Z'
  const ahora = Date.parse(creado) - 60000
  assert.strictEqual(espera.minutosDesdeCreacion({ creado_en: creado }, ahora), 0)
})

// ---------------------------------------------------------------------------
// El semaforo solo aplica a Nuevas y En preparacion
// ---------------------------------------------------------------------------

test('en Nuevas y En preparacion el semaforo sigue funcionando', () => {
  for (const estado of ['recibido', 'en_preparacion']) {
    assert.strictEqual(espera.aplicaSemaforo(estado), true, estado)
    assert.strictEqual(espera.senalDeEsperaDeComanda(estado, 3).nivel, 'normal')
    assert.strictEqual(espera.senalDeEsperaDeComanda(estado, 12).nivel, 'ambar')
    assert.strictEqual(espera.senalDeEsperaDeComanda(estado, 30).nivel, 'rojo')
  }
})

test('una comanda lista se muestra neutra, aunque lleve horas', () => {
  for (const minutos of [1, 12, 30, 19056]) {
    const senal = espera.senalDeEsperaDeComanda('listo', minutos)
    assert.strictEqual(senal.nivel, 'neutro', `${minutos} min`)
  }
})

test('en Listas no hay etiqueta ni signo: nada de "Atrasada"', () => {
  const senal = espera.senalDeEsperaDeComanda('listo', 300)

  assert.strictEqual(senal.etiqueta, '', 'sin texto de nivel')
  assert.strictEqual(senal.signo, '', 'sin signo')
  assert.notStrictEqual(senal.etiqueta, 'Atrasada')
})

test('el tiempo si se muestra en Listas, con el tope +99', () => {
  // La señal es neutra pero el reloj sigue: la comanda espera al mesero.
  assert.strictEqual(espera.senalDeEsperaDeComanda('listo', 300).nivel, 'neutro')
  assert.strictEqual(espera.textoDeEspera(300), '+99 min')
  assert.strictEqual(espera.textoDeEspera(42), '42 min')
})

test('los estados que ya salieron del tablero tampoco llevan semaforo', () => {
  for (const estado of ['entregado', 'pagado', 'cancelado', undefined, null]) {
    assert.strictEqual(espera.aplicaSemaforo(estado), false, String(estado))
    assert.strictEqual(espera.senalDeEsperaDeComanda(estado, 999).nivel, 'neutro')
  }
})

test('senalDeEspera (sin estado) conserva su comportamiento de siempre', () => {
  // La version por minutos se sigue usando y no cambia: solo se agrego la
  // variante que mira el estado.
  assert.strictEqual(espera.senalDeEspera(30).nivel, 'rojo')
  assert.strictEqual(espera.senalDeEspera(30).etiqueta, 'Atrasada')
})

test('la lista de estados con semaforo son las dos columnas de cocina', () => {
  assert.deepStrictEqual(espera.ESTADOS_CON_SEMAFORO, ['recibido', 'en_preparacion'])
})
