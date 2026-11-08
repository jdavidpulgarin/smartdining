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

  beforeEach(() => {
    vi.restoreAllMocks()
    for (const e of Object.keys(oyentes)) delete oyentes[e]
    sessionStorage.setItem('smartdining_token', 'test-token')
    fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/pasos')) return json(pasos)
      if (url.includes('/categorias')) return json({ categorias })
      if (url.includes('/platos')) return json({ platos })
      return json({})
    })
  })

  it('Menú: plato:disponibilidad agota y repone el plato sin pedir la carta otra vez', async () => {
    render(<MemoryRouter><Menu /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())
    const llamadas = fetchSpy.mock.calls.length

    act(() => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(1) }))
    expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('AGOTADO')).toBeInTheDocument()

    act(() => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(2) }))
    expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('DISPONIBLE')).toBeInTheDocument()

    expect(fetchSpy.mock.calls.length).toBe(llamadas)
  })

  it('Menú: un aviso más viejo que el último aplicado se descarta', async () => {
    render(<MemoryRouter><Menu /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

    act(() => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: false, emitidoEn: t(5) }))
    act(() => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: true, emitidoEn: t(3) }))

    expect(within(tarjetaDe('Hamburguesa Doble Queso')).getByText('AGOTADO')).toBeInTheDocument()
  })

  it('Menú: ignora un aviso mal formado', async () => {
    render(<MemoryRouter><Menu /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument())

    act(() => oyentes['plato:disponibilidad']({ id_plato: 101, disponible: 'no' }))
    act(() => oyentes['plato:disponibilidad'](null))

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
})
