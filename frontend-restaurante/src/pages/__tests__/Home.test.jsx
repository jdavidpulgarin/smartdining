import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Home } from '../Home'
import { TablesProvider } from '../../context/TablesContext'
import { MENU_REAL_FIXTURE } from '../../test/fixtures/menuReal'

describe('Flujo de Listado de Mesas en Home', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('debe listar las mesas obtenidas desde la API del backend', async () => {
    const mockMesas = [
      { id_mesa: 1, numero: 1, capacidad: 4, ubicacion: 'Terraza', estado: 'libre' },
      { id_mesa: 2, numero: 2, capacidad: 2, ubicacion: 'Salón', estado: 'ocupada' },
      { id_mesa: 3, numero: 3, capacidad: 6, ubicacion: 'VIP', estado: 'cuenta_pedida' },
    ]

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/api/mesas') && !url.includes('/cuenta')) {
        return {
          ok: true,
          json: async () => ({ mesas: mockMesas }),
        }
      }
      if (url.includes('/api/pedidos/activos')) {
        return {
          ok: true,
          json: async () => ({ pedidos: [] }),
        }
      }
      if (url.includes('/api/menu')) {
        return {
          ok: true,
          json: async () => MENU_REAL_FIXTURE,
        }
      }
      return {
        ok: true,
        json: async () => ({}),
      }
    })

    render(
      <MemoryRouter>
        <TablesProvider>
          <Home />
        </TablesProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument()
      expect(screen.getByText('Mesa 2')).toBeInTheDocument()
      expect(screen.getByText('Mesa 3')).toBeInTheDocument()
    })

    expect(screen.getByText('3')).toBeInTheDocument() // Total mesas en stats
  })
})
