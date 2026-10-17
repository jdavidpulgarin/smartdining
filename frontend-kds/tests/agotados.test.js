/**
 * El panel de ingredientes agotados (D-10).
 *
 * Lo que se vigila aqui:
 *   - TODO va por id_ingrediente y nunca por nombre. En la carta hay nombres
 *     repetidos a proposito: la "Panceta Crujiente" del seed son dos
 *     ingredientes distintos, en dos pasos distintos, y agotar uno no agota el
 *     otro. Agrupar o contar por nombre los fusionaria y apagaria el
 *     equivocado, que en una cocina significa servir algo que no hay.
 *   - el interruptor se mueve antes del PATCH y vuelve atras si falla;
 *   - el eco de mi propio cambio NO repinta nada (seria el parpadeo), pero el
 *     cambio de otra pantalla si gana.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aplicarEvento,
  avisoDelPanel,
  buscarIngrediente,
  cargarMenu,
  confirmarCambio,
  contarAgotados,
  contarIngredientes,
  estadoInicial,
  filtrar,
  hayCambioEnVuelo,
  ingredientesDe,
  limpiarError,
  marcarCargando,
  marcarEnVuelo,
  marcarError,
  motivoListaVacia,
  normalizar,
  revertirCambio,
  rotuloDisponibilidad,
} from '../src/lib/agotados.js'

/** Construye una respuesta de GET /menu con la forma real de la base. */
function menu(...platos) {
  return {
    categorias: [
      {
        id_categoria: 1,
        categoria: 'Fuertes',
        platos: platos.map((p, i) => ({
          id_plato: p.id_plato ?? i + 1,
          nombre: p.nombre ?? `Plato ${i + 1}`,
          pasos: (p.pasos || []).map((s, j) => ({
            id_paso: s.id_paso ?? (i + 1) * 100 + j,
            nombre: s.nombre ?? `Paso ${j + 1}`,
            orden: j + 1,
            ingredientes: (s.ingredientes || []).map((ing) => ({
              id_ingrediente: ing.id,
              nombre: ing.nombre,
              disponible: ing.disponible !== false,
              precio_extra: 0,
              calorias: 0,
              alergenos: [],
              url_imagen: null,
            })),
          })),
        })),
      },
    ],
  }
}

/** Dos ingredientes con EL MISMO nombre, como en el seed real. */
const MENU_NOMBRES_REPETIDOS = menu(
  {
    id_plato: 7,
    nombre: 'Bowl Personalizado',
    pasos: [
      { id_paso: 101, nombre: 'Base', ingredientes: [{ id: 1, nombre: 'Arroz' }] },
      { id_paso: 102, nombre: 'Extras', ingredientes: [{ id: 7, nombre: 'Panceta Crujiente', disponible: false }] },
    ],
  },
  {
    id_plato: 9,
    nombre: 'Arepa Rellena',
    pasos: [
      {
        id_paso: 301,
        nombre: 'Tipo de Arepa',
        ingredientes: [
          { id: 29, nombre: 'Arepa de Maíz' },
          { id: 30, nombre: 'Panceta Crujiente' },
        ],
      },
    ],
  }
)

const cargado = (m = MENU_NOMBRES_REPETIDOS) => cargarMenu(estadoInicial(), m)

// ---------------------------------------------------------------------------
// Agrupar lo que llega de GET /menu
// ---------------------------------------------------------------------------

test('agrupa por plato y por paso, en el orden de la carta', () => {
  const estado = cargado()

  assert.equal(estado.grupos.length, 2)
  assert.deepEqual(
    estado.grupos.map((g) => g.plato),
    ['Bowl Personalizado', 'Arepa Rellena']
  )
  assert.deepEqual(
    estado.grupos[0].pasos.map((p) => p.paso),
    ['Base', 'Extras']
  )
})

test('cada ingrediente sabe de que plato y paso viene', () => {
  const ing = buscarIngrediente(cargado(), 30)

  assert.equal(ing.nombre, 'Panceta Crujiente')
  assert.equal(ing.plato, 'Arepa Rellena')
  assert.equal(ing.paso, 'Tipo de Arepa')
  assert.equal(ing.id_paso, 301)
  assert.equal(ing.id_plato, 9)
})

