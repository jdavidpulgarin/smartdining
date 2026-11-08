import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Socket simulado: guarda los oyentes para poder disparar eventos a mano.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
  useSocketEmit: () => vi.fn(),
}))

import { Pedidos } from '../Pedidos'

function eventoOrderCreated(pedido) {
  return { eventId: `evt-${pedido.id_pedido}`, pedido, emitidoEn: new Date().toISOString() }
}

const pedidoNuevo = {
  id_pedido: 87,
  codigo_pedido: 'PED-260922-K3F9AQ',
  id_mesa: 5,
  estado: 'recibido',
  total: 56000,
  items: [{ id_plato: 3, nombre: 'Bowl', cantidad: 2, comensal: 'Ana', notas_especiales: 'sin cebolla' }],
}

describe('Pedidos en tiempo real (order:created)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const evento of Object.keys(oyentes)) delete oyentes[evento]
    sessionStorage.setItem('smartdining_token', 'test-token')
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ pedidos: [] }),
    })
  })

  async function montar() {
    render(
      <MemoryRouter>
        <Pedidos />
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.queryByText(/CARGANDO COMANDAS/)).toBeNull())
  }

  it('escucha order:created (y ya no order:new, que nadie emite)', async () => {
    await montar()
    expect(oyentes['order:created']).toBeTypeOf('function')
    expect(oyentes['order:new']).toBeUndefined()
  })

  it('agrega el pedido del evento con sus platos y el comensal de pedido.items', async () => {
    await montar()

    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))

    expect(await screen.findAllByText(/PED-260922-K3F9AQ/)).not.toHaveLength(0)
    expect(screen.getAllByText(/Ana/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Bowl/).length).toBeGreaterThan(0)
  })

  it('un reintento del mismo pedido no lo duplica', async () => {
    await montar()

    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))
    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))

    expect(await screen.findAllByText(/PED-260922-K3F9AQ/)).toHaveLength(1)
  })

  it('ignora un evento sin pedido válido', async () => {
    await montar()

    act(() => oyentes['order:created']({ eventId: 'x' }))
    act(() => oyentes['order:created'](null))

    expect(screen.queryByText(/PED-260922-K3F9AQ/)).toBeNull()
  })
})
