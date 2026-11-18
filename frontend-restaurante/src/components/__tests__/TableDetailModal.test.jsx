import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Socket falso: guarda los manejadores para disparar avisos a mano.
const manejadores = {}
const socketFalso = {
  on: (ev, fn) => {
    manejadores[ev] = fn
  },
  off: (ev) => {
    delete manejadores[ev]
  },
}
vi.mock('../../hooks', () => ({
  useAuth: () => ({ user: { rol: 'admin' } }),
  useSocket: () => socketFalso,
}))

const obtenerCuenta = vi.fn()
vi.mock('../../services/api', () => ({
  mesasApi: { obtenerCuenta: (...a) => obtenerCuenta(...a) },
}))

import { TableDetailModal } from '../TableDetailModal'

const ord001 = {
  id_pedido: 1,
  codigo_pedido: 'ORD-001',
  id_mesa: 3,
  estado: 'entregado',
  total: 70000,
  detalles: [{ cantidad: 2, plato_nombre: 'Bandeja', subtotal: 70000, comensal: 'Ana' }],
}

const cuenta = (extra = {}) => ({
  id_mesa: 3,
  estado_mesa: 'ocupada',
  total_mesa: 0,
  pagado_mesa: 0,
  saldo_mesa: 0,
  items_totales: 0,
  pedidos: [],
  comensales: [],
  ...extra,
})

function montar(table, pedidos = [ord001]) {
  return render(
    <MemoryRouter>
      <TableDetailModal table={table} pedidos={pedidos} onClose={() => {}} />
    </MemoryRouter>
  )
}

describe('TableDetailModal: consumo y saldo de la cuenta de la mesa', () => {
  beforeEach(() => {
    obtenerCuenta.mockReset()
    for (const k of Object.keys(manejadores)) delete manejadores[k]
  })

  it('mesa DISPONIBLE con ORD-001 de una visita anterior: "Sin consumo", $0 y no pide la cuenta', async () => {
    montar({ id_mesa: 3, numero: 3, status: 'Disponible' })
    await act(async () => {})
    expect(obtenerCuenta).not.toHaveBeenCalled()
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument()
    expect(screen.queryByText('$70.000')).not.toBeInTheDocument()
    expect(screen.getByText('Sin consumo. Mesa libre.')).toBeInTheDocument()
    expect(screen.getByText('Comandas en Curso (0)')).toBeInTheDocument()
  })

  it('mesa ocupada: los números salen de la cuenta y ORD-001 (otra visita) no aparece', async () => {
    obtenerCuenta.mockResolvedValue(
      cuenta({
        total_mesa: 50000,
        pagado_mesa: 30000,
        saldo_mesa: 20000,
        items_totales: 2,
        pedidos: [{ id_pedido: 80, codigo_pedido: 'PED-A', estado: 'listo', total: 50000 }],
        comensales: [{ comensal: 'Luis', items_pedidos: 2, subtotal: 50000, pagado: 30000, saldo: 20000 }],
      })
    )
    montar({ id_mesa: 3, numero: 3, status: 'Ocupada' })
    expect(await screen.findByText('PED-A')).toBeInTheDocument()
    expect(obtenerCuenta).toHaveBeenCalledWith(3)
    expect(screen.queryByText('ORD-001')).not.toBeInTheDocument()
    expect(screen.getByText('Pagado $30.000')).toBeInTheDocument()
    expect(screen.getByText('Saldo $20.000')).toBeInTheDocument()
  })

  it('pagada con pedidos sin entregar: muestra el aviso; un payment:confirmed de la mesa recarga la cuenta', async () => {
    obtenerCuenta.mockResolvedValueOnce(
      cuenta({
        total_mesa: 50000,
        saldo_mesa: 50000,
        pedidos: [{ id_pedido: 80, codigo_pedido: 'PED-A', estado: 'listo', total: 50000 }],
      })
    )
    montar({ id_mesa: 3, numero: 3, status: 'Ocupada' })
    await screen.findByText('PED-A')
    expect(screen.queryByText(/Pagada: marca los pedidos/)).not.toBeInTheDocument()

    obtenerCuenta.mockResolvedValueOnce(
      cuenta({
        total_mesa: 50000,
        pagado_mesa: 50000,
        saldo_mesa: 0,
        pedidos: [{ id_pedido: 80, codigo_pedido: 'PED-A', estado: 'listo', total: 50000 }],
      })
    )
    // Un aviso de OTRA mesa no recarga.
    await act(async () => manejadores['payment:confirmed']({ id_mesa: 9 }))
    expect(obtenerCuenta).toHaveBeenCalledTimes(1)

    await act(async () => manejadores['payment:confirmed']({ id_mesa: 3 }))
    await waitFor(() =>
      expect(
        screen.getByText('Pagada: marca los pedidos como entregados para cerrar la mesa')
      ).toBeInTheDocument()
    )
    expect(obtenerCuenta).toHaveBeenCalledTimes(2)
  })

  it('pago total a nombre de "General": todos los comensales se ven "Pagado", sin "Saldo $X"', async () => {
    obtenerCuenta.mockResolvedValue(
      cuenta({
        total_mesa: 24000,
        pagado_mesa: 24000,
        saldo_mesa: 0,
        items_totales: 1,
        comensales: [
          { comensal: 'Daniel', items_pedidos: 1, subtotal: 24000, pagado: 0, saldo: 24000 },
          { comensal: 'General', items_pedidos: 0, subtotal: 0, pagado: 24000, saldo: 0 },
        ],
      })
    )
    montar({ id_mesa: 3, numero: 3, status: 'Ocupada' })
    expect(await screen.findByText('Daniel')).toBeInTheDocument()
    expect(screen.getAllByText('Pagado')).toHaveLength(2)
    expect(screen.queryByText(/^Saldo \$/)).not.toBeInTheDocument()
  })

  it('si la cuenta falla: aviso de error y sin cifras inventadas', async () => {
    obtenerCuenta.mockRejectedValue(new Error('500'))
    montar({ id_mesa: 3, numero: 3, status: 'Ocupada' })
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la cuenta de la mesa.')
    expect(screen.queryByText('$70.000')).not.toBeInTheDocument()
  })
})
