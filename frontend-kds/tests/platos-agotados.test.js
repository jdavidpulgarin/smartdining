/**
 * La seccion de PLATOS del panel de agotados (D-14).
 *
 * Lo que se vigila aqui:
 *   - el interruptor se mueve antes del PATCH y VUELVE ATRAS si falla, con el
 *     error real del backend en su fila (no un texto inventado);
 *   - `plato:disponibilidad` sincroniza varias pantallas de cocina, y un evento
 *     MAS VIEJO que lo ya pintado se descarta por `emitidoEn`: el socket-server
 *     difunde a todas las pantallas y la red no garantiza el orden, asi que un
 *     "disponible" retrasado no puede reencender un plato ya agotado;
 *   - las dos listas (ingredientes y platos) son independientes: un evento de
 *     una no toca a la otra, y el fallo de una no apaga a la otra;
 *   - "agotado por stock" NO se adivina: hoy el backend no dice el motivo y la
 *     etiqueta no sale. El sitio esta hecho, pero vacio.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aplicarEvento,
  aplicarEventoPlato,
  avisoDelPanelPlatos,
  buscarPlato,
  cargarMenu,
  cargarPlatos,
  confirmarCambioPlato,
  contarAgotados,
  contarPlatos,
  contarPlatosAgotados,
  estadoInicial,
  filtrarPlatos,
  hayCambioEnVueloPlato,
  limpiarErrorPlato,
  marcarCargandoPlatos,
  marcarEnVueloPlato,
  marcarErrorPlatos,
  motivoAgotado,
  motivoListaVaciaPlatos,
  platosDe,
  revertirCambioPlato,
} from '../src/lib/agotados.js'

/** Filas con la forma real de GET /platos: la fila de la tabla, tal cual. */
function filas(...platos) {
  return platos.map((p, i) => ({
    id_plato: p.id_plato ?? i + 1,
    id_categoria: p.id_categoria ?? 1,
    nombre: p.nombre ?? `Plato ${i + 1}`,
    descripcion: p.descripcion ?? null,
    precio: p.precio ?? 20000,
    url_imagen: null,
    disponible: p.disponible !== false,
    tiempo_preparacion_estimado: 15,
    creado_en: '2026-01-01T00:00:00.000Z',
    ...p.extra,
  }))
}

/** Estado con esos platos ya cargados. */
function conPlatos(...platos) {
  return cargarPlatos(estadoInicial(), filas(...platos))
}

/** Un evento `plato:disponibilidad` como lo emite el socket-server. */
function evento(id, disponible, emitidoEn = '2026-01-01T12:00:00.000Z') {
  return { id_plato: id, disponible, emitidoEn }
}

// ---------------------------------------------------------------------------
// Cargar la lista
// ---------------------------------------------------------------------------

test('carga los platos conservando el orden de la base', () => {
  const estado = conPlatos(
    { id_plato: 7, nombre: 'Bandeja paisa' },
    { id_plato: 3, nombre: 'Arepa de huevo', disponible: false }
  )

  assert.deepEqual(
    platosDe(estado).map((p) => [p.id_plato, p.nombre, p.disponible]),
    [
      [7, 'Bandeja paisa', true],
      [3, 'Arepa de huevo', false],
    ]
  )
})

test('se queda solo con los campos que el panel usa', () => {
  const estado = conPlatos({ id_plato: 1, nombre: 'Sancocho', precio: 32000 })
  assert.deepEqual(Object.keys(platosDe(estado)[0]).sort(), ['disponible', 'id_plato', 'nombre'])
})

test('una fila sin id usable se descarta', () => {
  const estado = cargarPlatos(estadoInicial(), [
    { id_plato: null, nombre: 'Roto' },
    { id_plato: 4, nombre: 'Bueno' },
  ])
  assert.deepEqual(
    platosDe(estado).map((p) => p.id_plato),
    [4]
  )
})

test('una respuesta que no es una lista deja la lista vacia, no revienta', () => {
  assert.deepEqual(platosDe(cargarPlatos(estadoInicial(), null)), [])
  assert.deepEqual(platosDe(cargarPlatos(estadoInicial(), { platos: [] })), [])
})

