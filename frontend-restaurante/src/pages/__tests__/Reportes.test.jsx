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
      expect(screen.getByText(/ASÍ VA/i)).toBeInTheDocument()
      expect(screen.getByText(/Modo simulación analítica/i)).toBeInTheDocument()
      expect(screen.getByText(/\$1\.280\.000/)).toBeInTheDocument()
    })

    // Debe mostrar los platos top y paneles analíticos
    expect(screen.getByText(/Bowl Personalizado|1\. BOWL/i)).toBeInTheDocument()
    expect(screen.getByText(/Ingredientes Más Pedidos/i)).toBeInTheDocument()
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
      expect(screen.getByText(/\$1\.280\.000/)).toBeInTheDocument()
    })

    const semanaBtn = screen.getByRole('button', { name: /últimos 7 días|esta semana/i })
    fireEvent.click(semanaBtn)

    await waitFor(() => {
      expect(screen.getByText(/\$8\.940\.000/)).toBeInTheDocument()
    })
  })
})
