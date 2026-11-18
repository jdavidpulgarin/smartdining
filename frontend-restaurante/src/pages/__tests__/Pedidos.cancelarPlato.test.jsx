import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Socket simulado y rol de la sesión configurable por prueba.
const oyentes = {}
let rolSesion = 'mesero'
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
  useSocketEmit: () => vi.fn(),
  useAuth: () => ({ user: { rol: rolSesion } }),
}))

import { Pedidos } from '../Pedidos'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

const linea = (id, nombre, estado_item = 'pendiente', extra = {}) => ({
  id_detalle: id, id_plato: id, plato_nombre: nombre, cantidad: 1, subtotal: 10000, comensal: 'Ana', estado_item, ...extra,
})

const pedido = (extra = {}) => ({
  id_pedido: 87,
  codigo_pedido: 'PED-87',
  id_mesa: 5,
  mesa_numero: 5,
  estado: 'en_preparacion',
  total: 30000,
  creado_en: new Date().toISOString(),
  detalles: [linea(210, 'Bowl'), linea(211, 'Wrap', 'cocinando'), linea(212, 'Jugo', 'servido')],
  ...extra,
})

/** Backend simulado: GET /pedidos/activos y el POST de D-13 con `cancelar(url, body, n)`. */
function backend({ activos = [pedido()], cancelar = () => json({}, 200) } = {}) {
  const envios = []
  vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    if (/\/pedidos\/activos$/.test(url)) return json({ pedidos: activos })
    if (/\/items\/\d+\/cancelar$/.test(url) && config.method === 'POST') {
      const body = JSON.parse(config.body)
      envios.push({ url, body })
      return cancelar(url, body, envios.length)
    }
    throw new Error(`no debería llamar a ${url}`)
  })
  return { envios }
}

async function abrirDetalle() {
  render(
    <MemoryRouter>
      <Pedidos />
    </MemoryRouter>
  )
  fireEvent.click(await screen.findByText('Mesa 5'))
  return screen.findByText('Comanda PED-87')
}

const modal = () => screen.getByText('Comanda PED-87').closest('.sd-table-detail-modal')

