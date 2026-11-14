import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { TabConsumo } from '../TabConsumo'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

// Forma real de GET /reportes/consumo (api-spec). Los totales los calcula la
// base y NO son la suma que haría el cliente: así se nota si la pantalla suma.
const reporte = (desde, hasta) => ({
  desde,
  hasta,
  insumos: [
    {
      id_insumo: 3, nombre: 'Arroz integral', unidad: 'g',
      total: { consumo: 450, merma: 20, entradas: 1000, ajustes: -50 },
      dias: [
        { fecha: '2026-11-10', consumo: 300, merma: 0, entradas: 1000, ajustes: -50 },
        { fecha: '2026-11-11', consumo: 150, merma: 20, entradas: 0, ajustes: 0 },
      ],
    },
    {
      id_insumo: 5, nombre: 'Queso cheddar', unidad: 'g',
      total: { consumo: 90, merma: 0, entradas: 0, ajustes: 30 },
      dias: [{ fecha: '2026-11-11', consumo: 90, merma: 0, entradas: 0, ajustes: 30 }],
    },
  ],
})

const insumos = [
  { id_insumo: 5, nombre: 'Queso cheddar', unidad: 'g', stock_actual: 3000, stock_minimo: 500, activo: true },
  { id_insumo: 3, nombre: 'Arroz integral', unidad: 'g', stock_actual: 900, stock_minimo: 100, activo: true },
]

function backend({ consumo = (q) => json(reporte(q.get('desde'), q.get('hasta'))) } = {}) {
  const pedidos = []
  vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (url.includes('/reportes/consumo')) {
      const q = new URL(url).searchParams
      pedidos.push(Object.fromEntries(q))
      return consumo(q)
    }
    if (url.includes('/inventario/insumos')) return json({ insumos })
    throw new Error(`no debería llamar a ${url}`)
  })
  return pedidos
}

describe('TabConsumo (P-22, reporte de consumo)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
    // "Hoy" fijo: 13 nov 2026, 10:00 en Bogotá.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-13T15:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('al abrir pide los últimos 7 días de Bogotá, sin id_insumo', async () => {
    const pedidos = backend()
    render(<TabConsumo />)
    await waitFor(() => expect(pedidos).toHaveLength(1))
    expect(pedidos[0]).toEqual({ desde: '2026-11-07', hasta: '2026-11-13' })
  })

  it('muestra los TOTALES de la base tal cual (no suma los días) y los ajustes con signo', async () => {
    backend()
    render(<TabConsumo />)
    const fila = await screen.findByTestId('consumo-3')
    expect(fila).toHaveTextContent('Arroz integral')
    expect(fila).toHaveTextContent('450 g')
    expect(fila).toHaveTextContent('20 g')
    expect(fila).toHaveTextContent('1.000 g')
    expect(fila).toHaveTextContent('−50 g')
    expect(screen.getByTestId('consumo-5')).toHaveTextContent('+30 g')
    expect(screen.getByTestId('rango-consumo')).toHaveTextContent('2 insumos con movimientos')
  })

  it('«Ver días» despliega el detalle diario del insumo y lo vuelve a ocultar', async () => {
    backend()
    render(<TabConsumo />)
    const fila = await screen.findByTestId('consumo-3')
    fireEvent.click(within(fila).getByRole('button', { name: /Ver días \(2\)/ }))
    expect(screen.getByTestId('consumo-3-2026-11-10')).toHaveTextContent('300 g')
    expect(screen.getByTestId('consumo-3-2026-11-11')).toHaveTextContent('150 g')
    fireEvent.click(within(fila).getByRole('button', { name: /Ocultar días/ }))
    expect(screen.queryByTestId('consumo-3-2026-11-10')).toBeNull()
  })

  it('elegir un insumo manda id_insumo; los atajos piden su rango', async () => {
    const pedidos = backend()
    render(<TabConsumo />)
    await waitFor(() => expect(pedidos).toHaveLength(1))
    await screen.findByRole('option', { name: 'Queso cheddar' })
    fireEvent.change(screen.getByLabelText('INSUMO'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /CONSULTAR/ }))
    await waitFor(() => expect(pedidos).toHaveLength(2))
    expect(pedidos[1]).toEqual({ desde: '2026-11-07', hasta: '2026-11-13', id_insumo: '5' })

    fireEvent.click(screen.getByRole('button', { name: 'Este mes' }))
    await waitFor(() => expect(pedidos).toHaveLength(3))
    expect(pedidos[2]).toEqual({ desde: '2026-11-01', hasta: '2026-11-13', id_insumo: '5' })
  })

  it('un rango de más de 31 días o futuro no se pide: avisa', async () => {
    const pedidos = backend()
    render(<TabConsumo />)
    await waitFor(() => expect(pedidos).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('DESDE'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: /CONSULTAR/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/31 días/)
    fireEvent.change(screen.getByLabelText('DESDE'), { target: { value: '2026-11-10' } })
    fireEvent.change(screen.getByLabelText('HASTA'), { target: { value: '2026-11-14' } })
    fireEvent.click(screen.getByRole('button', { name: /CONSULTAR/ }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/futura/))
    expect(pedidos).toHaveLength(1)
  })

  it('sin movimientos en el rango lo dice; un 400 del servidor muestra su motivo', async () => {
    let n = 0
    backend({
      consumo: () => (++n === 1
        ? json({ desde: '2026-11-07', hasta: '2026-11-13', insumos: [] })
        : json({ error: 'hasta: no puede ser futura', motivo: 'consulta_invalida' }, 400)),
    })
    render(<TabConsumo />)
    expect(await screen.findByText('No hubo movimientos de inventario en ese rango.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /CONSULTAR/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no aceptó el rango: hasta: no puede ser futura/)
  })

  it('la búsqueda filtra los insumos del reporte', async () => {
    backend()
    render(<TabConsumo />)
    await screen.findByTestId('consumo-3')
    fireEvent.change(screen.getByLabelText('Buscar insumo en el reporte'), { target: { value: 'queso' } })
    expect(screen.queryByTestId('consumo-3')).toBeNull()
    expect(screen.getByTestId('consumo-5')).toBeInTheDocument()
  })
})