test('un plato sin nombre no deja la fila en blanco', () => {
  const estado = cargarPlatos(estadoInicial(), [{ id_plato: 2, nombre: '' }])
  assert.equal(platosDe(estado)[0].nombre, 'Sin nombre')
})

test('cuenta los agotados y el total por id', () => {
  const estado = conPlatos(
    { id_plato: 1, disponible: false },
    { id_plato: 2 },
    { id_plato: 3, disponible: false }
  )
  assert.equal(contarPlatosAgotados(estado), 2)
  assert.equal(contarPlatos(estado), 3)
})

test('buscarPlato encuentra por id y no por nombre', () => {
  const estado = conPlatos({ id_plato: 9, nombre: 'Mondongo' })
  assert.equal(buscarPlato(estado, 9).nombre, 'Mondongo')
  assert.equal(buscarPlato(estado, '9').nombre, 'Mondongo')
  assert.equal(buscarPlato(estado, 10), null)
})

// ---------------------------------------------------------------------------
// Buscador y filtro
// ---------------------------------------------------------------------------

test('el buscador de platos ignora mayusculas y tildes', () => {
  const estado = conPlatos({ id_plato: 1, nombre: 'Ajiaco Santafereño' })
  assert.equal(filtrarPlatos(estado, { texto: 'santafereno' }).length, 1)
  assert.equal(filtrarPlatos(estado, { texto: 'AJIACO' }).length, 1)
  assert.equal(filtrarPlatos(estado, { texto: 'pizza' }).length, 0)
})

test('solo agotados deja unicamente los platos apagados', () => {
  const estado = conPlatos({ id_plato: 1, disponible: false }, { id_plato: 2 })
  assert.deepEqual(
    filtrarPlatos(estado, { soloAgotados: true }).map((p) => p.id_plato),
    [1]
  )
})

test('distingue una carta sin platos de una busqueda sin resultados', () => {
  assert.equal(motivoListaVaciaPlatos(estadoInicial()), 'vacio')
  assert.equal(motivoListaVaciaPlatos(conPlatos({ id_plato: 1 }), { texto: 'zzz' }), 'sin-resultados')
})

test('si no hay ningun plato agotado, el filtro lo dice con su propia frase', () => {
  const estado = conPlatos({ id_plato: 1 })
  assert.equal(motivoListaVaciaPlatos(estado, { soloAgotados: true }), 'sin-agotados')
  assert.equal(motivoListaVaciaPlatos(estado, { soloAgotados: true, texto: 'zzz' }), 'sin-resultados')
})

test('con platos que coinciden no hay motivo de vacio', () => {
  assert.equal(motivoListaVaciaPlatos(conPlatos({ id_plato: 1, nombre: 'Sopa' }), { texto: 'sop' }), null)
})

// ---------------------------------------------------------------------------
// El interruptor: optimista, con reversion
// ---------------------------------------------------------------------------

test('el interruptor del plato se mueve antes del PATCH', () => {
  const estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  assert.equal(buscarPlato(estado, 1).disponible, false)
  assert.equal(hayCambioEnVueloPlato(estado, 1), true)
})

test('en vuelo no toca a los demas platos', () => {
  const estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }, { id_plato: 2 }), 1, false)
  assert.equal(buscarPlato(estado, 2).disponible, true)
  assert.equal(hayCambioEnVueloPlato(estado, 2), false)
})

test('confirmar fija el valor que dijo el servidor, no el que se pidio', () => {
  let estado = conPlatos({ id_plato: 1 })
  estado = marcarEnVueloPlato(estado, 1, false)
  // El servidor contesta que sigue disponible (otro lo repuso entremedias).
  estado = confirmarCambioPlato(estado, 1, true)

  assert.equal(buscarPlato(estado, 1).disponible, true)
  assert.equal(hayCambioEnVueloPlato(estado, 1), false)
})

test('si el PATCH falla, el interruptor vuelve atras y el error queda en su fila', () => {
  let estado = conPlatos({ id_plato: 1 }, { id_plato: 2 })
  estado = marcarEnVueloPlato(estado, 1, false)
  estado = revertirCambioPlato(estado, 1, 'No tienes permiso para cambiar la carta')

  assert.equal(buscarPlato(estado, 1).disponible, true, 'vuelve al valor de antes')
  assert.equal(hayCambioEnVueloPlato(estado, 1), false)
  assert.equal(estado.platos.errores['1'], 'No tienes permiso para cambiar la carta')
  assert.equal(estado.platos.errores['2'], undefined, 'el error es de SU fila')
})

