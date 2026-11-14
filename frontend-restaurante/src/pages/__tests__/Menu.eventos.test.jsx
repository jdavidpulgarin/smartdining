import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Socket simulado: guarda los oyentes para disparar eventos a mano.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))

import { Menu } from '../Menu'
import { AuthContext } from '../../context/authContextDef'

// La gestión del Menú es de admin (el mesero y el cajero lo ven de solo consulta).
const ADMIN = { user: { id_usuario: 1, nombre: 'Ana Admin', rol: 'admin' } }
import { EditorPasos } from '../../components/admin/EditorPasos'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

const categorias = [{ id_categoria: 1, nombre: 'Hamburguesas', descripcion: '' }]
const platos = [
  { id_plato: 101, id_categoria: 1, nombre: 'Hamburguesa Doble Queso', precio: 28000, descripcion: '', disponible: true },
]
const pasos = [
  {
    id_paso: 1, nombre: 'Proteína', orden: 1, obligatorio: true,
    ingredientes: [{ id_ingrediente: 31, nombre: 'Pollo a la Plancha', precio_extra: 0, disponible: true }],
  },
]

function tarjetaDe(nombre) {
  let nodo = screen.getByText(nombre)
  while (nodo && !within(nodo).queryByTitle('Alternar disponibilidad para comensales')) {
    nodo = nodo.parentElement
  }
  return nodo
}

const t = (s) => `2026-11-08T18:00:0${s}Z`