test('los platos sin pasos se omiten: no hay nada que agotar en ellos', () => {
  const estado = cargarMenu(estadoInicial(), menu({ nombre: 'Limonada', pasos: [] }))
  assert.deepEqual(estado.grupos, [])
})

test('un paso sin ingredientes no deja una cabecera vacia', () => {
  const estado = cargarMenu(
    estadoInicial(),
    menu({ nombre: 'Bowl', pasos: [{ nombre: 'Base', ingredientes: [] }] })
  )
  assert.deepEqual(estado.grupos, [])
})

test('una carta vacia o invalida no rompe nada', () => {
  for (const basura of [undefined, null, {}, { categorias: null }, { categorias: [] }]) {
    assert.deepEqual(cargarMenu(estadoInicial(), basura).grupos, [])
  }
})

test('un ingrediente sin id se descarta: sin id no se puede conmutar', () => {
  const estado = cargarMenu(estadoInicial(), {
    categorias: [
      {
        platos: [
          {
            id_plato: 1,
            nombre: 'Bowl',
            pasos: [
              {
                id_paso: 1,
                nombre: 'Base',
                ingredientes: [{ nombre: 'Sin id' }, { id_ingrediente: 5, nombre: 'Arroz' }],
              },
            ],
          },
        ],
      },
    ],
  })

  assert.equal(contarIngredientes(estado), 1)
  assert.equal(ingredientesDe(estado)[0].id_ingrediente, 5)
})

test('disponible solo es false cuando la base dice false', () => {
  // Si el campo no viene, se asume disponible: hacerlo al contrario mostraria
  // media carta agotada por un cambio de forma del JSON.
  const estado = cargarMenu(estadoInicial(), {
    categorias: [
      {
        platos: [
          {
            id_plato: 1,
            nombre: 'Bowl',
            pasos: [
              {
                id_paso: 1,
                nombre: 'Base',
                ingredientes: [
                  { id_ingrediente: 1, nombre: 'Con campo', disponible: false },
                  { id_ingrediente: 2, nombre: 'Sin campo' },
                ],
              },
            ],
          },
        ],
      },
    ],
  })

  assert.equal(buscarIngrediente(estado, 1).disponible, false)
  assert.equal(buscarIngrediente(estado, 2).disponible, true)
})

// ---------------------------------------------------------------------------
// Contar: la insignia del header
// ---------------------------------------------------------------------------

test('cuenta los agotados por id', () => {
  assert.equal(contarAgotados(cargado()), 1)
})

test('el panel recien abierto no cuenta nada', () => {
  assert.equal(contarAgotados(estadoInicial()), 0)
  assert.equal(contarIngredientes(estadoInicial()), 0)
})

test('dos ingredientes con el MISMO nombre cuentan dos, no uno', () => {
  // El caso real del seed. Si se contara por nombre, agotar la Panceta del
  // Bowl haria creer que tambien esta agotada la de la Arepa.
  const estado = cargado()
  const pancetas = ingredientesDe(estado).filter((i) => i.nombre === 'Panceta Crujiente')

  assert.equal(pancetas.length, 2, 'las dos se muestran')
  assert.deepEqual(
    pancetas.map((p) => p.id_ingrediente).sort((a, b) => a - b),
    [7, 30]
  )
  assert.equal(pancetas[0].disponible, false)
  assert.equal(pancetas[1].disponible, true, 'agotar una NO agota la otra')
})

test('agotar las dos del mismo nombre cuenta dos', () => {
  let estado = cargado()
  estado = confirmarCambio(estado, 30, false)
  assert.equal(contarAgotados(estado), 2)
})

test('el mismo id repetido en dos pasos cuenta una sola vez', () => {
  // No deberia pasar, pero la carta la arma la base: mas vale que el numero de
  // la insignia no se infle.
  const estado = cargarMenu(
    estadoInicial(),
    menu({
      nombre: 'Bowl',
      pasos: [
        { id_paso: 1, nombre: 'A', ingredientes: [{ id: 5, nombre: 'Arroz', disponible: false }] },
        { id_paso: 2, nombre: 'B', ingredientes: [{ id: 5, nombre: 'Arroz', disponible: false }] },
      ],
    })
  )

  assert.equal(contarAgotados(estado), 1)
  assert.equal(contarIngredientes(estado), 1)
})

