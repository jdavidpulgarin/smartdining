import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Caja } from '../Caja'
import { TablesProvider } from '../../context/TablesContext'
import { AuthProvider } from '../../context/AuthContext'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

function sesionComo(rol) {
  sessionStorage.setItem('smartdining_token', 'test-token')
  sessionStorage.setItem(
    'smartdining_staff_user',
    JSON.stringify({ id: 7, id_usuario: 7, nombre: 'Caja Uno', email: 'caja@mail.com', rol, role: rol })
  )
}

// Mesa 1 con DOS pedidos: el cobro ya no puede ir solo al primero.
const MESAS = [
  { id_mesa: 1, numero: 1, capacidad: 4, ubicacion: 'Salón', estado: 'ocupada' },
  { id_mesa: 2, numero: 2, capacidad: 2, ubicacion: 'Terraza', estado: 'ocupada' },
]
const cuenta = (id, saldo, extra = {}) => ({
  id_mesa: id,
  numero: id,
  ubicacion: id === 1 ? 'Salón' : 'Terraza',
  total_mesa: saldo,
  pagado_mesa: 0,
  saldo_mesa: saldo,
  pedidos: [
    { id_pedido: id * 10, codigo_pedido: `PED-${id}A`, estado: 'entregado', total: saldo / 2 },
    { id_pedido: id * 10 + 1, codigo_pedido: `PED-${id}B`, estado: 'entregado', total: saldo / 2 },
  ],
  comensales: [
    { comensal: 'Ana', items_pedidos: 1, subtotal: saldo / 2, pagado: 0, saldo: saldo / 2 },
    { comensal: 'General', items_pedidos: 1, subtotal: saldo / 2, pagado: 0, saldo: saldo / 2 },
  ],
  ...extra,
})

/**
 * Backend simulado. `cobro(body, n)` responde cada POST /transacciones/mesa
 * (n = número de llamada). Devuelve el espía y la lista de cuerpos enviados.
 */
const DIA_VACIO = { desde: '2026-11-11', hasta: '2026-11-11', total: 0, cantidad: 0, transacciones: [] }

/**
 * `dia(n)`: lo que responde GET /transacciones?desde=hoy en la llamada n (o un
 * objeto fijo). `saldoMesa1`: para probar saldos que no son múltiplos de 1.000.
 */
function backend({ cobro = () => json({}, 201), dia = DIA_VACIO, saldoMesa1 = 60000 } = {}) {
  const cobros = []
  const consultasDia = []
  const spy = vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    if (url.includes('/transacciones/mesa') && metodo === 'POST') {
      const body = JSON.parse(config.body)
      cobros.push(body)
      return cobro(body, cobros.length)
    }
    if (/\/transacciones\?desde=hoy$/.test(url) && metodo === 'GET') {
      consultasDia.push(url)
      const r = typeof dia === 'function' ? dia(consultasDia.length, cobros.length) : dia
      return r instanceof Error ? Promise.reject(r) : json(r)
    }
    if (url.includes('/transacciones')) throw new Error(`no debería llamar a ${url}`)
    if (url.includes('/mesas/1/cuenta')) return json(cuenta(1, saldoMesa1))
    if (url.includes('/mesas/2/cuenta')) return json(cuenta(2, 20000))
    if (url.includes('/mesas')) return json({ mesas: MESAS })
    const ped = url.match(/\/pedidos\/(\d+)$/)
    if (ped) {
      return json({ pedido: { id_pedido: Number(ped[1]) }, detalles: [{ cantidad: 1, nombre: `Plato del ${ped[1]}`, subtotal: 30000 }] })
    }
    return json({})
  })
  return { spy, cobros, consultasDia }
}

const fila = (id, mesa, monto, ref, fecha = '2026-11-11T20:11:00.000Z') => ({
  id_transaccion: id, id_pedido: id * 10, codigo_pedido: `PED-${id}`, id_mesa: mesa, numero_mesa: mesa,
  monto, metodo_pago: 'efectivo', comensal: null, fecha, referencia_pago: ref,
})

function montar(ruta = '/caja') {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[ruta]}>
        <TablesProvider>
          <Routes>
            <Route path="/" element={<p>INICIO</p>} />
            <Route path="/caja" element={<Caja />} />
          </Routes>
        </TablesProvider>
      </MemoryRouter>
    </AuthProvider>
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function elegirMesa1YEfectivo(monto = '100000') {
  await waitFor(() => expect(screen.getByText('Mesa 1')).toBeInTheDocument())
  fireEvent.click(screen.getByText('Mesa 1'))
  fireEvent.change(screen.getByLabelText(/efectivo recibido/i), { target: { value: monto } })
}

