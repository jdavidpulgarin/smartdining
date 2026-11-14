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
  useAuth: () => ({ user: { rol: 'admin' } }),
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

  it('deduplica por eventId: un evento repetido se ignora entero (EVENTS.md §5)', async () => {
    await montar()

    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))
    // Mismo eventId con otro contenido: si se aplicara, el plato cambiaría.
    act(() =>
      oyentes['order:created']({
        ...eventoOrderCreated(pedidoNuevo),
        pedido: { ...pedidoNuevo, items: [{ ...pedidoNuevo.items[0], nombre: 'Wrap' }] },
      })
    )

    expect(await screen.findAllByText(/PED-260922-K3F9AQ/)).toHaveLength(1)
    expect(screen.queryByText(/Wrap/)).toBeNull()
  })

  it('el mismo pedido con otro eventId reemplaza la tarjeta, no la duplica', async () => {
    await montar()

    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))
    act(() =>
      oyentes['order:created']({
        eventId: 'evt-otro',
        pedido: { ...pedidoNuevo, items: [{ ...pedidoNuevo.items[0], nombre: 'Wrap' }] },
        emitidoEn: new Date().toISOString(),
      })
    )

    expect(await screen.findAllByText(/PED-260922-K3F9AQ/)).toHaveLength(1)
    expect(screen.getAllByText(/Wrap/).length).toBeGreaterThan(0)
  })

  it('P-14: un order:status reintentado tarde no hace retroceder el estado', async () => {
    await montar()
    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))

    const estado = (eventId, nuevo) => ({
      eventId, id_pedido: 87, id_mesa: 5, codigo_pedido: pedidoNuevo.codigo_pedido,
      estado_anterior: 'recibido', estado: nuevo, emitidoEn: new Date().toISOString(),
    })
    act(() => oyentes['order:status'](estado('evt-listo', 'listo')))
    act(() => oyentes['order:status'](estado('evt-entregado', 'entregado')))
    expect(screen.getByText('Pedido 87 cambió a: entregado')).toBeInTheDocument()

    // El servidor reintenta el "listo" con su mismo eventId: se ignora.
    act(() => oyentes['order:status'](estado('evt-listo', 'listo')))
    expect(screen.getByText('Pedido 87 cambió a: entregado')).toBeInTheDocument()
    expect(screen.queryByText('Pedido 87 cambió a: listo')).toBeNull()
  })

  it('un order:status a cancelado saca el pedido de la lista sin recargar (no lo deja como Pendiente)', async () => {
    await montar()
    act(() => oyentes['order:created'](eventoOrderCreated(pedidoNuevo)))
    expect(await screen.findAllByText(/PED-260922-K3F9AQ/)).not.toHaveLength(0)

    act(() =>
      oyentes['order:status']({
        eventId: 'evt-cancelado', id_pedido: 87, id_mesa: 5, codigo_pedido: pedidoNuevo.codigo_pedido,
        estado_anterior: 'recibido', estado: 'cancelado', emitidoEn: new Date().toISOString(),
      })
    )

    expect(screen.getByText('Pedido PED-260922-K3F9AQ cancelado')).toBeInTheDocument()
    // El código solo queda en el aviso: la tarjeta ya no está.
    expect(screen.getAllByText(/PED-260922-K3F9AQ/)).toHaveLength(1)
    expect(screen.queryAllByText(/Bowl/)).toHaveLength(0)
  })

  it('ignora un evento sin pedido válido', async () => {
    await montar()

    act(() => oyentes['order:created']({ eventId: 'x' }))
    act(() => oyentes['order:created'](null))

    expect(screen.queryByText(/PED-260922-K3F9AQ/)).toBeNull()
  })
})