// ---------------------------------------------------------------------------
// Buscar y filtrar
// ---------------------------------------------------------------------------

test('normaliza sin acentos ni mayusculas', () => {
  assert.equal(normalizar('Arepa de Maíz'), 'arepa de maiz')
  assert.equal(normalizar('  JALAPEÑO  '), 'jalapeno')
  assert.equal(normalizar(null), '')
  assert.equal(normalizar(undefined), '')
})

test('busca por subcadena, sin importar acentos ni mayusculas', () => {
  const estado = cargado()

  for (const aguja of ['maiz', 'MAÍZ', 'Maiz', 'arepa de ma']) {
    const grupos = filtrar(estado, { texto: aguja })
    const nombres = grupos.flatMap((g) => g.pasos.flatMap((p) => p.ingredientes.map((i) => i.nombre)))
    assert.deepEqual(nombres, ['Arepa de Maíz'], `"${aguja}" debe encontrarlo`)
  }
})

test('la busqueda conserva el agrupado y tira los grupos vacios', () => {
  const grupos = filtrar(cargado(), { texto: 'panceta' })

  // Las dos pancetas estan en platos distintos: salen los dos grupos, cada uno
  // con solo el paso que la tiene.
  assert.equal(grupos.length, 2)
  assert.deepEqual(grupos[0].pasos.map((p) => p.paso), ['Extras'])
  assert.deepEqual(grupos[1].pasos.map((p) => p.paso), ['Tipo de Arepa'])
})

test('sin texto devuelve todo', () => {
  assert.equal(filtrar(cargado(), { texto: '' }).length, 2)
  assert.equal(filtrar(cargado()).length, 2)
})

test('solo agotados deja unicamente los apagados', () => {
  const grupos = filtrar(cargado(), { soloAgotados: true })
  const ids = grupos.flatMap((g) => g.pasos.flatMap((p) => p.ingredientes.map((i) => i.id_ingrediente)))

  assert.deepEqual(ids, [7])
})

test('solo agotados se combina con la busqueda', () => {
  const estado = cargado()

  // Las dos pancetas, pero solo una esta agotada.
  assert.equal(
    filtrar(estado, { texto: 'panceta', soloAgotados: true })
      .flatMap((g) => g.pasos.flatMap((p) => p.ingredientes)).length,
    1
  )
  // Y el arroz no esta agotado: no sale.
  assert.deepEqual(filtrar(estado, { texto: 'arroz', soloAgotados: true }), [])
})

// ---------------------------------------------------------------------------
// Por que la lista esta vacia: no es lo mismo "no hay" que "no coincide"
// ---------------------------------------------------------------------------

test('distingue una carta sin ingredientes de una busqueda sin resultados', () => {
  assert.equal(motivoListaVacia(estadoInicial()), 'vacio')
  assert.equal(motivoListaVacia(cargado(), { texto: 'zzzz' }), 'sin-resultados')
  assert.equal(motivoListaVacia(cargado()), null)
})

test('si no hay nada agotado, el filtro lo dice con su propia frase', () => {
  let estado = cargado()
  estado = confirmarCambio(estado, 7, true) // repuesta: ya no hay agotados

  assert.equal(motivoListaVacia(estado, { soloAgotados: true }), 'sin-agotados')
})

test('con filtro y texto a la vez, el motivo es sin-resultados', () => {
  // Hay agotados, pero ninguno coincide con el texto: lo que falla es la
  // busqueda, no el filtro.
  assert.equal(
    motivoListaVacia(cargado(), { texto: 'arroz', soloAgotados: true }),
    'sin-resultados'
  )
})

// ---------------------------------------------------------------------------
// Cambio optimista, confirmacion y reversion
// ---------------------------------------------------------------------------

test('el interruptor se mueve antes del PATCH', () => {
  const estado = marcarEnVuelo(cargado(), 1, false)

  assert.equal(buscarIngrediente(estado, 1).disponible, false)
  assert.equal(hayCambioEnVuelo(estado, 1), true)
})