describe('Caja: cobro de mesa (POST /transacciones/mesa)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    sesionComo('cajero')
  })

  it('lista las cuentas y muestra los ítems de TODOS los pedidos de la mesa', async () => {
    backend()
    montar()
    await elegirMesa1YEfectivo()
    expect(screen.getByText(/2 PEDIDOS/)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/Plato del 10/)).toBeInTheDocument()
      expect(screen.getByText(/Plato del 11/)).toBeInTheDocument()
    })
  })

  it('toda la mesa: un solo POST con id_mesa, el saldo, comensal null e id_cobro UUID; recibo con las transacciones', async () => {
    const { cobros } = backend({
      cobro: () => json({
        duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [10, 11],
        transacciones: [
          { id_transaccion: 501, id_pedido: 10, monto: 30000, comensal: null },
          { id_transaccion: 502, id_pedido: 11, monto: 30000, comensal: null },
        ],
      }, 201),
    })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))

    await waitFor(() => expect(screen.getByText('Pago Procesado con Éxito')).toBeInTheDocument())
    expect(cobros).toHaveLength(1)
    expect(cobros[0]).toEqual({ id_mesa: 1, monto: 60000, metodo_pago: 'efectivo', comensal: null, id_cobro: expect.stringMatching(UUID) })
    expect(screen.getByText('TRX-501 · TRX-502')).toBeInTheDocument()
    expect(screen.getByText(/PED-1A, PED-1B/)).toBeInTheDocument()
    expect(screen.getByText(/mesa liberada/i)).toBeInTheDocument()
  })

  it('doble clic: un solo envío', async () => {
    let soltar
    const { cobros } = backend({
      cobro: () => new Promise((r) => { soltar = () => r(json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [], transacciones: [] }, 201)) }),
    })
    montar()
    await elegirMesa1YEfectivo()
    const boton = screen.getByRole('button', { name: /^cobrar/i })
    fireEvent.click(boton)
    fireEvent.click(boton)
    fireEvent.click(boton)
    await waitFor(() => expect(cobros).toHaveLength(1))
    soltar()
    await waitFor(() => expect(screen.getByText('Pago Procesado con Éxito')).toBeInTheDocument())
    expect(cobros).toHaveLength(1)
  })

  it('sin conexión: el reintento repite el MISMO id_cobro; el cobro siguiente lleva uno nuevo', async () => {
    const { cobros } = backend({
      cobro: (_b, n) => {
        if (n === 1) throw new TypeError('Failed to fetch')
        return json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [10, 11], transacciones: [{ id_transaccion: 9, id_pedido: 10, monto: 60000, comensal: null }] }, 201)
      },
    })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no se cobra dos veces/))

    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByText('Pago Procesado con Éxito')).toBeInTheDocument())
    expect(cobros).toHaveLength(2)
    expect(cobros[1].id_cobro).toBe(cobros[0].id_cobro)

    // Cobro nuevo (mesa 2) después del confirmado: otro id_cobro.
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar recibo' }))
    fireEvent.click(screen.getByText('Mesa 2'))
    fireEvent.change(screen.getByLabelText(/efectivo recibido/i), { target: { value: '20000' } })
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(cobros).toHaveLength(3))
    expect(cobros[2].id_mesa).toBe(2)
    expect(cobros[2].id_cobro).not.toBe(cobros[0].id_cobro)
  })

  it('409 id_cobro_en_uso: aviso, nada cobrado, y el siguiente clic lleva un id_cobro NUEVO', async () => {
    const { cobros } = backend({
      cobro: (_b, n) => (n === 1
        ? json({ error: 'Ese id_cobro ya se usó en otra mesa; genera uno nuevo', motivo: 'id_cobro_en_uso' }, 409)
        : json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [10, 11], transacciones: [{ id_transaccion: 7, id_pedido: 10, monto: 60000, comensal: null }] }, 201)),
    })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/ya se usó en otra mesa/))
    expect(screen.queryByText('Pago Procesado con Éxito')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByText('Pago Procesado con Éxito')).toBeInTheDocument())
    expect(cobros).toHaveLength(2)
    expect(cobros[1].id_cobro).toMatch(UUID)
    expect(cobros[1].id_cobro).not.toBe(cobros[0].id_cobro)
  })

  it('200 duplicado: recibo que avisa que no se cobró otra vez', async () => {
    backend({ cobro: () => json({ duplicado: true, saldo_restante: 0 }, 200) })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByText(/ya estaba registrado/)).toBeInTheDocument())
  })

  it('cobro de una persona: manda su nombre y su saldo; "General" va como comensal null', async () => {
    const { cobros } = backend({ cobro: () => json({ duplicado: false, saldo_restante: 30000, mesa_liberada: false, pagados: [], transacciones: [] }, 201) })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /Ana/ }))
    fireEvent.change(screen.getByLabelText(/efectivo recibido/i), { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(cobros).toHaveLength(1))
    expect(cobros[0]).toMatchObject({ id_mesa: 1, monto: 30000, comensal: 'Ana' })

    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar recibo' }))
    fireEvent.click(screen.getByRole('button', { name: /General/ }))
    fireEvent.change(screen.getByLabelText(/efectivo recibido/i), { target: { value: '30000' } })
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(cobros).toHaveLength(2))
    expect(cobros[1]).toMatchObject({ monto: 30000, comensal: null })
  })

  it('la propina queda en el recibo pero NO en el monto enviado', async () => {
    const { cobros } = backend({ cobro: () => json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [], transacciones: [] }, 201) })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(cobros).toHaveLength(1))
    expect(cobros[0].monto).toBe(60000)
    await waitFor(() => expect(screen.getByText(/Propina/)).toBeInTheDocument())
  })

  it('409 excede: mensaje con el saldo real, sin recibo', async () => {
    backend({ cobro: () => json({ error: 'El pago excede el saldo de la mesa', motivo: 'excede', saldo: 15000 }, 409) })
    montar()
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/supera lo que debe la mesa .*15\.000/))
    expect(screen.queryByText('Pago Procesado con Éxito')).not.toBeInTheDocument()
  })

  it('efectivo insuficiente: aviso y ningún envío', async () => {
    const { cobros } = backend()
    montar()
    await elegirMesa1YEfectivo('1000')
    fireEvent.submit(screen.getByRole('button', { name: /^cobrar/i }).closest('form'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/menor al total/))
    expect(cobros).toHaveLength(0)
  })

  it('?mesa=2 (desde el detalle de la mesa) abre esa mesa', async () => {
    backend()
    montar('/caja?mesa=2')
    await waitFor(() => expect(screen.getByText(/COBRAR \/ MESA 2/)).toBeInTheDocument())
  })
})