test('revertir sin mensaje deja uno por defecto', () => {
  let estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  estado = revertirCambioPlato(estado, 1, '')
  assert.equal(estado.platos.errores['1'], 'No se pudo cambiar la disponibilidad del plato')
})

test('revertir sin nada en vuelo no inventa un valor', () => {
  const estado = revertirCambioPlato(conPlatos({ id_plato: 1 }), 1, 'Fallo de red')
  assert.equal(buscarPlato(estado, 1).disponible, true)
  assert.equal(estado.platos.errores['1'], 'Fallo de red')
})

test('dos cambios seguidos sobre el mismo plato no pierden el valor original', () => {
  let estado = conPlatos({ id_plato: 1 })
  estado = marcarEnVueloPlato(estado, 1, false)
  estado = marcarEnVueloPlato(estado, 1, true)
  estado = revertirCambioPlato(estado, 1, 'Se cayo la red')

  assert.equal(buscarPlato(estado, 1).disponible, true, 'vuelve al valor del PRIMER cambio')
})

test('volver a tocar limpia el error viejo de esa fila', () => {
  let estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  estado = revertirCambioPlato(estado, 1, 'Fallo')
  estado = marcarEnVueloPlato(estado, 1, false)
  assert.equal(estado.platos.errores['1'], undefined)
})

test('conmutar un plato que no existe no cambia nada', () => {
  const estado = conPlatos({ id_plato: 1 })
  assert.equal(marcarEnVueloPlato(estado, 99, false), estado)
})

test('limpiarErrorPlato quita solo el de ese plato', () => {
  let estado = conPlatos({ id_plato: 1 }, { id_plato: 2 })
  estado = revertirCambioPlato(marcarEnVueloPlato(estado, 1, false), 1, 'A')
  estado = revertirCambioPlato(marcarEnVueloPlato(estado, 2, false), 2, 'B')
  estado = limpiarErrorPlato(estado, 1)

  assert.equal(estado.platos.errores['1'], undefined)
  assert.equal(estado.platos.errores['2'], 'B')
})

test('recargar la lista descarta los errores por fila', () => {
  let estado = conPlatos({ id_plato: 1 })
  estado = revertirCambioPlato(marcarEnVueloPlato(estado, 1, false), 1, 'Fallo')
  estado = cargarPlatos(estado, filas({ id_plato: 1 }))
  assert.deepEqual(estado.platos.errores, {})
})

// ---------------------------------------------------------------------------
// Sincronizacion por socket: plato:disponibilidad
// ---------------------------------------------------------------------------

test('el evento de otra pantalla de cocina se aplica sin recargar', () => {
  const estado = aplicarEventoPlato(conPlatos({ id_plato: 1 }), evento(1, false))
  assert.equal(buscarPlato(estado, 1).disponible, false)
})

test('el evento solo toca al plato de su id', () => {
  const estado = aplicarEventoPlato(conPlatos({ id_plato: 1 }, { id_plato: 2 }), evento(1, false))
  assert.equal(buscarPlato(estado, 2).disponible, true)
})

test('un id que no esta en la lista se ignora sin ruido', () => {
  const estado = conPlatos({ id_plato: 1 })
  assert.equal(aplicarEventoPlato(estado, evento(99, false)), estado)
})

test('un evento mal formado se ignora', () => {
  const estado = conPlatos({ id_plato: 1 })
  assert.equal(aplicarEventoPlato(estado, null), estado)
  assert.equal(aplicarEventoPlato(estado, {}), estado)
  assert.equal(aplicarEventoPlato(estado, { id_plato: 1 }), estado)
  // Sin coercion: un "false" en texto no agota nada.
  assert.equal(aplicarEventoPlato(estado, { id_plato: 1, disponible: 'false' }), estado)
})

test('un evento MAS VIEJO que el ya aplicado se descarta', () => {
  let estado = conPlatos({ id_plato: 1 })
  estado = aplicarEventoPlato(estado, evento(1, false, '2026-01-01T12:00:05.000Z'))
  // Llega tarde el "disponible" que se emitio ANTES: no puede reencenderlo.
  estado = aplicarEventoPlato(estado, evento(1, true, '2026-01-01T12:00:00.000Z'))

  assert.equal(buscarPlato(estado, 1).disponible, false)
})

