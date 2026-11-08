import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Reportes } from '../Reportes'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

// Respuesta de GET /api/reportes (los campos que pinta el dashboard).
function reporte(totalVentas) {
  return {
    totalVentas,
    totalPedidos: 12,
    pedidosLiquidados: 10,
    tiempoCocinaPromedio: 12.5,
    ocupacionMesas: '40%',
    ticketPromedio: 45000,
    topPlatos: [],
    topIngredientes: [],
    metodosPago: [],
  }
}

function montar() {
  render(
    <MemoryRouter>
      <Reportes />
    </MemoryRouter>
  )
}

describe('Flujo de Reportes & BI en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('pinta las cifras que devuelve GET /api/reportes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json(reporte(540000)))
    montar()

    await waitFor(() => {
      expect(screen.getByText(/ASÍ VA/i)).toBeInTheDocument()
      expect(screen.getByText(/\$540\.000/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/datos de demostración/i)).not.toBeInTheDocument()
  })

  it('P-13: si la ruta responde 404 muestra el error y NO inventa cifras', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ error: 'Ruta no encontrada' }, 404))
    montar()

    expect(await screen.findByText(/No se pudieron cargar los datos de reporte/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Ruta no encontrada')
    // Las cifras de demostración (1.280.000 del día) ya no aparecen.
    expect(screen.queryByText(/\$1\.280\.000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/simulación|demostración/i)).not.toBeInTheDocument()
  })

  it('P-13: sin conexión dice "Sin conexión con el servidor" y no inventa cifras', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión con el servidor')
    expect(screen.queryByText(/\$1\.280\.000/)).not.toBeInTheDocument()
  })

  it('al elegir "Esta semana" pide rango=semana y pinta esa respuesta', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      json(reporte(url.includes('rango=semana') ? 3150000 : 540000))
    )
    montar()
    await waitFor(() => expect(screen.getByText(/\$540\.000/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /últimos 7 días|esta semana/i }))

    await waitFor(() => expect(screen.getByText(/\$3\.150\.000/)).toBeInTheDocument())
    expect(fetchSpy.mock.calls.some(([url]) => url.includes('/reportes?rango=semana'))).toBe(true)
  })
})