describe('Caja: «Recaudado hoy» e Historial salen del backend (GET /transacciones?desde=hoy)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    sesionComo('cajero')
  })

  const DIA_12000 = {
    desde: '2026-11-11', hasta: '2026-11-11', total: 12000, cantidad: 3,
    transacciones: [
      fila(3, 4, 6000, 'caja:bbb', '2026-11-11T20:11:17.767Z'),
      fila(2, 4, 3000, 'caja:bbb', '2026-11-11T20:11:17.767Z'),
      fila(1, 2, 3000, 'caja:aaa', '2026-11-11T20:11:14.981Z'),
    ],
  }

  it('al abrir la Caja (otra pestaña, otro equipo, otro cajero) muestra lo cobrado hoy, no $0', async () => {
    backend({ dia: DIA_12000 })
    montar()
    await waitFor(() => expect(screen.getByTestId('recaudado-hoy')).toHaveTextContent(/12\.000 RECAUDADO HOY/))
    expect(screen.getByRole('button', { name: /HISTORIAL DE PAGOS/ })).toHaveTextContent('2')
  })

  it('el Historial agrupa un cobro repartido en una fila y su total coincide con «Recaudado hoy»', async () => {
    backend({ dia: DIA_12000 })
    montar()
    await waitFor(() => expect(screen.getByTestId('recaudado-hoy')).toHaveTextContent(/12\.000/))
    fireEvent.click(screen.getByRole('button', { name: /HISTORIAL DE PAGOS/ }))
    const filas = screen.getAllByRole('row').slice(1, -1).map((r) => r.textContent.replace(/\s+/g, ' '))
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatch(/TRX-2 · TRX-3.*15:11.*Mesa 4.*9\.000/)
    expect(filas[1]).toMatch(/TRX-1.*15:11.*Mesa 2.*3\.000/)
    expect(screen.getByTestId('total-historial')).toHaveTextContent(/12\.000/)
  })

  it('después de cobrar vuelve a pedir el día: «Recaudado hoy» sube exactamente lo cobrado', async () => {
    const { consultasDia } = backend({
      dia: (_n, nCobros) => (nCobros === 0 ? DIA_12000 : {
        ...DIA_12000, total: 72000, cantidad: 5,
        transacciones: [fila(5, 1, 30000, 'caja:ccc', '2026-11-11T20:20:00.000Z'), fila(4, 1, 30000, 'caja:ccc', '2026-11-11T20:20:00.000Z'), ...DIA_12000.transacciones],
      }),
      cobro: () => json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [10, 11], transacciones: [{ id_transaccion: 4, id_pedido: 10, monto: 30000, comensal: null }, { id_transaccion: 5, id_pedido: 11, monto: 30000, comensal: null }] }, 201),
    })
    montar()
    await waitFor(() => expect(screen.getByTestId('recaudado-hoy')).toHaveTextContent(/12\.000/))
    await elegirMesa1YEfectivo()
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(screen.getByTestId('recaudado-hoy')).toHaveTextContent(/72\.000 RECAUDADO HOY/))
    expect(consultasDia.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button', { name: /HISTORIAL DE PAGOS/ })).toHaveTextContent('3')
  })

  it('si el backend no responde, «Recaudado hoy» dice «—» (no un $0 engañoso) y el Historial lo explica', async () => {
    backend({ dia: Object.assign(new TypeError('Failed to fetch')) })
    montar()
    await waitFor(() => expect(screen.getByTestId('recaudado-hoy')).toHaveTextContent(/^— RECAUDADO HOY$/))
    fireEvent.click(screen.getByRole('button', { name: /HISTORIAL DE PAGOS/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/No se pudo cargar el historial de hoy/)
  })

  it('ya no guarda nada en sessionStorage', async () => {
    sessionStorage.setItem('smartdining_caja_history', JSON.stringify([{ monto: 999 }]))
    backend({ dia: DIA_12000 })
    montar()
    await waitFor(() => expect(screen.getByTestId('recaudado-hoy')).toHaveTextContent(/12\.000/))
    expect(sessionStorage.getItem('smartdining_caja_history')).toBeNull()
  })
})

