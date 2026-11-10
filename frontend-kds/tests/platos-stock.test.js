/**
 * ISSUE #137: el KDS volvia a mostrar DISPONIBLE al recargar un plato agotado
 * por inventario.
 *
 * El panel de agotados cargaba `GET /platos` y usaba solo `disponible`, que es
 * el interruptor MANUAL de la cocina. Un plato agotado por stock se veia AGOTADO
 * en vivo (por el evento) y volvia a DISPONIBLE al recargar, porque su
 * interruptor seguia encendido. La API si manda el otro dato: `stock_suficiente`.
 *
 * Lo que se vigila aqui:
 *   - el mapeo de GET /platos: lo que se MUESTRA es el efectivo (manual Y
 *     stock), y se guarda aparte el interruptor para el boton;
 *   - la etiqueta "stock" sale solo cuando el motivo ES el inventario;
 *   - el boton conmuta el interruptor MANUAL y nunca el stock;
 *   - el evento trae el EFECTIVO: se aplica sin apagar el interruptor, y la
 *     relectura del plato (GET /platos/:id) manda sobre el.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aplicarEventoPlato,
  aplicarPlatoReleido,
  buscarPlato,
  cargarPlatos,
  confirmarCambioPlato,
  contarPlatosAgotados,
  estadoInicial,
  filtrarPlatos,
  marcarEnVueloPlato,
  motivoAgotado,
  platosDe,
} from '../src/lib/agotados.js'

/** Estado con los platos ya cargados desde la respuesta de GET /platos. */
const conFilas = (...filas) => cargarPlatos(estadoInicial(), filas)

const FILA = (extra = {}) => ({
  id_plato: 1,
  nombre: 'Nachos Supremos',
  disponible: true,
  stock_suficiente: true,
  ...extra,
})

// ---------------------------------------------------------------------------
// El mapeo de GET /platos
// ---------------------------------------------------------------------------

test('issue-137: con el interruptor encendido y SIN stock, el plato esta agotado', () => {
  // Es el caso del issue: antes se veia DISPONIBLE al recargar.
  const plato = buscarPlato(conFilas(FILA({ stock_suficiente: false })), 1)

  assert.equal(plato.disponible, false, 'lo que se muestra es el efectivo')
  assert.equal(plato.disponible_manual, true, 'el interruptor sigue encendido')
  assert.equal(plato.stock_suficiente, false)
  assert.equal(motivoAgotado(plato), 'stock', 'y la etiqueta dice por que')
})

test('issue-137: apagado a mano es agotado SIN etiqueta de stock', () => {
  // La culpa es de la cocina, no del inventario: etiquetarlo mal seria peor que
  // no etiquetar nada, porque el stock no se arregla con el boton.
  const plato = buscarPlato(conFilas(FILA({ disponible: false })), 1)

  assert.equal(plato.disponible, false)
  assert.equal(plato.disponible_manual, false)
  assert.equal(motivoAgotado(plato), null)
})

test('issue-137: apagado a mano Y sin stock se muestra como manual', () => {
  // Los dos motivos a la vez: gana el que la cocina puede arreglar, igual que el
  // `motivo` de la vista v_carta_disponible, donde "manual" gana.
  const plato = buscarPlato(conFilas(FILA({ disponible: false, stock_suficiente: false })), 1)

  assert.equal(plato.disponible, false)
  assert.equal(motivoAgotado(plato), null)
  assert.equal(plato.stock_suficiente, false, 'pero el dato se guarda')
})

test('issue-137: con las dos cosas bien, el plato esta disponible', () => {
  const plato = buscarPlato(conFilas(FILA()), 1)

  assert.equal(plato.disponible, true)
  assert.equal(motivoAgotado(plato), null)
})

test('issue-137: sin stock_suficiente se trata como CON stock', () => {
  // Es el DEFAULT de la columna y el valor de un plato sin receta, que no
  // controla inventario. Un backend viejo se comporta como antes.
  const fila = FILA()
  delete fila.stock_suficiente
  const plato = buscarPlato(conFilas(fila), 1)

  assert.equal(plato.disponible, true)
  assert.equal(plato.stock_suficiente, true)
  assert.equal(motivoAgotado(plato), null)
})

test('issue-137: un plato agotado por stock cuenta en la insignia', () => {
  const estado = conFilas(FILA({ stock_suficiente: false }), FILA({ id_plato: 2 }))

  assert.equal(contarPlatosAgotados(estado), 1)
})

test('issue-137: y sale en el filtro de "solo agotados"', () => {
  const estado = conFilas(FILA({ stock_suficiente: false }), FILA({ id_plato: 2 }))

  assert.deepEqual(
    filtrarPlatos(estado, { soloAgotados: true }).map((p) => p.id_plato),
    [1]
  )
})

// ---------------------------------------------------------------------------
// El boton: solo el interruptor manual
// ---------------------------------------------------------------------------

test('issue-137: el boton mueve el interruptor y NO toca el stock', () => {
  const estado = marcarEnVueloPlato(conFilas(FILA()), 1, false)
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible_manual, false, 'se pidio agotar a mano')
  assert.equal(plato.stock_suficiente, true, 'el stock no se toca desde el panel')
  assert.equal(plato.disponible, false)
})

test('issue-137: encender a mano un plato sin stock lo deja agotado', () => {
  // Lo que va a contestar el backend (el aviso sale con el efectivo, issue
  // #136) y lo que ve el comensal. Mostrarlo disponible seria mentir.
  const estado = marcarEnVueloPlato(conFilas(FILA({ disponible: false, stock_suficiente: false })), 1, true)
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible_manual, true)
  assert.equal(plato.disponible, false)
  assert.equal(motivoAgotado(plato), 'stock', 'y ahora la etiqueta explica por que')
})

