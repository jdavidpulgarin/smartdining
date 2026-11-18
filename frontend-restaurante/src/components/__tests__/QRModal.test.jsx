import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// Sin socket ni contexto real: el modal solo lee pedidosActivos y escucha qr:actualizado.
let pedidosActivos = []
let presenciaPorMesa = {}
vi.mock('../../hooks', () => ({
  useSocketListener: () => {},
  useTables: () => ({ pedidosActivos, presenciaPorMesa }),
}))

import { QRModal } from '../QRModal'

const T0 = 'v1.dmllam8.firma0'
const T1 = 'v1.bnVldm8x.firma1'
const T2 = 'v1.bnVldm8y.firma2'
const url = (t) => `http://localhost:5174/?token=${t}`
const mesa = (extra = {}) => ({ id: 5, number: 5, name: 'Mesa 5', status: 'ocupada', token_qr: T0, qr_url: url(T0), ...extra })
const enlace = () => screen.getByLabelText('Enlace del comensal').value
const copiar = () => screen.getByRole('button', { name: /^Copiar$/ })
const err = (status, extra = {}) => Object.assign(new Error(`Error ${status}`), { status, ...extra })

async function avanzar(segundos) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(segundos * 1000)
  })
}

function montar(table, onUpdateToken) {
  return render(<QRModal table={table} onClose={() => {}} onUpdateToken={onUpdateToken} />)
}