describe('Caja: efectivo con un total que no es múltiplo de 1.000', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    sesionComo('cajero')
  })

  it('saldo 34.500: el campo acepta 40.000 (antes step=1000 y min=total lo rechazaban en silencio) y se cobra', async () => {
    const { cobros } = backend({ saldoMesa1: 34500, cobro: () => json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [], transacciones: [] }, 201) })
    montar()
    await elegirMesa1YEfectivo('40000')
    expect(screen.getByLabelText(/efectivo recibido/i).checkValidity()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(cobros).toHaveLength(1))
    expect(cobros[0].monto).toBe(34500)
  })

  it('con propina (60.000 + 6.000) acepta 70.000 y el monto enviado sigue sin propina', async () => {
    const { cobros } = backend({ cobro: () => json({ duplicado: false, saldo_restante: 0, mesa_liberada: true, pagados: [], transacciones: [] }, 201) })
    montar()
    await elegirMesa1YEfectivo('70000')
    fireEvent.click(screen.getByRole('checkbox'))
    const input = screen.getByLabelText(/efectivo recibido/i)
    fireEvent.change(input, { target: { value: '66500' } })
    expect(input.checkValidity()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^cobrar/i }))
    await waitFor(() => expect(cobros).toHaveLength(1))
    expect(cobros[0].monto).toBe(60000)
  })
})

describe('Caja: acceso por rol', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it.each(['mesero', 'cocina'])('%s no entra: vuelve al inicio', (rol) => {
    sesionComo(rol)
    backend()
    montar()
    expect(screen.getByText('INICIO')).toBeInTheDocument()
  })

  it.each(['admin', 'cajero'])('%s sí entra', async (rol) => {
    sesionComo(rol)
    backend()
    montar()
    await waitFor(() => expect(screen.getByText('Mesa 1')).toBeInTheDocument())
  })
})

describe('transaccionesApi', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('cobrarMesa: POST /transacciones/mesa con exactamente los 5 campos del contrato', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(json({ duplicado: false }, 201))
    const { transaccionesApi } = await import('../../services/api')
    await transaccionesApi.cobrarMesa({ id_mesa: 3, monto: 1.15, metodo_pago: 'transferencia', id_cobro: 'x' })
    expect(spy.mock.calls[0][0]).toMatch(/\/transacciones\/mesa$/)
    expect(spy.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(spy.mock.calls[0][1].body)).toEqual({ id_mesa: 3, monto: 1.15, metodo_pago: 'transferencia', comensal: null, id_cobro: 'x' })
  })

  it('H-07: registrarPago omite cualquier estado_transaccion distinto a "completada"', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ id_transaccion: 101 }),
    })

    const { transaccionesApi } = await import('../../services/api')

    await transaccionesApi.registrarPago({ id_pedido: 1, monto: 15000, metodo_pago: 'efectivo', estado_transaccion: 'fallida' })
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).estado_transaccion).toBeUndefined()

    await transaccionesApi.registrarPago({ id_pedido: 1, monto: 15000, metodo_pago: 'efectivo', estado_transaccion: 'completada' })
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).estado_transaccion).toBe('completada')
  })
})