test('en vuelo no toca a los demas ingredientes', () => {
  const estado = marcarEnVuelo(cargado(), 1, false)

  assert.equal(buscarIngrediente(estado, 29).disponible, true)
  assert.equal(hayCambioEnVuelo(estado, 29), false)
})

test('confirmar fija el valor que dijo el servidor, no el que se pidio', () => {
  // Si el servidor contesta otra cosa, manda el servidor.
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = confirmarCambio(estado, 1, true)

  assert.equal(buscarIngrediente(estado, 1).disponible, true)
  assert.equal(hayCambioEnVuelo(estado, 1), false)
})

test('revertir devuelve el valor de antes y deja el mensaje en la fila', () => {
  let estado = cargado()
  assert.equal(buscarIngrediente(estado, 1).disponible, true)

  estado = marcarEnVuelo(estado, 1, false)
  estado = revertirCambio(estado, 1, 'No se pudo cambiar la disponibilidad')

  assert.equal(buscarIngrediente(estado, 1).disponible, true, 'vuelve a disponible')
  assert.equal(hayCambioEnVuelo(estado, 1), false)
  assert.equal(estado.errores['1'], 'No se pudo cambiar la disponibilidad')
})

test('revertir sin mensaje deja uno por defecto', () => {
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = revertirCambio(estado, 1, null)
  assert.match(estado.errores['1'], /No se pudo cambiar/)
})

test('el error es de SU fila, no de las demas', () => {
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = revertirCambio(estado, 1, 'fallo')

  assert.equal(estado.errores['29'], undefined)
})

test('volver a tocar limpia el error viejo de esa fila', () => {
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = revertirCambio(estado, 1, 'fallo')
  estado = marcarEnVuelo(estado, 1, false)

  assert.equal(estado.errores['1'], undefined, 'el error viejo ya no describe nada')
})

test('limpiarError quita solo el de ese ingrediente', () => {
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = revertirCambio(estado, 1, 'fallo uno')
  estado = marcarEnVuelo(estado, 29, false)
  estado = revertirCambio(estado, 29, 'fallo dos')

  estado = limpiarError(estado, 1)
  assert.equal(estado.errores['1'], undefined)
  assert.equal(estado.errores['29'], 'fallo dos')
})

test('dos cambios seguidos sobre el mismo ingrediente no pierden el valor original', () => {
  // Apagar, encender y que todo falle tiene que volver al valor REAL de
  // partida, no al intermedio.
  let estado = cargado()
  estado = marcarEnVuelo(estado, 1, false)
  estado = marcarEnVuelo(estado, 1, true)
  estado = revertirCambio(estado, 1, 'fallo')

  assert.equal(buscarIngrediente(estado, 1).disponible, true, 'el original era true')
})

test('conmutar un id que no existe no cambia nada', () => {
  const estado = cargado()
  assert.deepEqual(marcarEnVuelo(estado, 123456, false), estado)
})

test('recargar la carta descarta los errores por fila', () => {
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = revertirCambio(estado, 1, 'fallo')
  estado = cargarMenu(estado, MENU_NOMBRES_REPETIDOS)

  assert.deepEqual(estado.errores, {}, 'la lista que llega es la verdad')
})

// ---------------------------------------------------------------------------
// El evento del socket (EVENTS.md §5.3)
// ---------------------------------------------------------------------------

const evento = (id, disponible) => ({
  id_ingrediente: id,
  disponible,
  emitidoEn: '2026-10-15T01:13:05.951Z',
})

test('el evento de otra pantalla se aplica', () => {
  const estado = aplicarEvento(cargado(), evento(1, false))
  assert.equal(buscarIngrediente(estado, 1).disponible, false)
})

test('el evento solo toca al ingrediente de su id', () => {
  const estado = aplicarEvento(cargado(), evento(1, false))
  assert.equal(buscarIngrediente(estado, 29).disponible, true)
  assert.equal(buscarIngrediente(estado, 30).disponible, true)
})

test('un evento de la Panceta del Bowl no toca la de la Arepa', () => {
  // El caso que justifica todo el trabajo por id: mismo nombre, otro plato.
  const estado = aplicarEvento(cargado(), evento(30, false))

  assert.equal(buscarIngrediente(estado, 30).disponible, false)
  assert.equal(buscarIngrediente(estado, 7).disponible, false, 'esta ya lo estaba')
  assert.equal(contarAgotados(estado), 2)
})

