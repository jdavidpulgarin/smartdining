import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Socket simulado: se guardan los oyentes para disparar eventos a mano. El
// resto de los hooks (useAuth) son los reales.
const oyentes = {}
vi.mock('../../hooks', async (original) => ({
  ...(await original()),
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))

import { AuthProvider } from '../../context/AuthContext'
import { Inventario } from '../Inventario'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

function sesionComo(rol, id = 1) {
  sessionStorage.setItem('smartdining_token', 'test-token')
  sessionStorage.setItem(
    'smartdining_staff_user',
    JSON.stringify({ id, id_usuario: id, nombre: 'Ana Ríos', email: 'ana@mail.com', rol, role: rol })
  )
}

// Forma real de GET /inventario/insumos (api-spec, D-17 PR 2).
const insumo = (id, nombre, unidad, stock_actual, stock_minimo, activo = true) => ({
  id_insumo: id, nombre, unidad, stock_actual, stock_minimo, activo,
  bajo: stock_actual <= stock_minimo, agotado: stock_actual === 0, actualizado_en: '2026-11-08T12:00:00.000Z',
})

const insumosBase = () => [
  insumo(1, 'Queso cheddar', 'g', 3000, 500),
  insumo(2, 'Arepa de chócolo', 'unidad', 2, 4),
  insumo(3, 'Carne Angus 200 g', 'porcion', 0, 2),
  insumo(4, 'Aceite de trufa', 'ml', 250, 50, false),
]

const personal = [{ id_usuario: 1, nombre: 'Ana Ríos', email: 'ana@mail.com', rol: 'admin', activo: true }]

/** Backend simulado. `escrituras(url, metodo, cuerpo)` decide cada POST/PUT. */
// Forma real de GET /inventario/carta (api-spec, D-17 PR 3), ya en el orden del
// servidor: platos por categoría y nombre; opciones por plato, paso y nombre.
const cartaBase = () => ({
  platos: [
    { id: 1003, nombre: 'Arepa Rellena', categoria: 'Arma tu plato', personalizable: true, disponible: true, stock_suficiente: true, disponible_efectivo: true, motivo: null, tiene_receta: false },
    { id: 7, nombre: 'Hamburguesa Smart Angus', categoria: 'Hamburguesas & Fuertes', personalizable: false, disponible: true, stock_suficiente: false, disponible_efectivo: false, motivo: 'stock', tiene_receta: true },
    { id: 8, nombre: 'Costillas BBQ St. Louis', categoria: 'Hamburguesas & Fuertes', personalizable: false, disponible: true, stock_suficiente: true, disponible_efectivo: true, motivo: null, tiene_receta: false },
  ],
  ingredientes: [
    { id: 31, nombre: 'Arepa de Chócolo', id_plato: 1003, plato: 'Arepa Rellena', id_paso: 301, paso: 'Tipo de Arepa', paso_orden: 1, disponible: true, stock_suficiente: true, disponible_efectivo: true, motivo: null, tiene_receta: true },
    { id: 32, nombre: 'Panceta Crujiente', id_plato: 1003, plato: 'Arepa Rellena', id_paso: 302, paso: 'Elige tu Relleno', paso_orden: 2, disponible: false, stock_suficiente: true, disponible_efectivo: false, motivo: 'manual', tiene_receta: false },
  ],
})

/** Backend simulado. `escrituras(url, metodo, cuerpo)` decide cada POST/PUT. */
function backend({ insumos = insumosBase(), movimientos = [], carta = cartaBase(), recetas = {}, usos = null, escrituras = () => json({}) } = {}) {
  const estado = { insumos }
  const spy = vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    if (metodo !== 'GET') return escrituras(url, metodo, config.body ? JSON.parse(config.body) : undefined, estado)
    if (/\/inventario\/insumos\/\d+\/movimientos/.test(url)) return json({ movimientos })
    if (/\/inventario\/insumos\/\d+\/usos/.test(url)) return usos ? json(usos) : json({ error: 'Error interno del servidor' }, 500)
    if (url.includes('/inventario/carta')) return json(carta)
    const receta = url.match(/\/(platos|ingredientes)\/(\d+)\/receta$/)
    if (receta) return json({ [receta[1] === 'platos' ? 'id_plato' : 'id_ingrediente']: Number(receta[2]), receta: recetas[`${receta[1]}-${receta[2]}`] || [] })
    if (url.includes('/inventario/insumos')) return json({ insumos: estado.insumos })
    if (url.includes('/usuarios')) return json({ usuarios: personal })
    return json({})
  })
  return { spy, estado }
}

