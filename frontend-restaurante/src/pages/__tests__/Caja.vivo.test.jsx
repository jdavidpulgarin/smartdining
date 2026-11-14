import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// T4: la Caja en vivo. Socket simulado: cada prueba dispara los avisos a mano.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
  useAuth: () => ({ user: { rol: 'cajero' } }),
  useTables: () => ({ cargarMesas: vi.fn() }),
}))

import { Caja } from '../Caja'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

const cuenta = (saldo) => ({
  id_mesa: 1,
  numero: 1,
  ubicacion: 'Salón',
  total_mesa: saldo,
  pagado_mesa: 0,
  saldo_mesa: saldo,
  pedidos: [{ id_pedido: 10, codigo_pedido: 'PED-10', estado: 'recibido', total: saldo }],
  comensales: [{ comensal: 'Ana', items_pedidos: 1, subtotal: saldo, pagado: 0, saldo }],
})

const DIA = { desde: '2026-11-13', hasta: '2026-11-13', total: 0, cantidad: 0, transacciones: [] }

/**
 * Backend simulado. `respuestaCuenta(n)` da la n-ésima respuesta de
 * GET /mesas/1/cuenta: un objeto, o una promesa para controlar cuándo llega.
 */
function backend(respuestaCuenta) {
  const llamadas = { cuenta: 0, dia: 0 }
  vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (/\/transacciones\?desde=hoy$/.test(url)) {
      llamadas.dia += 1
      return json(DIA)
    }
    if (url.includes('/mesas/1/cuenta')) {
      llamadas.cuenta += 1
      return json(await respuestaCuenta(llamadas.cuenta))
    }
    if (url.includes('/mesas')) return json({ mesas: [{ id_mesa: 1, numero: 1, ubicacion: 'Salón', estado: 'ocupada' }] })
    if (/\/pedidos\/\d+$/.test(url)) return json({ pedido: { id_pedido: 10 }, detalles: [] })
    return json({})
  })
  return llamadas
}

function montar() {
  render(
    <MemoryRouter>
      <Caja />
    </MemoryRouter>
  )
}

const saldoGrande = () => screen.getByText('SALDO PENDIENTE MESA').parentElement

describe('Caja en vivo (T4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const k of Object.keys(oyentes)) delete oyentes[k]
    sessionStorage.clear()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('item:cancelado: vuelve a pedir la cuenta y muestra el saldo nuevo', async () => {
    const llamadas = backend((n) => cuenta(n === 1 ? 30000 : 20000))
    montar()
    await waitFor(() => expect(saldoGrande()).toHaveTextContent('30.000'))

    await act(async () => oyentes['item:cancelado']({ id_pedido: 10, id_mesa: 1, total: 20000 }))
    await waitFor(() => expect(saldoGrande()).toHaveTextContent('20.000'))
    expect(llamadas.cuenta).toBe(2)
  })

  it('una respuesta vieja que llega tarde NO pisa el saldo nuevo', async () => {
    let soltarVieja
    const vieja = new Promise((r) => { soltarVieja = r })
    // 1: al montar (30.000). 2: primera recarga, lenta, con el saldo de antes
    // (20.000). 3: segunda recarga, rápida, con el saldo final (10.000).
    backend((n) => (n === 1 ? cuenta(30000) : n === 2 ? vieja : cuenta(10000)))
    montar()
    await waitFor(() => expect(saldoGrande()).toHaveTextContent('30.000'))

    await act(async () => {
      oyentes['item:cancelado']({ id_pedido: 10, id_mesa: 1, total: 20000 })
      oyentes['item:cancelado']({ id_pedido: 10, id_mesa: 1, total: 10000 })
    })
    await waitFor(() => expect(saldoGrande()).toHaveTextContent('10.000'))

    // Llega la vieja: el saldo sigue en 10.000.
    await act(async () => {
      soltarVieja(cuenta(20000))
      await vieja
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(saldoGrande()).toHaveTextContent('10.000')
    expect(saldoGrande()).not.toHaveTextContent('20.000')
  })

  it('al reconectar el socket recarga las cuentas y lo cobrado hoy', async () => {
    const llamadas = backend((n) => cuenta(n === 1 ? 30000 : 20000))
    montar()
    await waitFor(() => expect(saldoGrande()).toHaveTextContent('30.000'))
    const diaAntes = llamadas.dia

    expect(typeof oyentes.connect).toBe('function')
    await act(async () => oyentes.connect())
    await waitFor(() => expect(saldoGrande()).toHaveTextContent('20.000'))
    expect(llamadas.cuenta).toBe(2)
    expect(llamadas.dia).toBe(diaAntes + 1)
  })
})
