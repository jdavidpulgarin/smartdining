import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Reportes } from '../Reportes'

describe('Flujo de Reportes & BI en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('debe renderizar el dashboard con fallback estructurado cuando la API retorna 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Ruta no encontrada' }),
    })

    render(
      <MemoryRouter>
        <Reportes />
      </MemoryRouter>
    )

    // Debe mostrar indicador de carga o pasar a los KPIs
    await waitFor(() => {
      expect(screen.getByText(/Métricas & Business Intelligence/i)).toBeInTheDocument()
      expect(screen.getByText(/Modo simulación analítica/i)).toBeInTheDocument()
      expect(screen.getByText('$1,280.00')).toBeInTheDocument()
    })

    // Debe mostrar los platos top y tablas analíticas
    expect(screen.getByText('Hamburguesa Smart Angus')).toBeInTheDocument()
    expect(screen.getByText(/Ingredientes Top en Constructor de Platos/i)).toBeInTheDocument()
    expect(screen.getByText(/Métricas de Eficiencia Cocina KDS/i)).toBeInTheDocument()
  })

  it('debe cambiar de rango al seleccionar "Esta Semana"', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Ruta no encontrada' }),
    })

    render(
      <MemoryRouter>
        <Reportes />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('$1,280.00')).toBeInTheDocument()
    })

    const semanaBtn = screen.getByRole('button', { name: /esta semana/i })
    fireEvent.click(semanaBtn)

    await waitFor(() => {
      expect(screen.getByText('$8,940.00')).toBeInTheDocument()
    })
  })
})
