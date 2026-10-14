import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Menu } from '../Menu'

describe('Flujo de Menú en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('debe listar los platos y categorías devueltos por la API real', async () => {
    const mockMenu = {
      categorias: [
        {
          id_categoria: 1,
          nombre: 'Hamburguesas',
          descripcion: 'Artesanales a la parrilla',
          platos: [
            {
              id_plato: 101,
              nombre: 'Hamburguesa Doble Queso',
              precio: 28000,
              descripcion: 'Carne angus con doble cheddar',
              tiempo_preparacion_estimado: 15,
              disponible: true,
            },
          ],
        },
        {
          id_categoria: 2,
          nombre: 'Bebidas',
          descripcion: 'Refrescantes',
          platos: [
            {
              id_plato: 201,
              nombre: 'Limonada de Coco',
              precio: 12000,
              descripcion: 'Leche de coco y limón fresco',
              tiempo_preparacion_estimado: 5,
              disponible: true,
            },
          ],
        },
      ],
    }

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockMenu,
    })

    render(
      <MemoryRouter>
        <Menu />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Hamburguesa Doble Queso')).toBeInTheDocument()
      expect(screen.getByText('Limonada de Coco')).toBeInTheDocument()
    })

    expect(screen.getByText('$28.000')).toBeInTheDocument()
    expect(screen.getByText('$12.000')).toBeInTheDocument()
  })

  it('debe filtrar los platos al buscar por nombre en el buscador', async () => {
    const mockMenu = {
      categorias: [
        {
          id_categoria: 1,
          nombre: 'Hamburguesas',
          platos: [
            { id_plato: 101, nombre: 'Burger Clásica', precio: 22000, disponible: true },
            { id_plato: 102, nombre: 'Costillas BBQ', precio: 38000, disponible: true },
          ],
        },
      ],
    }

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockMenu,
    })

    render(
      <MemoryRouter>
        <Menu />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Burger Clásica')).toBeInTheDocument()
      expect(screen.getByText('Costillas BBQ')).toBeInTheDocument()
    })

    const searchInput = screen.getByPlaceholderText(/buscar plato por nombre/i)
    fireEvent.change(searchInput, { target: { value: 'Costillas' } })

    expect(screen.getByText('Costillas BBQ')).toBeInTheDocument()
    expect(screen.queryByText('Burger Clásica')).not.toBeInTheDocument()
  })

  it('debe mostrar badge de Arma tu plato cuando el plato es personalizable y permitir abrir el EditorPasos', async () => {
    const mockMenu = {
      categorias: [
        {
          id_categoria: 100,
          nombre: 'Arma tu plato',
          platos: [
            {
              id_plato: 1001,
              nombre: 'Bowl Personalizado',
              precio: 20000,
              disponible: true,
              personalizable: true,
              calorias: 450,
            },
          ],
        },
      ],
    }

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/pasos')) {
        return {
          ok: true,
          json: async () => [
            { id_paso: 1, nombre: 'Elige tu Base', orden: 1, min_sel: 1, max_sel: 1, obligatorio: true, ingredientes: [] },
          ],
        }
      }
      return {
        ok: true,
        json: async () => mockMenu,
      }
    })

    render(
      <MemoryRouter>
        <Menu />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Bowl Personalizado')).toBeInTheDocument()
    })

    expect(screen.getAllByText(/Arma tu plato/i).length).toBeGreaterThanOrEqual(1)

    // Abrir EditorPasos con el botón de constructor
    const btnConstructor = screen.getByTitle('Configurar Pasos e Ingredientes del Constructor')
    fireEvent.click(btnConstructor)

    await waitFor(() => {
      expect(screen.getByText('Constructor de Plato')).toBeInTheDocument()
      expect(screen.getByText(/Configuración de pasos, selecciones e ingredientes/i)).toBeInTheDocument()
    })
  })
})

