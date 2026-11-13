import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const socket = { id: 'sock-1', oyentes: {}, on(ev, cb) { this.oyentes[ev] = cb }, disconnect: vi.fn() }
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

const conToken = { id: 3, number: 3, location: 'Terraza', token_qr: 'tok-real', qr_url: 'http://192.168.1.9:5174/?token=tok-real&mesa=3' }

function montar() {
  const r = render(
    <MemoryRouter initialEntries={['/pantalla/mesa/3']}>
      <Routes>
        <Route path="/pantalla/mesa/:id" element={<PantallaMesa />} />
      </Routes>
    </MemoryRouter>
  )
  return r.container
}
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

describe('PantallaMesa: sin datos inventados ni botones de desarrollo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    socket.oyentes = {}
    for (const f of Object.values(servicios)) f.mockClear()
    servicios.solicitarTokenPantalla.mockResolvedValue({ token: 'jwt-pantalla-secreto-0123456789abcdef' })
    estadoTablas = { tables: [conToken], pedidosActivos: [] }
  })
  afterEach(() => vi.useRealTimers())

  it('sin token de la mesa NO dibuja un QR inventado: espera el código real', async () => {
    estadoTablas = { tables: [{ ...conToken, token_qr: null, qr_url: null }], pedidosActivos: [] }
    const raiz = montar()
    await tick()
    expect(raiz.querySelector('svg[viewBox]')?.closest('.sd-pantalla-qr-white-frame')).toBeFalsy()
    expect(screen.getByRole('status')).toHaveTextContent(/Esperando el código QR de la mesa/)
    expect(document.body.textContent).not.toMatch(/demo/)
    expect(screen.queryByText(/sid:/)).toBeNull()
  })

  it('el QR llega por qr:actualizado y entonces sí se dibuja', async () => {
    estadoTablas = { tables: [{ ...conToken, token_qr: null, qr_url: null }], pedidosActivos: [] }
    const raiz = montar()
    await tick()
    act(() => socket.oyentes['qr:actualizado']({ token_qr: 'tok-nuevo', url: 'http://192.168.1.9:5174/?token=tok-nuevo&mesa=3' }))
    expect(raiz.querySelector('.sd-pantalla-qr-white-frame svg')).toBeTruthy()
    expect(screen.queryByText(/Esperando el código QR/)).toBeNull()
  })

  it('no muestra red Wi-Fi ni clave inventadas, ni versión falsa, ni el id del socket', async () => {
    montar()
    await tick()
    act(() => socket.oyentes.connect())
    const texto = document.body.textContent
    expect(texto).not.toMatch(/SmartDining_Invitados|Gourmet2026|RED WI-FI INVITADOS/)
    expect(texto).not.toMatch(/Kiosk v2\.4/)
    expect(texto).not.toMatch(/sock-1/)
  })

  it('los ajustes no muestran la credencial JWT ni los botones de desarrollo', async () => {
    montar()
    await tick()
    fireEvent.click(screen.getByTitle('Ajustes técnicos'))
    expect(screen.queryByText(/CREDENCIAL JWT/)).toBeNull()
    expect(screen.queryByDisplayValue(/jwt-pantalla/)).toBeNull()
    expect(screen.queryByText(/Simular evento qr:actualizado/)).toBeNull()
    expect(screen.queryByText(/Rotar QR oficial/)).toBeNull()
    // Lo operativo para la demo por Wi-Fi sigue: IP, puerto y enlace.
    expect(screen.getByText('ENLACE CODIFICADO:')).toBeInTheDocument()
    expect(screen.getByText('PUERTO DEL CLIENTE (PWA):')).toBeInTheDocument()
  })

  it('si falla la rotación lo avisa en la tablet (antes solo iba a la consola)', async () => {
    servicios.rotarTokenQrMesa.mockRejectedValue(new Error('Sin conexión con el servidor'))
    montar()
    await tick()
    fireEvent.click(screen.getByTitle('Rotar código QR'))
    await tick()
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo renovar el QR: Sin conexión con el servidor')
  })

  it('una rotación buena después de un fallo quita el aviso', async () => {
    servicios.rotarTokenQrMesa.mockRejectedValueOnce(new Error('falló')).mockResolvedValueOnce({ token: 'tok-2' })
    montar()
    await tick()
    fireEvent.click(screen.getByTitle('Rotar código QR'))
    await tick()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Rotar código QR'))
    await tick()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