test('un id que no esta en la carta se ignora sin ruido', () => {
  // Puede ser de un plato no disponible, que GET /menu no devuelve.
  const estado = cargado()
  assert.deepEqual(aplicarEvento(estado, evento(987654, false)), estado)
})

test('un evento mal formado se ignora', () => {
  const estado = cargado()
  for (const basura of [
    undefined,
    null,
    {},
    { id_ingrediente: 1 },
    { id_ingrediente: 1, disponible: 'false' },
    { id_ingrediente: 1, disponible: 0 },
    { id_ingrediente: 'uno', disponible: false },
  ]) {
    assert.deepEqual(aplicarEvento(estado, basura), estado, JSON.stringify(basura))
  }
})

// ---------------------------------------------------------------------------
// Sin parpadeo: el eco de mi propio cambio
// ---------------------------------------------------------------------------

test('el eco de mi propio cambio NO repinta nada', () => {
  // Esto es el parpadeo que se quiere evitar: mi PATCH esta en vuelo, la
  // pantalla ya muestra false, y llega mi propio evento diciendo false.
  const enVuelo = marcarEnVuelo(cargado(), 1, false)
  const tras = aplicarEvento(enVuelo, evento(1, false))

  assert.equal(tras, enVuelo, 'ni un objeto nuevo: no hay re-render')
  assert.equal(hayCambioEnVuelo(tras, 1), true, 'sigue en vuelo hasta que responda el PATCH')
})

test('si el evento dice lo CONTRARIO que pedi, gana el evento', () => {
  // Otra pantalla escribio despues que yo.
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = aplicarEvento(estado, evento(1, true))

  assert.equal(buscarIngrediente(estado, 1).disponible, true)
  assert.equal(hayCambioEnVuelo(estado, 1), false, 'deja de estar en vuelo')
})

test('tras el eco, confirmar el PATCH deja el valor del servidor', () => {
  let estado = marcarEnVuelo(cargado(), 1, false)
  estado = aplicarEvento(estado, evento(1, false)) // eco, no cambia nada
  estado = confirmarCambio(estado, 1, false)

  assert.equal(buscarIngrediente(estado, 1).disponible, false)
  assert.equal(hayCambioEnVuelo(estado, 1), false)
})

test('un evento sin cambio en vuelo se aplica aunque repita el valor actual', () => {
  // Reenvio del mismo aviso: es idempotente y no debe romper nada.
  const estado = cargado()
  const tras = aplicarEvento(estado, evento(7, false))
  assert.equal(buscarIngrediente(tras, 7).disponible, false)
})

// ---------------------------------------------------------------------------
// Avisos del panel
// ---------------------------------------------------------------------------

test('cargando solo mientras no hay nada que mostrar', () => {
  assert.equal(avisoDelPanel(marcarCargando(estadoInicial())), 'cargando')
  // Con la lista ya en pantalla, una recarga no la tapa con un esqueleto.
  assert.equal(avisoDelPanel(marcarCargando(cargado())), null)
})

test('un 403 se distingue de un fallo de red', () => {
  const prohibido = marcarError(estadoInicial(), 'No tienes permisos', 403)
  assert.equal(avisoDelPanel(prohibido), 'prohibido')

  const caido = marcarError(estadoInicial(), 'Failed to fetch', null)
  assert.equal(avisoDelPanel(caido), 'error')
})

test('sin error y con datos, no hay aviso', () => {
  assert.equal(avisoDelPanel(cargado()), null)
})

test('un fallo al recargar NO borra la lista que ya se veia', () => {
  // Mas vale una lista vieja con un aviso que un panel en blanco.
  const estado = marcarError(cargado(), 'Failed to fetch')

  assert.equal(estado.grupos.length, 2)
  assert.equal(contarAgotados(estado), 1)
})

test('el rotulo nunca depende solo del color', () => {
  assert.equal(rotuloDisponibilidad(true), 'Disponible')
  assert.equal(rotuloDisponibilidad(false), 'Agotado')
})