test('un evento con el MISMO sello que el ya aplicado se descarta', () => {
  const sello = '2026-01-01T12:00:05.000Z'
  let estado = aplicarEventoPlato(conPlatos({ id_plato: 1 }), evento(1, false, sello))
  estado = aplicarEventoPlato(estado, evento(1, true, sello))
  assert.equal(buscarPlato(estado, 1).disponible, false)
})

test('un evento mas nuevo si gana', () => {
  let estado = aplicarEventoPlato(conPlatos({ id_plato: 1 }), evento(1, false, '2026-01-01T12:00:00.000Z'))
  estado = aplicarEventoPlato(estado, evento(1, true, '2026-01-01T12:00:05.000Z'))
  assert.equal(buscarPlato(estado, 1).disponible, true)
})

test('sin emitidoEn utilizable se aplica, antes que perder un cambio real', () => {
  let estado = conPlatos({ id_plato: 1 })
  estado = aplicarEventoPlato(estado, { id_plato: 1, disponible: false })
  assert.equal(buscarPlato(estado, 1).disponible, false)

  estado = aplicarEventoPlato(estado, { id_plato: 1, disponible: true, emitidoEn: 'no-es-fecha' })
  assert.equal(buscarPlato(estado, 1).disponible, true)
})

test('tras recargar la lista, un evento viejo ya no se aplica por error', () => {
  let estado = aplicarEventoPlato(conPlatos({ id_plato: 1 }), evento(1, false, '2026-01-01T12:00:05.000Z'))
  // La recarga es mas nueva que cualquier evento anterior, y el sello se borra.
  estado = cargarPlatos(estado, filas({ id_plato: 1, disponible: false }))
  assert.deepEqual(estado.platos.visto, {})

  // Un evento posterior a la recarga manda, aunque su sello sea viejo: es lo
  // unico que se puede saber sin un reloj compartido con el servidor HTTP.
  estado = aplicarEventoPlato(estado, evento(1, true, '2026-01-01T12:00:01.000Z'))
  assert.equal(buscarPlato(estado, 1).disponible, true)
})

test('el eco de mi propio cambio NO repinta nada', () => {
  let estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  const antes = estado.platos.lista
  estado = aplicarEventoPlato(estado, evento(1, false))

  assert.equal(estado.platos.lista, antes, 'la misma lista: ni un repintado')
  assert.equal(hayCambioEnVueloPlato(estado, 1), true, 'sigue esperando su PATCH')
})

test('el eco anota su sello, para que uno anterior no se cuele despues', () => {
  let estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  estado = aplicarEventoPlato(estado, evento(1, false, '2026-01-01T12:00:05.000Z'))
  estado = confirmarCambioPlato(estado, 1, false)

  // Este es anterior al eco: llega tarde y no debe reencender el plato.
  estado = aplicarEventoPlato(estado, evento(1, true, '2026-01-01T12:00:01.000Z'))
  assert.equal(buscarPlato(estado, 1).disponible, false)
})

test('si el evento dice lo CONTRARIO que pedi, gana el evento', () => {
  let estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  estado = aplicarEventoPlato(estado, evento(1, true))

  assert.equal(buscarPlato(estado, 1).disponible, true)
  assert.equal(hayCambioEnVueloPlato(estado, 1), false, 'otra pantalla escribio despues')
})

test('tras el eco, confirmar el PATCH deja el valor del servidor', () => {
  let estado = marcarEnVueloPlato(conPlatos({ id_plato: 1 }), 1, false)
  estado = aplicarEventoPlato(estado, evento(1, false))
  estado = confirmarCambioPlato(estado, 1, false)

  assert.equal(buscarPlato(estado, 1).disponible, false)
  assert.equal(hayCambioEnVueloPlato(estado, 1), false)
})

// ---------------------------------------------------------------------------
// Las dos listas son independientes
// ---------------------------------------------------------------------------

test('un evento de ingrediente no toca los platos', () => {
  const estado = conPlatos({ id_plato: 1 })
  const despues = aplicarEvento(estado, { id_ingrediente: 1, disponible: false })
  assert.equal(buscarPlato(despues, 1).disponible, true)
})

