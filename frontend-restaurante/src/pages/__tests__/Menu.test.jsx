import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Menu } from '../Menu'
import { AuthContext } from '../../context/authContextDef'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

/**
 * Backend simulado por URL. El panel arma la carta de administración con
 * GET /categorias y GET /platos (no con GET /menu, que oculta los agotados).
 * `escrituras` decide qué pasa con cualquier PATCH/PUT/POST/DELETE.
 */
function simularBackend({ categorias, platos, pasos = [], escrituras }) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    if (metodo !== 'GET') return escrituras(url, config)
    if (url.includes('/pasos')) return json(pasos)
    if (url.includes('/categorias')) return json({ categorias })
    if (url.includes('/platos')) return json({ platos })
    return json({})
  })
}

const sinConexion = () => {
  throw new TypeError('Failed to fetch')
}

const categoriasBase = [
  { id_categoria: 1, nombre: 'Hamburguesas', descripcion: 'Artesanales a la parrilla' },
  { id_categoria: 2, nombre: 'Bebidas', descripcion: 'Refrescantes' },
]

const platosBase = [
  {
    id_plato: 101,
    id_categoria: 1,
    nombre: 'Hamburguesa Doble Queso',
    precio: 28000,
    descripcion: 'Carne angus con doble cheddar',
    tiempo_preparacion_estimado: 15,
    disponible: true,
  },
  {
    id_plato: 201,
    id_categoria: 2,
    nombre: 'Limonada de Coco',
    precio: 12000,
    descripcion: 'Leche de coco y limón fresco',
    tiempo_preparacion_estimado: 5,
    disponible: false,
  },
]

