import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Caja } from '../Caja'
import { TablesProvider } from '../../context/TablesContext'

describe('Flujo de Caja en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('debe listar las cuentas pendientes de cobro y calcular montos', async () => {
    const mockMesas = [
      { id_mesa: 1, numero: 1, capacidad: 4, ubicacion: 'Salón', estado: 'ocupada' },
    ]

    const mockCuentaMesa1 = {
      id_mesa: 1,
      numero_mesa: 1,
      ubicacion_mesa: 'Salón',
      total_mesa: 50000,
      pagado_mesa: 0,
      saldo_mesa: 50000,
      comensales: [
        {
          nombre: 'Comensal 1',
          total_comensal: 50000,
          saldo_comensal: 50000,
          pedidos: [{ id_pedido: 10, total: 50000 }],
        },
      ],
      pedidos: [{ id_pedido: 10, total: 50000 }],
    }

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/api/mesas/1/cuenta')) {
        return {
          ok: true,
          json: async () => mockCuentaMesa1,
        }
      }
      if (url.includes('/api/mesas') && !url.includes('/cuenta')) {
        return {
          ok: true,
          json: async () => ({ mesas: mockMesas }),
        }
      }
      if (url.includes('/api/pedidos/10')) {
        return {
          ok: true,
          json: async () => ({
            pedido: { id_pedido: 10 },
            detalles: [{ id_detalle: 1, cantidad: 2, precio_unitario: 25000, nombre_plato: 'Corte Angus' }],
          }),
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
          <Caja />
        </TablesProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument()
      expect(screen.getAllByText(/50\.000/).length).toBeGreaterThan(0)
    })

    expect(screen.getByText(/total a liquidar/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cobrar/i })).toBeInTheDocument()
  })

  it('debe registrar el pago en efectivo y generar recibo', async () => {
    const mockMesas = [
      { id_mesa: 1, numero: 1, capacidad: 4, ubicacion: 'Salón', estado: 'ocupada' },
    ]

    const mockCuenta = {
      id_mesa: 1,
      numero_mesa: 1,
      ubicacion_mesa: 'Salón',
      total_mesa: 30000,
      pagado_mesa: 0,
      saldo_mesa: 30000,
      comensales: [],
      pedidos: [{ id_pedido: 20, total: 30000 }],
    }

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/api/transacciones')) {
        return {
          ok: true,
          json: async () => ({
            id_transaccion: 99,
            monto: 30000,
            estado: 'aprobada',
          }),
        }
      }
      if (url.includes('/api/mesas/1/cuenta')) {
        return {
          ok: true,
          json: async () => mockCuenta,
        }
      }
      if (url.includes('/api/mesas')) {
        return {
          ok: true,
          json: async () => ({ mesas: mockMesas }),
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
          <Caja />
        </TablesProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Mesa 1')).toBeInTheDocument()
    })

    const cashInput = screen.getByLabelText(/efectivo recibido/i)
    fireEvent.change(cashInput, { target: { value: '50000' } })

    const payBtn = screen.getByRole('button', { name: /^cobrar/i })
    fireEvent.click(payBtn)

    await waitFor(() => {
      expect(screen.getByText('Pago Procesado con Éxito')).toBeInTheDocument()
      expect(screen.getByText('TRX-99')).toBeInTheDocument()
    })
  })
})