describe('QRModal: QR vigente (rotación del socket-server cada 3 min)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pedidosActivos = []
    presenciaPorMesa = {}
  })
  afterEach(() => vi.useRealTimers())

  it('al abrirse con la mesa vacía pide un QR nuevo (silencioso) y no enseña el viejo mientras tanto', async () => {
    let soltar
    const onUpdateToken = vi.fn(() => new Promise((r) => { soltar = () => r({ token: T1, url: url(T1) }) }))
    montar(mesa(), onUpdateToken)
    expect(onUpdateToken).toHaveBeenCalledWith(5, { silencioso: true, soloSiVacia: true })
    expect(screen.getByText('Generando QR vigente…')).toBeInTheDocument()
    expect(enlace()).toBe('')
    expect(copiar()).toBeDisabled()
    await act(async () => soltar())
    expect(enlace()).toContain(T1)
    expect(copiar()).toBeEnabled()
  })

  it('con comensales NO rota: muestra el QR que hay y «Nuevo QR» queda deshabilitado', async () => {
    const onUpdateToken = vi.fn()
    montar(mesa({ comensales: ['Ana'] }), onUpdateToken)
    await avanzar(400)
    expect(onUpdateToken).not.toHaveBeenCalled()
    expect(enlace()).toContain(T0)
    expect(screen.getByRole('button', { name: /Nuevo QR/ })).toBeDisabled()
    expect(screen.getByText(/el QR queda fijo/)).toBeInTheDocument()
  })

  it('con presencia en vivo (mesa:presencia) tampoco rota: el caso de la e2e con Carla dentro', async () => {
    presenciaPorMesa = { 5: { id_mesa: 5, comensales: ['Carla'], total: 1, pagaron: [], sin_celular: [] } }
    const onUpdateToken = vi.fn()
    montar(mesa(), onUpdateToken)
    await avanzar(400)
    expect(onUpdateToken).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Nuevo QR/ })).toBeDisabled()
  })

  it('con alguien sin celular registrado (sin_celular) tampoco rota', async () => {
    presenciaPorMesa = { 5: { id_mesa: 5, comensales: [], total: 0, pagaron: [], sin_celular: ['Abuela'] } }
    const onUpdateToken = vi.fn()
    montar(mesa(), onUpdateToken)
    await avanzar(30)
    expect(onUpdateToken).not.toHaveBeenCalled()
  })

  it('con un pedido activo de la mesa tampoco rota', async () => {
    pedidosActivos = [{ id_pedido: 1, id_mesa: 5, estado: 'recibido' }]
    const onUpdateToken = vi.fn()
    montar(mesa(), onUpdateToken)
    await avanzar(400)
    expect(onUpdateToken).not.toHaveBeenCalled()
  })

  it('con el modal abierto lo renueva antes de los 3 minutos del socket-server', async () => {
    const onUpdateToken = vi.fn()
      .mockResolvedValueOnce({ token: T1, url: url(T1) })
      .mockResolvedValueOnce({ token: T2, url: url(T2) })
    montar(mesa(), onUpdateToken)
    await avanzar(1)
    expect(enlace()).toContain(T1)
    await avanzar(160)
    expect(onUpdateToken).toHaveBeenCalledTimes(1)
    await avanzar(6)
    expect(onUpdateToken).toHaveBeenCalledTimes(2)
    expect(onUpdateToken).toHaveBeenLastCalledWith(5, { silencioso: true, soloSiVacia: true })
    expect(enlace()).toContain(T2)
  })

  it('si la renovación por tiempo falla sin reintento, no insiste cada segundo: a los 3 min queda «QR vencido»', async () => {
    const onUpdateToken = vi.fn()
      .mockResolvedValueOnce({ token: T1, url: url(T1) })
      .mockRejectedValue(err(500))
    montar(mesa(), onUpdateToken)
    await avanzar(1)
    await avanzar(166)
    expect(onUpdateToken).toHaveBeenCalledTimes(2)
    await avanzar(60)
    expect(onUpdateToken).toHaveBeenCalledTimes(2)
    expect(screen.getByText('QR vencido')).toBeInTheDocument()
    expect(screen.getByText(/No se pudo generar el QR nuevo/)).toBeInTheDocument()
  })

  it('auto-renovación pausada: a los 3 minutos «QR vencido · Generar nuevo», sin enlace para copiar', async () => {
    const onUpdateToken = vi.fn()
      .mockResolvedValueOnce({ token: T1, url: url(T1) })
      .mockResolvedValueOnce({ token: T2, url: url(T2) })
    montar(mesa(), onUpdateToken)
    await avanzar(1)
    fireEvent.click(screen.getByRole('button', { name: /Pausar/ }))
    await avanzar(185)
    expect(onUpdateToken).toHaveBeenCalledTimes(1)
    expect(screen.getByText('QR vencido')).toBeInTheDocument()
    expect(enlace()).toBe('')
    expect(copiar()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Generar nuevo' }))
    await avanzar(1)
    expect(onUpdateToken).toHaveBeenLastCalledWith(5, { silencioso: false, soloSiVacia: false })
    expect(enlace()).toContain(T2)
    expect(screen.queryByText('QR vencido')).not.toBeInTheDocument()
  })

  it('503: lo dice y reintenta a los 10 s; al reintento bueno muestra el QR nuevo', async () => {
    const onUpdateToken = vi.fn()
      .mockRejectedValueOnce(err(503))
      .mockResolvedValueOnce({ token: T1, url: url(T1) })
    montar(mesa(), onUpdateToken)
    await avanzar(1)
    expect(screen.getByText(/servidor de tiempo real no responde.*Reintentando/)).toBeInTheDocument()
    expect(enlace()).toBe('')
    await avanzar(10)
    expect(onUpdateToken).toHaveBeenCalledTimes(2)
    expect(enlace()).toContain(T1)
  })

  it('sin conexión: reintenta como mucho 3 veces y se queda en «QR vencido» (sin QR inventado)', async () => {
    const onUpdateToken = vi.fn().mockRejectedValue(Object.assign(new Error('Sin conexión'), { sinConexion: true }))
    montar(mesa(), onUpdateToken)
    await avanzar(60)
    expect(onUpdateToken).toHaveBeenCalledTimes(4)
    expect(screen.getByText('QR vencido')).toBeInTheDocument()
    expect(enlace()).toBe('')
  })

  it('404 y 409 de mesa no abierta: mensaje claro y sin reintentos', async () => {
    const onUpdateToken = vi.fn().mockRejectedValue(err(409))
    montar(mesa(), onUpdateToken)
    await avanzar(30)
    expect(onUpdateToken).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/ya no está abierta/)).toBeInTheDocument()
  })

  it('409 mesa_con_comensales: el QR queda fijo y no vuelve a intentar rotar', async () => {
    const onUpdateToken = vi.fn().mockRejectedValue(err(409, { motivo: 'mesa_con_comensales' }))
    montar(mesa(), onUpdateToken)
    await avanzar(400)
    expect(onUpdateToken).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/ya tiene comensales: el QR queda fijo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Nuevo QR/ })).toBeDisabled()
    expect(enlace()).toContain(T0)
  })
})
