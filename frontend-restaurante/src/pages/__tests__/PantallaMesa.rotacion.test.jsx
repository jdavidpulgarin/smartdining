import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// T3: la tablet de la mesa (PantallaMesa) rota sola cada 3 min. Esa rotación
// automática tiene que pedir solo_si_vacia (el backend da 409
// mesa_con_comensales si hay alguien, también quien entró con su nombre y aún
// no pidió); el botón manual sigue forzándola.
const MESA = { id: 1, number: 1, id_mesa: 1, estado: 'ocupada', token_qr: 'tok-viejo', qr_url: 'http://192.168.1.36:5174/mesa/1?token=tok-viejo', comensales: [] }

vi.mock('../../hooks', () => ({ useTables: () => ({ tables: [MESA], pedidosActivos: [] }) }))
const rotar = vi.fn()
vi.mock('../../services/qrService', () => ({
  solicitarTokenPantalla: () => new Promise(() => {}),
  notificarQrRotado: vi.fn(),
  rotarTokenQrMesa: (...args) => rotar(...args),
  decodificarTokenQr: () => ({ sid: 'abc' }),
}))
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), disconnect: vi.fn(), connected: false }) }))

import { PantallaMesa } from '../PantallaMesa'

function montar() {
  render(
    <MemoryRouter initialEntries={['/pantalla/1']}>
      <Routes>
        <Route path="/pantalla/:id" element={<PantallaMesa />} />
      </Routes>
    </MemoryRouter>
  )
}

// Un tic por segundo del temporizador de la tablet: se avanza de a 30 s para
// que React procese los cambios de estado sin hacer 181 act() seguidos.
const tresMinutos = async () => {
  for (let i = 0; i < 7; i++) await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
}

describe('PantallaMesa: la tablet no rota el QR por su cuenta (T3)', { timeout: 20000 }, () => {
  beforeEach(() => {
    vi.useFakeTimers()
    rotar.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('pasan 6 minutos y la tablet NO llama a rotar-qr (lo hace el socket-server con la mesa vacía)', async () => {
    rotar.mockResolvedValue({ token: 'tok-nuevo', url: 'http://192.168.1.36:5174/mesa/1?token=tok-nuevo' })
    montar()
    await tresMinutos()
    await tresMinutos()
    expect(rotar).not.toHaveBeenCalled()
  })

  it('el botón manual pide solo_si_vacia', async () => {
    rotar.mockResolvedValue({ token: 'tok-nuevo', url: 'http://192.168.1.36:5174/mesa/1?token=tok-nuevo' })
    montar()
    await act(async () => { fireEvent.click(screen.getByTitle('Rotar código QR')) })
    expect(rotar).toHaveBeenCalledWith(1, undefined, { soloSiVacia: true })
  })

  it('con gente en la mesa (409 mesa_con_comensales) el QR se queda y lo dice', async () => {
    rotar.mockRejectedValue(Object.assign(new Error('La mesa tiene comensales'), { status: 409, motivo: 'mesa_con_comensales' }))
    montar()
    await act(async () => { fireEvent.click(screen.getByTitle('Rotar código QR')) })
    expect(screen.getByText('La mesa ya tiene comensales: el QR queda fijo.')).toBeInTheDocument()
  })
})
