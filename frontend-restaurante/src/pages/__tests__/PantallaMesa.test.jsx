import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Socket de la tablet simulado: guarda los oyentes para disparar eventos.
const socket = { id: 'sock-tablet-1234', oyentes: {}, on(ev, cb) { this.oyentes[ev] = cb }, disconnect: vi.fn() }
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socket) }))

const servicios = vi.hoisted(() => ({
  solicitarTokenPantalla: vi.fn(),
  notificarQrRotado: vi.fn(),
  rotarTokenQrMesa: vi.fn(),
  decodificarTokenQr: vi.fn(() => ({ sid: 'SID-ABC' })),
}))
vi.mock('../../services/qrService', () => servicios)

let estadoTablas = { tables: [], pedidosActivos: [] }
vi.mock('../../hooks', () => ({ useTables: () => estadoTablas }))

import { PantallaMesa } from '../PantallaMesa'

const mesa3 = { id: 3, number: 3, location: 'Terraza', token_qr: 'tok-viejo', qr_url: 'http://192.168.1.9:5174/?token=tok-viejo&mesa=3' }

function montar() {
  render(
    <MemoryRouter initialEntries={['/pantalla/mesa/3']}>
      <Routes>
        <Route path="/pantalla/mesa/:id" element={<PantallaMesa />} />
        <Route path="/mesas" element={<p>PANEL DE MESAS</p>} />
      </Routes>
    </MemoryRouter>
  )
}

// El enlace que va dentro del QR se ve en los ajustes técnicos.
const enlaceDelQr = () => {
  fireEvent.click(screen.getByTitle('Ajustes técnicos'))
  const valor = screen.getAllByDisplayValue(/http/).map((i) => i.value).find((v) => v.includes('mesa='))
  fireEvent.click(screen.getByText('✕'))
  return valor
}

const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('PantallaMesa (tablet con el QR de la mesa)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    socket.oyentes = {}
    socket.disconnect.mockClear()
    for (const f of Object.values(servicios)) f.mockClear()
    servicios.solicitarTokenPantalla.mockResolvedValue({ token: 'jwt-pantalla-0123456789abcdefghijklmnop' })
    servicios.rotarTokenQrMesa.mockResolvedValue({ token: 'tok-rotado', url: 'http://192.168.1.9:5174/?token=tok-rotado&mesa=3' })
    estadoTablas = { tables: [mesa3], pedidosActivos: [] }
  })
  afterEach(() => vi.useRealTimers())

  it('muestra la mesa y su sector, y el QR lleva el enlace del backend con su token', async () => {
    montar()
    await tick()
    expect(screen.getByRole('heading', { name: 'MESA 3' })).toBeInTheDocument()
    expect(screen.getByText('Sector: Terraza')).toBeInTheDocument()
    expect(screen.getByText('Sesión activa · sid: SID-ABC')).toBeInTheDocument()
    expect(enlaceDelQr()).toBe('http://192.168.1.9:5174/?token=tok-viejo&mesa=3')
  })

  it('pide su credencial de pantalla y, al conectar el socket, dice EN VIVO', async () => {
    montar()
    await tick()
    expect(servicios.solicitarTokenPantalla).toHaveBeenCalledWith(3)
    expect(screen.getByText('SIN CONEXIÓN')).toBeInTheDocument()
    act(() => socket.oyentes.connect())
    expect(screen.getByText('EN VIVO')).toBeInTheDocument()
    act(() => socket.oyentes.disconnect())
    expect(screen.getByText('SIN CONEXIÓN')).toBeInTheDocument()
  })

  it('si no consigue la credencial, lo muestra y no se conecta', async () => {
    servicios.solicitarTokenPantalla.mockRejectedValue(new Error('No autorizado para la pantalla'))
    montar()
    await tick()
    expect(screen.getByRole('alert')).toHaveTextContent('No autorizado para la pantalla')
    expect(socket.oyentes.connect).toBeUndefined()
  })

  it('qr:actualizado por el socket: el QR cambia en vivo y avisa que se renovó', async () => {
    montar()
    await tick()
    act(() => socket.oyentes['qr:actualizado']({ token_qr: 'tok-en-vivo', url: 'http://192.168.1.9:5174/?token=tok-en-vivo&mesa=3' }))
    expect(screen.getByText('¡Código QR renovado automáticamente para tu mesa!')).toBeInTheDocument()
    expect(enlaceDelQr()).toBe('http://192.168.1.9:5174/?token=tok-en-vivo&mesa=3')
    await tick(3100)
    expect(screen.queryByText('¡Código QR renovado automáticamente para tu mesa!')).toBeNull()
  })

  it('ROTAR QR pide un token nuevo y lo pone en el QR', async () => {
    montar()
    await tick()
    fireEvent.click(screen.getByTitle('Rotar código QR'))
    await tick()
    expect(servicios.rotarTokenQrMesa).toHaveBeenCalledWith(3)
    expect(enlaceDelQr()).toBe('http://192.168.1.9:5174/?token=tok-rotado&mesa=3')
  })

  it('sin comensales rota sola a los 3 minutos', async () => {
    montar()
    await tick()
    await tick(179 * 1000)
    expect(servicios.rotarTokenQrMesa).not.toHaveBeenCalled()
    await tick(1000)
    expect(servicios.rotarTokenQrMesa).toHaveBeenCalledTimes(1)
  })

  it('con comensales (pedidos vivos) NO rota: la sesión sigue igual', async () => {
    estadoTablas = { tables: [mesa3], pedidosActivos: [{ id_pedido: 1, id_mesa: 3, estado: 'recibido' }] }
    montar()
    await tick()
    expect(screen.getByText(/Sesión en curso/)).toBeInTheDocument()
    await tick(200 * 1000)
    expect(servicios.rotarTokenQrMesa).not.toHaveBeenCalled()
  })

  it('PAUSA detiene la rotación automática', async () => {
    montar()
    await tick()
    fireEvent.click(screen.getByTitle('Pausar rotación automática'))
    await tick(200 * 1000)
    expect(servicios.rotarTokenQrMesa).not.toHaveBeenCalled()
  })

  it('si el enlace apunta a localhost avisa que un celular no podrá abrirlo', async () => {
    estadoTablas = { tables: [{ ...mesa3, qr_url: 'http://localhost:5174/?token=tok-viejo&mesa=3' }], pedidosActivos: [] }
    montar()
    await tick()
    expect(screen.getByText(/El QR apunta a localhost: un celular no podrá abrirlo/)).toBeInTheDocument()
  })

  it('SALIR vuelve al panel de mesas y al desmontar se desconecta el socket', async () => {
    montar()
    await tick()
    fireEvent.click(screen.getByTitle('Volver al panel'))
    expect(screen.getByText('PANEL DE MESAS')).toBeInTheDocument()
    expect(socket.disconnect).toHaveBeenCalled()
  })
})