function montar() {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/inventario']}>
        <Routes>
          <Route path="/" element={<p>INICIO</p>} />
          <Route path="/inventario" element={<Inventario />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  )
}

const escriturasDe = (spy) =>
  spy.mock.calls
    .filter(([, c = {}]) => (c.method || 'GET') !== 'GET')
    .map(([url, c]) => ({ url, metodo: c.method, cuerpo: c.body ? JSON.parse(c.body) : undefined }))

const lecturasDeLista = (spy) => spy.mock.calls.filter(([url, c = {}]) => (c.method || 'GET') === 'GET' && /\/inventario\/insumos\?/.test(url)).length

const filaDe = (id) => screen.getByTestId(`insumo-${id}`)

describe('P-22 · Inventario (pestaña Insumos)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    for (const k of Object.keys(oyentes)) delete oyentes[k]
  })

  it('solo admin: un mesero vuelve al inicio', async () => {
    sesionComo('mesero')
    backend()
    montar()
    expect(await screen.findByText('INICIO')).toBeInTheDocument()
  })

  it('lista los insumos reales: resumen, agotados primero, inactivos ocultos y etiquetas de estado', async () => {
    sesionComo('admin')
    backend()
    montar()

    await screen.findByTestId('insumo-1')
    expect(screen.getByTestId('resumen-inventario')).toHaveTextContent('2 bajo el mínimo · 1 agotado')
    const filas = screen.getAllByTestId(/^insumo-/).map((f) => f.dataset.testid)
    expect(filas).toEqual(['insumo-3', 'insumo-2', 'insumo-1'])
    expect(within(filaDe(3)).getByText('AGOTADO')).toBeInTheDocument()
    expect(within(filaDe(2)).getByText('BAJO')).toBeInTheDocument()
    expect(within(filaDe(1)).getByText('3.000 g')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Inactivos' }))
    expect(screen.getAllByTestId(/^insumo-/).map((f) => f.dataset.testid)).toEqual(['insumo-4'])
    fireEvent.click(screen.getByRole('button', { name: 'Bajo el mínimo' }))
    fireEvent.change(screen.getByLabelText('Buscar insumo'), { target: { value: 'chocolo' } })
    expect(screen.getAllByTestId(/^insumo-/).map((f) => f.dataset.testid)).toEqual(['insumo-2'])
  })

  it('alta: manda el stock inicial y avisa si el nombre ya existe (409 nombre_en_uso)', async () => {
    sesionComo('admin')
    let intento = 0
    const { spy } = backend({
      escrituras: (url, metodo, cuerpo) => {
        intento += 1
        if (intento === 1) return json({ error: 'Ya hay un insumo con ese nombre', motivo: 'nombre_en_uso' }, 409)
        return json({ insumo: { ...insumo(9, cuerpo.nombre, cuerpo.unidad, cuerpo.stock_inicial, cuerpo.stock_minimo) }, movimiento: { id: 1 } }, 201)
      },
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /NUEVO INSUMO/ }))
    const form = screen.getByRole('form', { name: 'Nuevo insumo' })
    fireEvent.change(within(form).getByLabelText('NOMBRE'), { target: { value: 'Queso cheddar' } })
    fireEvent.change(within(form).getByLabelText('UNIDAD'), { target: { value: 'g' } })
    fireEvent.change(within(form).getByLabelText('STOCK MÍNIMO'), { target: { value: '500' } })
    fireEvent.change(within(form).getByLabelText('STOCK INICIAL (OPCIONAL)'), { target: { value: '2000' } })
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('No se guardó: Ya hay un insumo con ese nombre')
    fireEvent.change(within(form).getByLabelText('NOMBRE'), { target: { value: 'Queso costeño' } })
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Queso costeño quedó registrado.')
    expect(escriturasDe(spy).map((e) => e.cuerpo)).toEqual([
      { nombre: 'Queso cheddar', unidad: 'g', stock_minimo: 500, stock_inicial: 2000 },
      { nombre: 'Queso costeño', unidad: 'g', stock_minimo: 500, stock_inicial: 2000 },
    ])
    expect(escriturasDe(spy)[0]).toMatchObject({ url: expect.stringMatching(/\/inventario\/insumos$/), metodo: 'POST' })
  })

  it('editar: solo lo que cambió, nunca el stock; desactivar nombra lo que se apaga (/usos)', async () => {
    sesionComo('admin')
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { spy } = backend({
      usos: {
        id_insumo: 1,
        nombre: 'Queso cheddar',
        platos: [{ id: 7, nombre: 'Hamburguesa Smart Angus', cantidad: 40 }, { id: 2, nombre: 'Nachos Supremos', cantidad: 60 }],
        ingredientes: [{ id: 40, nombre: 'Queso Rallado', id_plato: 1001, plato: 'Bowl Personalizado', id_paso: 103, paso: 'Añade Toppings', paso_orden: 3, cantidad: 40 }],
      },
      escrituras: (url, metodo, cuerpo) => json({ insumo: { ...insumo(1, 'Queso cheddar', 'g', 3000, 500), ...cuerpo } }),
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Queso cheddar' }))
    const form = screen.getByRole('form', { name: 'Editar insumo' })
    fireEvent.change(within(form).getByLabelText('STOCK MÍNIMO'), { target: { value: '800' } })
    fireEvent.click(within(form).getByLabelText(/Activo/))
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Queso cheddar quedó actualizado.')
    expect(confirmar).toHaveBeenCalledWith(
      '¿Desactivar "Queso cheddar"? Se marcarán como no disponibles hasta que lo vuelvas a activar:\n' +
        '- Hamburguesa Smart Angus\n- Nachos Supremos\n- Bowl Personalizado · Añade Toppings · Queso Rallado'
    )
    expect(escriturasDe(spy)).toEqual([
      { url: expect.stringMatching(/\/inventario\/insumos\/1$/), metodo: 'PUT', cuerpo: { stock_minimo: 800, activo: false } },
    ])
  })

  it('desactivar: si /usos no responde, confirma con el aviso genérico y no se queda trabado', async () => {
    sesionComo('admin')
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { spy } = backend() // /usos responde 500
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Queso cheddar' }))
    const form = screen.getByRole('form', { name: 'Editar insumo' })
    fireEvent.click(within(form).getByLabelText(/Activo/))
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR' }))

    await waitFor(() => expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/Los platos y opciones que lo usan se marcarán como no disponibles/)))
    // Dijo que no: no se guarda nada.
    expect(escriturasDe(spy)).toEqual([])
  })

  it('entrada: manda tipo y cantidad, muestra en cuánto quedó y recarga la lista', async () => {
    sesionComo('admin')
    const { spy } = backend({
      escrituras: () => json({ movimiento: { id: 44, tipo: 'entrada', cantidad: 6, stock_resultante: 8 }, stock_actual: 8 }, 201),
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Movimiento de Arepa de chócolo' }))
    const form = screen.getByRole('form', { name: 'Registrar movimiento' })
    fireEvent.change(within(form).getByLabelText(/^CANTIDAD/), { target: { value: '6' } })
    expect(within(form).getByRole('status')).toHaveTextContent('Quedará en 8 und.')
    const antes = lecturasDeLista(spy)
    fireEvent.click(within(form).getByRole('button', { name: 'REGISTRAR' }))

    // Texto exacto: termina en "und." y no en "und.." (la unidad corta ya lleva punto).
    expect(await screen.findByText(/^Entrada registrada en Arepa de chócolo: quedó en 8 und\.$/)).toBeInTheDocument()
    expect(escriturasDe(spy)).toEqual([
      { url: expect.stringMatching(/\/inventario\/insumos\/2\/movimientos$/), metodo: 'POST', cuerpo: { tipo: 'entrada', cantidad: 6 } },
    ])
    await waitFor(() => expect(lecturasDeLista(spy)).toBeGreaterThan(antes))
  })

  it('ajuste por conteo: pide "¿Cuánto hay contado?", exige motivo y manda la diferencia con signo', async () => {
    sesionComo('admin')
    const { spy } = backend({ escrituras: () => json({ movimiento: { id: 45 }, stock_actual: 1 }, 201) })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Movimiento de Arepa de chócolo' }))
    const form = screen.getByRole('form', { name: 'Registrar movimiento' })
    fireEvent.click(within(form).getByLabelText('Ajuste por conteo'))
    fireEvent.change(within(form).getByLabelText(/¿CUÁNTO HAY CONTADO\?/), { target: { value: '1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'REGISTRAR' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('El motivo es obligatorio en un ajuste')
    expect(escriturasDe(spy)).toEqual([])

    fireEvent.change(within(form).getByLabelText(/^MOTIVO/), { target: { value: 'Conteo del viernes' } })
    expect(within(form).getByRole('status')).toHaveTextContent('Quedará en 1 und. (ajuste de -1 und.)')
    fireEvent.click(within(form).getByRole('button', { name: 'REGISTRAR' }))

    await screen.findByText(/Ajuste por conteo registrada en Arepa de chócolo/)
    expect(escriturasDe(spy).map((e) => e.cuerpo)).toEqual([{ tipo: 'ajuste', cantidad: -1, motivo: 'Conteo del viernes' }])
  })

  it('si el servidor rechaza la merma por stock (400 movimiento_invalido), lo dice y pone el stock real', async () => {
    sesionComo('admin')
    // Como el servidor real: otro movimiento dejó el queso en 20 g, así que el 400
    // trae ese stock y la recarga posterior también. La fila tiene que decir BAJO
    // (20 g con mínimo 500), no la etiqueta OK de antes.
    backend({
      escrituras: (url, metodo, cuerpo, estado) => {
        estado.insumos = estado.insumos.map((i) => (i.id_insumo === 1 ? insumo(1, 'Queso cheddar', 'g', 20, 500) : i))
        return json({ error: 'El movimiento dejaría "Queso cheddar" en negativo: hay 20.00 g', motivo: 'movimiento_invalido', stock_actual: 20 }, 400)
      },
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Movimiento de Queso cheddar' }))
    const form = screen.getByRole('form', { name: 'Registrar movimiento' })
    fireEvent.click(within(form).getByLabelText('Merma'))
    fireEvent.change(within(form).getByLabelText(/^CANTIDAD/), { target: { value: '50' } })
    fireEvent.change(within(form).getByLabelText(/^MOTIVO/), { target: { value: 'Se venció' } })
    fireEvent.click(within(form).getByRole('button', { name: 'REGISTRAR' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('No se guardó: El movimiento dejaría "Queso cheddar" en negativo')
    expect(within(filaDe(1)).getByText('20 g')).toBeInTheDocument()
    expect(within(filaDe(1)).getByText('BAJO')).toBeInTheDocument()
    expect(within(form).getByText('20 g')).toBeInTheDocument()
  })

  it('historial: todos los tipos, quién lo hizo y la merma en 0 de una cancelación explicada', async () => {
    sesionComo('admin')
    backend({
      movimientos: [
        { id: 3, tipo: 'merma', cantidad: 0, stock_resultante: 1, id_detalle: 702, id_usuario: 1, motivo: 'Cancelado en preparación', creado_en: '2026-11-08T13:00:00.000Z' },
        { id: 2, tipo: 'reserva', cantidad: -1, stock_resultante: 1, id_detalle: 701, id_usuario: null, motivo: 'Pedido 87', creado_en: '2026-11-08T12:30:00.000Z' },
        { id: 1, tipo: 'entrada', cantidad: 2, stock_resultante: 2, id_detalle: null, id_usuario: 1, motivo: 'Carga inicial', creado_en: '2026-11-08T12:00:00.000Z' },
      ],
    })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Historial de Arepa de chócolo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Historial · Arepa de chócolo' })

    await within(dialogo).findByTestId('movimiento-1')
    expect(within(dialogo).getByTestId('movimiento-2')).toHaveTextContent('Reserva (pedido)')
    expect(within(dialogo).getByTestId('movimiento-2')).toHaveTextContent('-1 und.')
    expect(within(dialogo).getByTestId('movimiento-2')).toHaveTextContent('Pedido')
    expect(within(dialogo).getByTestId('movimiento-3')).toHaveTextContent('ya se había descontado en la reserva')
    expect(within(dialogo).getByTestId('movimiento-1')).toHaveTextContent('+2 und.')
    expect(within(dialogo).getByTestId('movimiento-1')).toHaveTextContent('Ana Ríos')
  })

  it('inventario:alerta muestra el aviso, recarga la lista e ignora un eventId repetido', async () => {
    sesionComo('admin')
    const { spy } = backend()
    montar()
    await screen.findByTestId('insumo-1')
    const antes = lecturasDeLista(spy)
    const alerta = { eventId: 'e-1', id_insumo: 2, nombre: 'Arepa de chócolo', unidad: 'unidad', stock_actual: 0, stock_minimo: 4, agotado: true, emitidoEn: '2026-11-08T20:00:00.000Z' }

    act(() => oyentes['inventario:alerta'](alerta))
    act(() => oyentes['inventario:alerta'](alerta))

    const avisos = await screen.findByRole('region', { name: 'Alertas de inventario' })
    expect(within(avisos).getAllByRole('alert')).toHaveLength(1)
    expect(within(avisos).getByText('Arepa de chócolo: AGOTADO')).toBeInTheDocument()
    await waitFor(() => expect(lecturasDeLista(spy)).toBe(antes + 1))

    fireEvent.click(within(avisos).getByRole('button', { name: 'Descartar: Arepa de chócolo: AGOTADO' }))
    expect(screen.queryByRole('region', { name: 'Alertas de inventario' })).toBeNull()
  })

  it('si no carga, dice por qué y deja reintentar, sin datos inventados', async () => {
    sesionComo('admin')
    let intentos = 0
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/usuarios')) return json({ usuarios: personal })
      intentos += 1
      return intentos === 1 ? json({ error: 'Error interno del servidor' }, 500) : json({ insumos: insumosBase() })
    })
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('Error interno del servidor')
    expect(screen.queryByTestId(/^insumo-/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /REINTENTAR/ }))
    expect(await screen.findByTestId('insumo-1')).toBeInTheDocument()
  })
})

describe('P-22 · Inventario (pestaña Recetas)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  async function abrirRecetas() {
    fireEvent.click(await screen.findByRole('tab', { name: 'RECETAS' }))
    return screen.findByTestId('resumen-recetas')
  }

  it('muestra platos por categoría y opciones por plato y paso, con su estado en la carta y su receta', async () => {
    sesionComo('admin')
    backend()
    montar()
    const resumen = await abrirRecetas()

    // Sin receta: Costillas (la Arepa Rellena es personalizable, no cuenta) y la Panceta.
    expect(resumen).toHaveTextContent('Sin receta: 1 plato · 1 opción')
    expect(within(screen.getByTestId('plato-1003')).getByText('CONSUME POR SUS OPCIONES')).toBeInTheDocument()
    expect(within(screen.getByTestId('plato-7')).getByText('SIN STOCK')).toBeInTheDocument()
    expect(within(screen.getByTestId('plato-7')).getByText('CON RECETA')).toBeInTheDocument()
    expect(within(screen.getByTestId('plato-8')).getByText('SIN RECETA')).toBeInTheDocument()
    expect(within(screen.getByTestId('ingrediente-32')).getByText('APAGADO A MANO')).toBeInTheDocument()
    expect(screen.getByTestId('ingrediente-31')).toHaveTextContent('1. Tipo de Arepa · Arepa de Chócolo')

    // "Solo lo que falta": quedan Costillas y la Panceta; la Arepa Rellena no (está bien así).
    fireEvent.click(screen.getByRole('button', { name: 'Solo lo que falta' }))
    expect(screen.getAllByTestId(/^(plato|ingrediente)-/).map((f) => f.dataset.testid)).toEqual(['plato-8', 'ingrediente-32'])

    // Búsqueda sin tildes.
    fireEvent.click(screen.getByRole('button', { name: 'Solo lo que falta' }))
    fireEvent.change(screen.getByLabelText('Buscar en la carta'), { target: { value: 'chocolo' } })
    expect(screen.getAllByTestId(/^(plato|ingrediente)-/).map((f) => f.dataset.testid)).toEqual(['ingrediente-31'])
  })

  it('editar la receta de un plato: carga la actual, agrega un insumo y manda la receta COMPLETA', async () => {
    sesionComo('admin')
    const { spy } = backend({
      recetas: { 'platos-7': [{ id_insumo: 3, nombre: 'Carne Angus 200 g', unidad: 'porcion', cantidad: 1, stock_actual: 0, activo: true }] },
      escrituras: (url, metodo, cuerpo) => json({
        id_plato: 7,
        receta: cuerpo.insumos.map((r) => ({
          ...r,
          nombre: r.id_insumo === 3 ? 'Carne Angus 200 g' : 'Queso cheddar',
          unidad: r.id_insumo === 3 ? 'porcion' : 'g',
          stock_actual: r.id_insumo === 3 ? 0 : 3000,
          activo: true,
        })),
      }),
    })
    montar()
    await abrirRecetas()
    fireEvent.click(screen.getByRole('button', { name: 'Receta de Hamburguesa Smart Angus' }))
    const form = await screen.findByRole('form', { name: 'Editar receta' })
    expect(within(form).getByLabelText('Insumo de la fila 1')).toHaveValue('3')
    expect(within(form).getByLabelText('Cantidad de la fila 1')).toHaveValue('1')

    fireEvent.click(within(form).getByRole('button', { name: /AGREGAR INSUMO/ }))
    fireEvent.change(within(form).getByLabelText('Insumo de la fila 2'), { target: { value: '1' } })
    fireEvent.change(within(form).getByLabelText('Cantidad de la fila 2'), { target: { value: '40' } })
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR RECETA' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Receta de Hamburguesa Smart Angus guardada (2 insumos). Ojo: con el stock actual queda SIN STOCK por Carne Angus 200 g.'
    )
    expect(escriturasDe(spy)).toEqual([
      { url: expect.stringMatching(/\/platos\/7\/receta$/), metodo: 'PUT', cuerpo: { insumos: [{ id_insumo: 3, cantidad: 1 }, { id_insumo: 1, cantidad: 40 }] } },
    ])
  })

  it('valida antes de mandar: cantidad inválida o insumo repetido no llegan al servidor', async () => {
    sesionComo('admin')
    const { spy } = backend()
    montar()
    await abrirRecetas()
    fireEvent.click(screen.getByRole('button', { name: 'Receta de Arepa Rellena · Elige tu Relleno · Panceta Crujiente' }))
    const form = await screen.findByRole('form', { name: 'Editar receta' })
    expect(within(form).getByText(/porción NORMAL/)).toBeInTheDocument()

    fireEvent.click(within(form).getByRole('button', { name: /AGREGAR INSUMO/ }))
    fireEvent.change(within(form).getByLabelText('Insumo de la fila 1'), { target: { value: '1' } })
    fireEvent.change(within(form).getByLabelText('Cantidad de la fila 1'), { target: { value: '0' } })
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR RECETA' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Fila 1 (Queso cheddar): la cantidad es un número mayor que 0')

    fireEvent.change(within(form).getByLabelText('Cantidad de la fila 1'), { target: { value: '30' } })
    fireEvent.click(within(form).getByRole('button', { name: /AGREGAR INSUMO/ }))
    fireEvent.change(within(form).getByLabelText('Insumo de la fila 2'), { target: { value: '1' } })
    fireEvent.change(within(form).getByLabelText('Cantidad de la fila 2'), { target: { value: '10' } })
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR RECETA' }))
    expect(await within(form).findByText('Queso cheddar está dos veces: deja una sola fila por insumo.')).toBeInTheDocument()
    expect(escriturasDe(spy)).toEqual([])
  })

  it('quitar la receta pide confirmación y manda la lista vacía', async () => {
    sesionComo('admin')
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { spy } = backend({
      recetas: { 'ingredientes-31': [{ id_insumo: 2, nombre: 'Arepa de chócolo', unidad: 'unidad', cantidad: 1, stock_actual: 2, activo: true }] },
      escrituras: () => json({ id_ingrediente: 31, receta: [] }),
    })
    montar()
    await abrirRecetas()
    fireEvent.click(screen.getByRole('button', { name: 'Receta de Arepa Rellena · Tipo de Arepa · Arepa de Chócolo' }))
    const form = await screen.findByRole('form', { name: 'Editar receta' })
    fireEvent.click(within(form).getByRole('button', { name: 'Quitar la fila 1' }))
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR RECETA' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Arepa de Chócolo quedó sin receta: ya no controla inventario.')
    expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/Dejará de controlar inventario/))
    expect(escriturasDe(spy)).toEqual([
      { url: expect.stringMatching(/\/ingredientes\/31\/receta$/), metodo: 'PUT', cuerpo: { insumos: [] } },
    ])
  })

  it('un error del servidor al guardar se muestra con su texto (409 insumo_inexistente)', async () => {
    sesionComo('admin')
    backend({ escrituras: () => json({ error: 'Alguno de los insumos de la receta no existe', motivo: 'insumo_inexistente' }, 409) })
    montar()
    await abrirRecetas()
    fireEvent.click(screen.getByRole('button', { name: 'Receta de Costillas BBQ St. Louis' }))
    const form = await screen.findByRole('form', { name: 'Editar receta' })
    fireEvent.click(within(form).getByRole('button', { name: /AGREGAR INSUMO/ }))
    fireEvent.change(within(form).getByLabelText('Insumo de la fila 1'), { target: { value: '1' } })
    fireEvent.change(within(form).getByLabelText('Cantidad de la fila 1'), { target: { value: '200' } })
    fireEvent.click(within(form).getByRole('button', { name: 'GUARDAR RECETA' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('No se guardó: Alguno de los insumos de la receta no existe')
  })
})