describe('Pedidos: «Cancelar plato» del personal (D-13)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const evento of Object.keys(oyentes)) delete oyentes[evento]
    sessionStorage.setItem('smartdining_token', 'test-token')
    rolSesion = 'mesero'
  })

  it('mesero: el botón sale en las líneas vivas no servidas; no en la servida', async () => {
    backend()
    await abrirDetalle()
    expect(within(modal()).getByRole('button', { name: 'Cancelar plato Bowl' })).toBeInTheDocument()
    expect(within(modal()).getByRole('button', { name: 'Cancelar plato Wrap' })).toBeInTheDocument()
    expect(within(modal()).queryByRole('button', { name: 'Cancelar plato Jugo' })).toBeNull()
  })

  it.each(['cajero', 'cocina'])('%s: no ve «Cancelar plato» (el backend le da 403)', async (rol) => {
    rolSesion = rol
    backend()
    await abrirDetalle()
    expect(within(modal()).queryByRole('button', { name: /Cancelar plato/ })).toBeNull()
  })

  it('admin sí lo ve; con el pedido entregado no sale en ninguna línea', async () => {
    rolSesion = 'admin'
    backend({ activos: [pedido({ estado: 'entregado' })] })
    await abrirDetalle()
    expect(within(modal()).queryByRole('button', { name: /Cancelar plato/ })).toBeNull()
  })

  it('el motivo es obligatorio: vacío o solo espacios no envía nada', async () => {
    const { envios } = backend()
    await abrirDetalle()
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancelar plato Bowl' }))
    fireEvent.change(screen.getByLabelText(/MOTIVO/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Escribe el motivo/)
    expect(envios).toHaveLength(0)
  })

  it('con motivo: POST a la línea con { motivo } recortado; la línea queda tachada y el total nuevo', async () => {
    const { envios } = backend({
      cancelar: () => json({
        pedido: {
          id_pedido: 87, codigo_pedido: 'PED-87', estado: 'en_preparacion', total: 20000,
          items: [linea(210, 'Bowl', 'cancelado'), linea(211, 'Wrap', 'cocinando'), linea(212, 'Jugo', 'servido')],
        },
      }),
    })
    await abrirDetalle()
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancelar plato Bowl' }))
    expect(screen.getByText(/Cocina ya lo empezó: queda como merma/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/MOTIVO/), { target: { value: '  El cliente ya no lo quiere  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))

    await waitFor(() => expect(envios).toHaveLength(1))
    expect(envios[0].url).toMatch(/\/pedidos\/87\/items\/210\/cancelar$/)
    expect(envios[0].body).toEqual({ motivo: 'El cliente ya no lo quiere' })
    await waitFor(() => expect(within(modal()).getByText(/Ana · CANCELADO/)).toBeInTheDocument())
    expect(within(modal()).queryByRole('button', { name: 'Cancelar plato Bowl' })).toBeNull()
    expect(within(modal()).getByText('$20.000')).toBeInTheDocument()
  })

  it('pedido recibido y línea pendiente: avisa que el stock vuelve', async () => {
    backend({ activos: [pedido({ estado: 'recibido', detalles: [linea(210, 'Bowl'), linea(211, 'Wrap')] })] })
    await abrirDetalle()
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancelar plato Bowl' }))
    expect(screen.getByText(/vuelve al inventario/)).toBeInTheDocument()
  })

  it('409 pago_registrado: mensaje claro y la línea sigue viva', async () => {
    backend({ cancelar: () => json({ error: 'x', motivo: 'pago_registrado' }, 409) })
    await abrirDetalle()
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancelar plato Bowl' }))
    fireEvent.change(screen.getByLabelText(/MOTIVO/), { target: { value: 'Error del mesero' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/hay que reembolsar/)
    expect(within(modal()).queryByText(/CANCELADO/)).toBeNull()
  })

  it('la última línea viva: el pedido queda cancelado, sale de la lista y se cierra el detalle', async () => {
    backend({
      activos: [pedido({ detalles: [linea(210, 'Bowl'), linea(211, 'Wrap', 'cancelado')] })],
      cancelar: () => json({ pedido: { id_pedido: 87, codigo_pedido: 'PED-87', estado: 'cancelado', total: 0, items: [] } }),
    })
    await abrirDetalle()
    fireEvent.click(within(modal()).getByRole('button', { name: 'Cancelar plato Bowl' }))
    fireEvent.change(screen.getByLabelText(/MOTIVO/), { target: { value: 'Se fueron' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }))
    expect(await screen.findByText('Pedido PED-87 cancelado: era su último plato')).toBeInTheDocument()
    expect(screen.queryByText('Comanda PED-87')).toBeNull()
    expect(screen.queryByText('Mesa 5')).toBeNull()
  })
})

describe('Pedidos: item:cancelado en vivo (EVENTS.md §5.6)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const evento of Object.keys(oyentes)) delete oyentes[evento]
    sessionStorage.setItem('smartdining_token', 'test-token')
    rolSesion = 'mesero'
  })

  const evento = (extra = {}) => ({
    eventId: 'evt-1', id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-87', id_detalle: 210, nombre: 'Bowl',
    comensal: 'Ana', total: 20000, estado_pedido: 'en_preparacion', origen: 'comensal', ...extra,
  })

  it('tacha la línea y pone el total nuevo en el detalle abierto, sin recargar; un repetido se ignora', async () => {
    backend()
    await abrirDetalle()
    act(() => oyentes['item:cancelado'](evento()))
    expect(within(modal()).getByText(/Ana · CANCELADO/)).toBeInTheDocument()
    expect(within(modal()).getByText('$20.000')).toBeInTheDocument()
    expect(screen.getByText('Bowl cancelado por Ana (PED-87)')).toBeInTheDocument()

    act(() => oyentes['item:cancelado'](evento({ id_detalle: 211, total: 1 })))
    expect(within(modal()).getAllByText(/CANCELADO/)).toHaveLength(1)
  })

  it('si era la última línea (estado_pedido cancelado), el pedido sale de la lista', async () => {
    backend()
    await abrirDetalle()
    act(() => oyentes['item:cancelado'](evento({ eventId: 'evt-2', estado_pedido: 'cancelado', total: 0, origen: 'personal' })))
    expect(screen.queryByText('Mesa 5')).toBeNull()
    expect(screen.getByText('Bowl cancelado por el personal (PED-87)')).toBeInTheDocument()
  })
})