test('un evento de plato no toca los ingredientes', () => {
  let estado = cargarMenu(estadoInicial(), {
    categorias: [
      {
        id_categoria: 1,
        platos: [
          {
            id_plato: 1,
            nombre: 'Bowl',
            pasos: [
              {
                id_paso: 10,
                nombre: 'Base',
                ingredientes: [{ id_ingrediente: 50, nombre: 'Arroz', disponible: true }],
              },
            ],
          },
        ],
      },
    ],
  })
  estado = cargarPlatos(estado, filas({ id_plato: 1, nombre: 'Bowl' }))
  estado = aplicarEventoPlato(estado, evento(1, false))

  assert.equal(contarAgotados(estado), 0, 'el ingrediente del plato sigue disponible')
  assert.equal(contarPlatosAgotados(estado), 1)
})

test('un fallo al leer los platos no apaga la seccion de ingredientes', () => {
  const estado = marcarErrorPlatos(conPlatos({ id_plato: 1 }), 'Error 500', 500)
  assert.equal(estado.error, null, 'la carta no tiene nada que ver')
  assert.equal(avisoDelPanelPlatos(estado), 'error')
})

// ---------------------------------------------------------------------------
// Avisos de la seccion
// ---------------------------------------------------------------------------

test('cargando solo mientras no hay platos que mostrar', () => {
  assert.equal(avisoDelPanelPlatos(marcarCargandoPlatos(estadoInicial())), 'cargando')
  assert.equal(avisoDelPanelPlatos(marcarCargandoPlatos(conPlatos({ id_plato: 1 }))), null)
})

test('un 403 se distingue de un fallo de red', () => {
  assert.equal(avisoDelPanelPlatos(marcarErrorPlatos(estadoInicial(), 'Sin permiso', 403)), 'prohibido')
  assert.equal(avisoDelPanelPlatos(marcarErrorPlatos(estadoInicial(), 'Fallo de red')), 'error')
})

test('sin error y con datos, no hay aviso', () => {
  assert.equal(avisoDelPanelPlatos(conPlatos({ id_plato: 1 })), null)
})

test('un fallo al recargar NO borra la lista de platos que ya se veia', () => {
  const estado = marcarErrorPlatos(conPlatos({ id_plato: 1 }), 'Fallo de red')
  assert.equal(platosDe(estado).length, 1)
  assert.equal(estado.platos.error, 'Fallo de red')
})

test('marcarErrorPlatos sin mensaje deja uno por defecto', () => {
  assert.equal(marcarErrorPlatos(estadoInicial(), '').platos.error, 'No se pudieron leer los platos')
})

// ---------------------------------------------------------------------------
// "Agotado por stock": el sitio esta hecho, pero hoy esta vacio
// ---------------------------------------------------------------------------

test('hoy ningun plato se marca como agotado por stock', () => {
  // GET /platos devuelve la fila de la tabla, y `platos` no tiene ninguna
  // columna que diga el motivo: solo `disponible`.
  const estado = conPlatos({ id_plato: 1, disponible: false })
  assert.equal(motivoAgotado(buscarPlato(estado, 1)), null)
})

test('un plato disponible nunca lleva motivo', () => {
  assert.equal(motivoAgotado({ id_plato: 1, disponible: true }), null)
  assert.equal(motivoAgotado({ id_plato: 1, disponible: true, agotado_por_stock: true }), null)
})

test('el dia que el backend mande el motivo, la etiqueta aparece sola', () => {
  const estado = conPlatos({
    id_plato: 1,
    disponible: false,
    extra: { agotado_por_stock: true },
  })
  assert.equal(motivoAgotado(buscarPlato(estado, 1)), 'stock')
})

test('el motivo no se adivina a partir de un valor que no sea booleano', () => {
  const estado = conPlatos({
    id_plato: 1,
    disponible: false,
    extra: { agotado_por_stock: 'si' },
  })
  assert.equal(buscarPlato(estado, 1).agotado_por_stock, undefined, 'no se copia lo que no es booleano')
  assert.equal(motivoAgotado(buscarPlato(estado, 1)), null)
})

test('motivoAgotado aguanta un plato que no existe', () => {
  assert.equal(motivoAgotado(null), null)
  assert.equal(motivoAgotado(undefined), null)
})