describe('P-14: disponibilidad en vivo, sin recargar', () => {
  let fetchSpy
  let enBase

  beforeEach(() => {
    enBase = { disponible: true, stock_suficiente: true }
    vi.restoreAllMocks()
    for (const e of Object.keys(oyentes)) delete oyentes[e]
    sessionStorage.setItem('smartdining_token', 'test-token')
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/pasos')) return json(pasos)
      if (url.includes('/categorias')) return json({ categorias })
      if (/\/platos\/101$/.test(url)) return json({ ...platos[0], ...enBase })
      if (url.includes('/platos')) return json({ platos })
      return json({})
    })
  })

  // La relectura GET /platos/101 devuelve lo que diga `enBase` en ese momento.
  const ponerEnBase = (campos) => Object.assign(enBase, campos)

  it('Menú: plato:disponibilidad relee SOLO ese plato (no la carta) y aplica lo que dice la base', async () => {
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())
    const llamadas = fetchSpy.mock.calls.length

    ponerEnBase({ disponible: true, stock_suficiente: false })
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(1) }))
    expect(await within(tarjetaDe('Hamburguesa Doble Queso')).findByText('AGOTADO · SIN STOCK')).toBeInTheDocument()

    ponerEnBase({ disponible: true, stock_suficiente: true })
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(2) }))
    expect(await within(tarjetaDe('Hamburguesa Doble Queso')).findByText('DISPONIBLE')).toBeInTheDocument()

    const nuevas = fetchSpy.mock.calls.slice(llamadas).map(([url]) => url)
    expect(nuevas).toHaveLength(2)
    expect(nuevas.every((u) => /\/platos\/101$/.test(u))).toBe(true)
  })

  it('Menú: un aviso de apagado MANUAL se muestra como AGOTADO, no como sin stock', async () => {
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

    ponerEnBase({ disponible: false, stock_suficiente: true })
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(1) }))
    const tarjeta = tarjetaDe('Hamburguesa Doble Queso')
    await waitFor(() => expect(within(tarjeta).getByText('AGOTADO')).toBeInTheDocument())
    expect(within(tarjeta).queryByText('AGOTADO · SIN STOCK')).not.toBeInTheDocument()
  })

  it('Menú: si la cocina enciende a mano un plato sin stock, el panel no se cree el "true" del aviso', async () => {
    // El PATCH manual avisa con el interruptor (true) aunque no haya stock: la
    // relectura dice la verdad.
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

    ponerEnBase({ disponible: true, stock_suficiente: false })
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(1) }))
    expect(await within(tarjetaDe('Hamburguesa Doble Queso')).findByText('AGOTADO · SIN STOCK')).toBeInTheDocument()
  })

  it('Menú: de dos relecturas del mismo plato vale la última que se pidió, aunque llegue primero', async () => {
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

    let soltarPrimera
    const respuestas = [
      new Promise((r) => { soltarPrimera = () => r(json({ ...platos[0], disponible: true, stock_suficiente: false })) }),
      Promise.resolve(json({ ...platos[0], disponible: true, stock_suficiente: true })),
    ]
    fetchSpy.mockImplementation(async (url) => (/\/platos\/101$/.test(url) ? respuestas.shift() : json({})))

    // Sin await: la primera relectura queda colgada hasta soltarPrimera().
    let primera
    act(() => { primera = oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(1) }) })
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(2) }))
    await act(async () => {
      soltarPrimera()
      await primera
    })

    expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('DISPONIBLE')).toBeInTheDocument()
  })

  it('Menú: sin poder releer, un false con el interruptor encendido se muestra como sin stock', async () => {
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())
    fetchSpy.mockImplementation(async () => { throw new TypeError('Failed to fetch') })

    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(1) }))
    expect(await within(tarjetaDe('Hamburguesa Doble Queso')).findByText('AGOTADO · SIN STOCK')).toBeInTheDocument()

    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(2) }))
    expect(await within(tarjetaDe('Hamburguesa Doble Queso')).findByText('DISPONIBLE')).toBeInTheDocument()
  })

  it('Menú: un aviso más viejo que el último aplicado se descarta (ni siquiera se relee)', async () => {
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

    ponerEnBase({ disponible: false, stock_suficiente: true })
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(5) }))
    const llamadas = fetchSpy.mock.calls.length
    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(3) }))

    expect(fetchSpy.mock.calls.length).toBe(llamadas)
    expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('AGOTADO')).toBeInTheDocument()
  })

  it('Menú: ignora un aviso mal formado', async () => {
    render(<AuthContext.Provider value={ADMIN}><MemoryRouter><Menu /></MemoryRouter></AuthContext.Provider>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())
    const llamadas = fetchSpy.mock.calls.length

    await act(async () => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: 'no' }))
    await act(async () => oyentes['plato:disponibilidad'](null))

    expect(fetchSpy.mock.calls.length).toBe(llamadas)
    expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('DISPONIBLE')).toBeInTheDocument()
  })

  it('EditorPasos: ingrediente:disponibilidad marca el ingrediente agotado en vivo', async () => {
    render(<EditorPasos dish={{ id: 101, name: 'Hamburguesa Doble Queso' }} onClose={() => {}} onDishUpdated={() => {}} />)
    expect(await screen.findByText('Pollo a la Plancha')).toBeInTheDocument()
    expect(screen.getByTitle('Disponible (clic para agotar)')).toBeInTheDocument()

    act(() => oyentes['ingrediente:disponibilidad']({ id_ingrediente: 31, disponible: false, emitidoEn: t(1) }))
    expect(screen.getByTitle('Agotado (clic para activar)')).toBeInTheDocument()

    // Otro ingrediente que no está en este plato no cambia nada.
    act(() => oyentes['ingrediente:disponibilidad']({ id_ingrediente: 999, disponible: true, emitidoEn: t(2) }))
    expect(screen.getByTitle('Agotado (clic para activar)')).toBeInTheDocument()
  })

  it('EditorPasos: un aviso viejo del ingrediente no pisa uno más nuevo', async () => {
    render(<EditorPasos dish={{ id: 101, name: 'Hamburguesa Doble Queso' }} onClose={() => {}} onDishUpdated={() => {}} />)
    expect(await screen.findByText('Pollo a la Plancha')).toBeInTheDocument()

    act(() => oyentes['ingrediente:disponibilidad']({ id_ingrediente: 31, disponible: false, emitidoEn: t(5) }))
    act(() => oyentes['ingrediente:disponibilidad']({ id_ingrediente: 31, disponible: true, emitidoEn: t(3) }))

    expect(screen.getByTitle('Agotado (clic para activar)')).toBeInTheDocument()
  })
})