test('issue-137: la respuesta del PATCH trae las dos columnas', () => {
  // confirmarCambioPlato aplica el interruptor que contesto el servidor, y la
  // relectura de la misma respuesta pone el stock.
  let estado = conFilas(FILA({ disponible: false, stock_suficiente: false }))
  estado = marcarEnVueloPlato(estado, 1, true)
  estado = confirmarCambioPlato(estado, 1, true)
  estado = aplicarPlatoReleido(estado, {
    id: 1,
    fila: { id_plato: 1, nombre: 'Nachos Supremos', disponible: true, stock_suficiente: false },
  })
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible_manual, true)
  assert.equal(plato.stock_suficiente, false)
  assert.equal(plato.disponible, false)
})

// ---------------------------------------------------------------------------
// El evento trae el EFECTIVO
// ---------------------------------------------------------------------------

test('issue-137: un evento false con el interruptor encendido es falta de stock', () => {
  // El evento tiene un solo booleano y no dice por que. Si el interruptor estaba
  // encendido, lo unico que pudo apagarlo es el inventario.
  const estado = aplicarEventoPlato(conFilas(FILA()), {
    id_plato: 1,
    disponible: false,
    emitidoEn: '2026-11-09T12:00:00.000Z',
  })
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible, false)
  assert.equal(plato.disponible_manual, true, 'el evento NO apaga el interruptor de la cocina')
  assert.equal(motivoAgotado(plato), 'stock')
})

test('issue-137: un evento true repone las dos cosas', () => {
  const estado = aplicarEventoPlato(conFilas(FILA({ disponible: true, stock_suficiente: false })), {
    id_plato: 1,
    disponible: true,
    emitidoEn: '2026-11-09T12:00:00.000Z',
  })
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible, true)
  assert.equal(plato.stock_suficiente, true)
  assert.equal(motivoAgotado(plato), null)
})

test('issue-137: un evento false sobre un plato ya apagado a mano no inventa stock', () => {
  const estado = aplicarEventoPlato(conFilas(FILA({ disponible: false })), {
    id_plato: 1,
    disponible: false,
    emitidoEn: '2026-11-09T12:00:00.000Z',
  })
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible, false)
  assert.equal(plato.stock_suficiente, true, 'no se culpa al inventario sin motivo')
  assert.equal(motivoAgotado(plato), null)
})

// ---------------------------------------------------------------------------
// La relectura del plato manda sobre el evento
// ---------------------------------------------------------------------------

test('issue-137: la relectura pone las dos columnas tal como estan en la base', () => {
  const estado = aplicarPlatoReleido(conFilas(FILA()), {
    id: 1,
    fila: { id_plato: 1, nombre: 'Nachos Supremos', disponible: true, stock_suficiente: false },
  })
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible, false)
  assert.equal(plato.disponible_manual, true)
  assert.equal(plato.stock_suficiente, false)
  assert.equal(motivoAgotado(plato), 'stock')
})

test('issue-137: la relectura corrige lo que el evento adivino', () => {
  // El evento dijo false y se asumio falta de stock; la fila dice que en
  // realidad lo apago la cocina.
  let estado = aplicarEventoPlato(conFilas(FILA()), {
    id_plato: 1,
    disponible: false,
    emitidoEn: '2026-11-09T12:00:00.000Z',
  })
  assert.equal(motivoAgotado(buscarPlato(estado, 1)), 'stock')

  estado = aplicarPlatoReleido(estado, {
    id: 1,
    fila: { id_plato: 1, nombre: 'Nachos Supremos', disponible: false, stock_suficiente: true },
  })
  const plato = buscarPlato(estado, 1)

  assert.equal(plato.disponible_manual, false)
  assert.equal(motivoAgotado(plato), null, 'la etiqueta de stock desaparece')
})

test('issue-137: la relectura de un plato que no esta en la lista no lo agrega', () => {
  // La lista la manda GET /platos: un plato que no esta ahi no pinta nada.
  const estado = aplicarPlatoReleido(conFilas(FILA()), {
    id: 99,
    fila: { id_plato: 99, nombre: 'Fantasma', disponible: true },
  })

  assert.deepEqual(platosDe(estado).map((p) => p.id_plato), [1])
})

test('issue-137: una relectura sin fila usable no cambia nada', () => {
  const base = conFilas(FILA({ stock_suficiente: false }))
  for (const datos of [
    { id: 1, fila: null },
    { id: 1, fila: 'texto' },
    { id: 0, fila: { id_plato: 0 } },
    { id: 'abc', fila: { nombre: 'x' } },
    {},
  ]) {
    const estado = aplicarPlatoReleido(base, datos)
    assert.deepEqual(buscarPlato(estado, 1), buscarPlato(base, 1), JSON.stringify(datos))
  }
})

test('issue-137: la relectura conserva el nombre si la fila no lo trae', () => {
  const estado = aplicarPlatoReleido(conFilas(FILA()), {
    id: 1,
    fila: { id_plato: 1, disponible: false, stock_suficiente: false },
  })

  // platoDeLaApi pone 'Sin nombre' cuando falta, que es el mismo criterio de la
  // carga: la fila de GET /platos/:id siempre trae nombre, asi que esto solo
  // pasa con una respuesta rota.
  assert.equal(buscarPlato(estado, 1).nombre, 'Sin nombre')
  assert.equal(buscarPlato(estado, 1).disponible, false)
})
