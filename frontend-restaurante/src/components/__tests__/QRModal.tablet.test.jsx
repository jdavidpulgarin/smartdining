import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// Regresión v1.0.0 (FALLO 1): «Lanzar Pantalla» y «Copiar URL Tablet» le
// preparan a la tablet su credencial y el QR vigente, por id_mesa.
vi.mock('../../hooks', () => ({
  useSocketListener: () => {},
  useTables: () => ({ pedidosActivos: [], presenciaPorMesa: { 10: { total: 1 } } }),
}))

import { QRModal } from '../QRModal'
import { leerFragmentoTablet } from '../../utils/enlaceTablet'

const QR = 'http://192.168.1.9:5174/mesa/10?token=v1.abc.def'
const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
let estadoMesa
let llamadas
// La mesa 13 tiene id_mesa 10.
const mesa13 = (extra = {}) => ({ id: 10, id_mesa: 10, number: 13, numero: 13, name: 'Mesa 13', status: 'Ocupada', estado: 'ocupada', token_qr: 'v1.abc.def', qr_url: QR, comensales: ['Ana'], ...extra })

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  sessionStorage.setItem('smartdining_staff_user', JSON.stringify({ token: 'jwt-del-panel' }))
  estadoMesa = 'ocupada'
  llamadas = []
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init = {}) => {
    const ruta = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '')
    llamadas.push(`${(init.method || 'GET').toUpperCase()} ${ruta}`)
    if (ruta === '/qr/pantalla') return json({ token: 'jwt-pantalla-10', id_mesa: 10 }, 201)
    if (ruta === '/mesas/10') return json({ id_mesa: 10, numero: 13, estado: estadoMesa })
    if (ruta === '/mesas/10/abrir') return json({ token: 'v1.abc.def', url: QR, reutilizado: true }, 201)
    return json({}, 404)
  })
})

function abrirVentana() {
  // La pestaña nueva nace con una COPIA del sessionStorage del panel (la sesión del personal).
  const ventana = { opener: {}, location: { replace: vi.fn() }, close: vi.fn(), sessionStorage: { clear: vi.fn() } }
  const open = vi.spyOn(window, 'open').mockReturnValue(ventana)
  return { ventana, open }
}

describe('QRModal: la tablet de la mesa', () => {
  it('«Lanzar Pantalla» abre /pantalla/mesa/<id_mesa> (10, no el número 13) con credencial y QR en el #', async () => {
    const { ventana, open } = abrirVentana()
    render(<QRModal table={mesa13()} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Lanzar Pantalla/ })) })
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(llamadas).toEqual(['POST /qr/pantalla', 'GET /mesas/10', 'POST /mesas/10/abrir'])
    const enlace = ventana.location.replace.mock.calls[0][0]
    expect(enlace.startsWith(`${window.location.origin}/pantalla/mesa/10#`)).toBe(true)
    expect(leerFragmentoTablet(enlace.split('#')[1])).toEqual({ credencial: 'jwt-pantalla-10', qrUrl: QR, token: 'v1.abc.def' })
    expect(ventana.opener).toBeNull()
    // La tablet no se lleva la sesión del personal: se vacía ANTES de cargarla.
    expect(ventana.sessionStorage.clear).toHaveBeenCalled()
    expect(ventana.sessionStorage.clear.mock.invocationCallOrder[0]).toBeLessThan(ventana.location.replace.mock.invocationCallOrder[0])
  })

  it('con la mesa libre la tablet se prepara SIN llamar a /abrir', async () => {
    estadoMesa = 'disponible'
    const { ventana } = abrirVentana()
    render(<QRModal table={mesa13({ status: 'Disponible', estado: 'disponible', token_qr: null, qr_url: null })} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Lanzar Pantalla/ })) })
    expect(llamadas.some((l) => l.endsWith('/abrir'))).toBe(false)
    expect(ventana.location.replace).toHaveBeenCalledWith(`${window.location.origin}/pantalla/mesa/10#t=jwt-pantalla-10`)
  })

  it('«Copiar URL Tablet» copia el mismo enlace con la credencial en el #', async () => {
    const escribir = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true })
    render(<QRModal table={mesa13()} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Copiar URL Tablet/ })) })
    const enlace = escribir.mock.calls[0][0]
    expect(enlace.startsWith(`${window.location.origin}/pantalla/mesa/10#`)).toBe(true)
    expect(leerFragmentoTablet(enlace.split('#')[1]).credencial).toBe('jwt-pantalla-10')
    expect(screen.getByRole('button', { name: /Copiada/ })).toBeInTheDocument()
  })

  it('si no se puede preparar (socket caído), cierra la pestaña y lo dice en el modal', async () => {
    global.fetch.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
    const { ventana } = abrirVentana()
    render(<QRModal table={mesa13()} onClose={() => {}} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Lanzar Pantalla/ })) })
    expect(ventana.close).toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/credencial de la pantalla/)
  })
})