// Por defecto, admin: la gestión del Menú es suya. Con otro rol, solo consulta.
function montar(rol = 'admin') {
  render(
    <AuthContext.Provider value={{ user: { id_usuario: 1, nombre: 'Prueba', rol } }}>
      <MemoryRouter>
        <Menu />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

function tarjetaDe(nombre) {
  // Sube desde el nombre hasta la tarjeta que tiene el interruptor.
  let nodo = screen.getByText(nombre)
  while (nodo && !within(nodo).queryByTitle('Alternar disponibilidad para comensales')) {
    nodo = nodo.parentElement
  }
  return nodo
}

describe('Flujo de Menú en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('lista categorías y TODOS los platos, también los agotados', async () => {
    simularBackend({ categorias: categoriasBase, platos: platosBase, escrituras: () => json({}) })
    montar()

    await waitFor(() => {
      expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument()
      // Agotado: con GET /menu no aparecería y no habría cómo reponerlo.
      expect(screen.getByText('Limonada de Coco')).toBeInTheDocument()
    })
    expect(screen.getByText('$28.000')).toBeInTheDocument()
    expect(within(tarjetaDe('Limonada de Coco')).getByText('AGOTADO')).toBeInTheDocument()
  })

  it('filtra los platos al buscar por nombre', async () => {
    simularBackend({
      categorias: [{ id_categoria: 1, nombre: 'Hamburguesas' }],
      platos: [
        { id_plato: 101, id_categoria: 1, nombre: 'Burger Clásica', precio: 22000, disponible: true },
        { id_plato: 102, id_categoria: 1, nombre: 'Costillas BBQ', precio: 38000, disponible: true },
      ],
      escrituras: () => json({}),
    })
    montar()

    await waitFor(() => expect(screen.getByText('Costillas BBQ')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/buscar plato por nombre/i), { target: { value: 'Costillas' } })

    expect(screen.getByText('Costillas BBQ')).toBeInTheDocument()
    expect(screen.queryByText('Burger Clásica')).not.toBeInTheDocument()
  })

  it('muestra el badge de Arma tu plato y abre el EditorPasos', async () => {
    simularBackend({
      categorias: [{ id_categoria: 100, nombre: 'Arma tu plato' }],
      platos: [
        { id_plato: 1001, id_categoria: 100, nombre: 'Bowl Personalizado', precio: 20000, disponible: true, personalizable: true, calorias: 450 },
      ],
      pasos: [{ id_paso: 1, nombre: 'Elige tu Base', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true, ingredientes: [] }],
      escrituras: () => json({}),
    })
    montar()

    await waitFor(() => expect(screen.getByText('Bowl Personalizado')).toBeInTheDocument())
    expect(screen.getAllByText(/Arma tu plato/i).length).toBeGreaterThanOrEqual(1)

    fireEvent.click(screen.getByTitle('Configurar Pasos e Ingredientes del Constructor'))
    await waitFor(() => {
      expect(screen.getByText('Constructor de Plato')).toBeInTheDocument()
    })
  })

  describe('P-13: con el backend apagado nada queda en pantalla como guardado', () => {
    it('agotar sin conexión revierte el interruptor y dice "Sin conexión, no se guardó"', async () => {
      simularBackend({ categorias: categoriasBase, platos: platosBase, escrituras: sinConexion })
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

      fireEvent.click(within(tarjetaDe('Hamburguesa Doble Queso')).getByTitle('Alternar disponibilidad para comensales'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión, no se guardó')
      expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('DISPONIBLE')).toBeInTheDocument()
      expect(screen.queryByText(/pendiente en backend/i)).not.toBeInTheDocument()
    })

    it('si el servidor rechaza el cambio, revierte y muestra su error real', async () => {
      simularBackend({
        categorias: categoriasBase,
        platos: platosBase,
        escrituras: () => json({ error: 'No tienes permiso para esta acción' }, 403),
      })
      montar()
      await waitFor(() => expect(screen.getByText('Limonada de Coco')).toBeInTheDocument())

      fireEvent.click(within(tarjetaDe('Limonada de Coco')).getByTitle('Alternar disponibilidad para comensales'))

      expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó: No tienes permiso para esta acción')
      expect(within(tarjetaDe('Limonada de Coco')).getByText('AGOTADO')).toBeInTheDocument()
    })

    it('agotar con el backend arriba deja el estado que devuelve el servidor', async () => {
      simularBackend({
        categorias: categoriasBase,
        platos: platosBase,
        escrituras: () => json({ id_plato: 101, disponible: false }),
      })
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

      fireEvent.click(within(tarjetaDe('Hamburguesa Doble Queso')).getByTitle('Alternar disponibilidad para comensales'))

      await waitFor(() =>
        expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('AGOTADO')).toBeInTheDocument()
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('crear un plato sin conexión no lo agrega a la lista y deja el formulario abierto', async () => {
      simularBackend({ categorias: categoriasBase, platos: platosBase, escrituras: sinConexion })
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

      fireEvent.click(screen.getByText('NUEVO PLATO'))
      fireEvent.change(screen.getByPlaceholderText(/Ej. Bowl Personalizado/i), { target: { value: 'Plato Fantasma' } })
      fireEvent.change(screen.getByPlaceholderText('25000'), { target: { value: '15000' } })
      fireEvent.click(screen.getByText('CREAR PLATO'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión, no se guardó')
      // Sigue en el formulario con lo escrito, y no hay tarjeta inventada:
      // siguen siendo las 2 tarjetas que trajo el servidor.
      expect(screen.getByDisplayValue('Plato Fantasma')).toBeInTheDocument()
      expect(screen.getAllByTitle('Alternar disponibilidad para comensales')).toHaveLength(2)
    })

    it('borrar un plato sin conexión lo deja en la lista', async () => {
      simularBackend({ categorias: categoriasBase, platos: platosBase, escrituras: sinConexion })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

      fireEvent.click(within(tarjetaDe('Hamburguesa Doble Queso')).getByTitle('Eliminar plato'))

      expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión, no se guardó')
      expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument()
    })
  })
describe('agotado por stock al cargar (stock_suficiente de GET /platos)', () => {
    const platosStock = [
      { id_plato: 301, id_categoria: 1, nombre: 'Hamburguesa Smart Angus', precio: 34000, disponible: true, stock_suficiente: false },
      { id_plato: 302, id_categoria: 1, nombre: 'Burger Apagada', precio: 20000, disponible: false, stock_suficiente: false },
      { id_plato: 303, id_categoria: 1, nombre: 'Burger Normal', precio: 22000, disponible: true, stock_suficiente: true },
      // Una respuesta sin el campo (backend anterior al 27) se trata como con stock.
      { id_plato: 304, id_categoria: 1, nombre: 'Burger Vieja', precio: 21000, disponible: true },
    ]

    it('encendido a mano pero sin stock sale "AGOTADO · SIN STOCK"; apagado a mano, "AGOTADO"', async () => {
      simularBackend({ categorias: categoriasBase, platos: platosStock, escrituras: () => json({}) })
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Smart Angus')).toBeInTheDocument())

      expect(within(tarjetaDe('Hamburguesa Smart Angus')).getByText('AGOTADO · SIN STOCK')).toBeInTheDocument()
      expect(within(tarjetaDe('Burger Apagada')).getByText('AGOTADO')).toBeInTheDocument()
      expect(within(tarjetaDe('Burger Apagada')).queryByText('AGOTADO · SIN STOCK')).not.toBeInTheDocument()
      expect(within(tarjetaDe('Burger Normal')).getByText('DISPONIBLE')).toBeInTheDocument()
      expect(within(tarjetaDe('Burger Vieja')).getByText('DISPONIBLE')).toBeInTheDocument()
    })

    it('"Solo disponibles" esconde también los agotados por stock', async () => {
      simularBackend({ categorias: categoriasBase, platos: platosStock, escrituras: () => json({}) })
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Smart Angus')).toBeInTheDocument())

      fireEvent.click(screen.getByLabelText('SOLO DISPONIBLES'))
      expect(screen.queryByText('Hamburguesa Smart Angus')).not.toBeInTheDocument()
      expect(screen.queryByText('Burger Apagada')).not.toBeInTheDocument()
      expect(screen.getByText('Burger Normal')).toBeInTheDocument()
    })

    it('el botón sigue siendo el interruptor MANUAL: en un plato sin stock, el clic lo apaga a mano', async () => {
      const spy = simularBackend({
        categorias: categoriasBase,
        platos: platosStock,
        escrituras: () => json({ id_plato: 301, disponible: false, stock_suficiente: false }),
      })
      montar()
      await waitFor(() => expect(screen.getByText('Hamburguesa Smart Angus')).toBeInTheDocument())

      fireEvent.click(within(tarjetaDe('Hamburguesa Smart Angus')).getByTitle('Alternar disponibilidad para comensales'))

      await waitFor(() =>
        expect(within(tarjetaDe('Hamburguesa Smart Angus')).queryByText('AGOTADO · SIN STOCK')).not.toBeInTheDocument()
      )
      expect(within(tarjetaDe('Hamburguesa Smart Angus')).getByText('AGOTADO')).toBeInTheDocument()
      const patch = spy.mock.calls.find(([, c]) => c?.method === 'PATCH')
      expect(patch[0]).toMatch(/\/platos\/301\/disponible$/)
      expect(JSON.parse(patch[1].body)).toEqual({ disponible: false })
    })
  })
})

describe('Menú de solo consulta para mesero y cajero (el backend les niega la gestión)', () => {
  beforeEach(() => vi.restoreAllMocks())

  it.each(['mesero', 'cajero'])('%s: sin NUEVO PLATO, CATEGORÍAS, pasos, editar ni eliminar; la disponibilidad es solo una etiqueta', async (rol) => {
    simularBackend({ categorias: categoriasBase, platos: platosBase, escrituras: () => { throw new Error('no debería escribir') } })
    montar(rol)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())
    expect(screen.queryByText('NUEVO PLATO')).toBeNull()
    expect(screen.queryByText(/^CATEGORÍAS/)).toBeNull()
    expect(screen.queryByTitle('Editar plato')).toBeNull()
    expect(screen.queryByTitle('Eliminar plato')).toBeNull()
    expect(screen.queryByTitle('Configurar Pasos e Ingredientes del Constructor')).toBeNull()
    expect(screen.queryByTitle('Alternar disponibilidad para comensales')).toBeNull()
    const estado = screen.getByTestId('disponibilidad-101')
    expect(estado.tagName).toBe('SPAN')
    expect(estado).toHaveTextContent('DISPONIBLE')
    expect(screen.getByTestId('disponibilidad-201')).toHaveTextContent('AGOTADO')
    expect(screen.getByText(/solo consulta/)).toBeInTheDocument()
  })

  it('admin sí ve la gestión completa y el interruptor', async () => {
    simularBackend({ categorias: categoriasBase, platos: platosBase, escrituras: () => json({}) })
    montar('admin')
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())
    expect(screen.getByText('NUEVO PLATO')).toBeInTheDocument()
    expect(screen.getAllByTitle('Editar plato')).toHaveLength(2)
    expect(screen.getAllByTitle('Alternar disponibilidad para comensales')[0].tagName).toBe('BUTTON')
  })
})
