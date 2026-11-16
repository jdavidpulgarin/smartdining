import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// Regresión v1.0.0 (FALLO 1): la tablet de la mesa SIN sesión del personal.
// qrService real; el servidor responde por ruta (fetch) y el socket se simula.
const sockets = []
vi.mock('socket.io-client', () => ({
  io: vi.fn((url, opciones) => {
    const s = { opciones, oyentes: {}, on(ev, cb) { this.oyentes[ev] = cb }, disconnect: vi.fn() }
    sockets.push(s)
    return s
  }),
}))
// La tablet no tiene sesión: el contexto de mesas está vacío.
const contextoVacio = { tables: [], pedidosActivos: [], cargarMesas: () => {} }
vi.mock('../../hooks', () => ({ useTables: () => contextoVacio }))

import { PantallaMesa } from '../PantallaMesa'

// La mesa 13 tiene id_mesa 10 (mesas de id ≠ número).
const QR = 'http://192.168.1.9:5174/mesa/10?token=v1.abc.def'
const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body,
})
let estadoMesa
let llamadas
function servidor() {
  llamadas = []
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init = {}) => {
    const ruta = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api/, '')
    llamadas.push(`${(init.method || 'GET').toUpperCase()} ${ruta}`)
    if (ruta === '/auth/login') return json({ usuario: { rol: 'mesero' }, token: 'jwt-del-mesero' })
    if (ruta === '/qr/pantalla') return json({ token: 'jwt-pantalla-nuevo', id_mesa: 10 }, 201)
    if (ruta === '/mesas/10') return json({ id_mesa: 10, numero: 13, estado: estadoMesa, activa: true })
    if (ruta === '/mesas/10/abrir') return json({ token: 'v1.vig.ente', url: 'http://192.168.1.9:5174/mesa/10?token=v1.vig.ente', reutilizado: true }, 201)
    return json({}, 404)
  })
}
const espera = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }
async function abrir(ruta) {
  window.history.replaceState(null, '', ruta)
  render(
    <MemoryRouter initialEntries={[ruta.split('#')[0]]}>
      <Routes>
        <Route path="/pantalla/mesa/:id" element={<PantallaMesa />} />
      </Routes>
    </MemoryRouter>
  )
  await espera()
  await espera()
}
const qrDibujado = () => document.querySelector('.sd-pantalla-qr-white-frame svg')
const nadaDelPersonal = () => {
  const todo = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage })
  expect(todo).not.toContain('jwt-del-mesero')
  expect(sessionStorage.getItem('smartdining_token')).toBeNull()
  expect(sessionStorage.getItem('smartdining_staff_user')).toBeNull()
}

beforeEach(() => {
  vi.restoreAllMocks()
  sockets.length = 0
  sessionStorage.clear()
  localStorage.clear()
  estadoMesa = 'ocupada'
  servidor()
})

describe('PantallaMesa: tablet lanzada desde el panel (credencial y QR en el #)', () => {
  it('toma la credencial y el QR del #, los guarda, quita el # y se conecta como la mesa del id', async () => {
    await abrir(`/pantalla/mesa/10#${new URLSearchParams({ t: 'jwt-pantalla-10', qr: QR })}`)
    expect(window.location.hash).toBe('')
    expect(localStorage.getItem('smartdining_pantalla_token_10')).toBe('jwt-pantalla-10')
    expect(localStorage.getItem('smartdining_pantalla_qr_10')).toBe(QR)
    expect(sockets).toHaveLength(1)
    expect(sockets[0].opciones.auth).toEqual({ token: 'jwt-pantalla-10' })
    expect(qrDibujado()).toBeTruthy()
    // El número que se ve es el de la mesa (13), no el id de la ruta (10).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('MESA 13')
    // Sin sesión del personal: ni ROTAR QR (daría 401) ni /abrir.
    expect(screen.queryByTitle('Rotar código QR')).toBeNull()
    expect(screen.getByTitle('Configurar pantalla (personal)')).toBeInTheDocument()
    expect(llamadas).toEqual(['GET /mesas/10'])
    nadaDelPersonal()
  })

  it('al recargar (sin #) sigue con lo guardado; si la mesa quedó libre: «Mesa disponible» y olvida el QR', async () => {
    localStorage.setItem('smartdining_pantalla_token_10', 'jwt-pantalla-10')
    localStorage.setItem('smartdining_pantalla_qr_10', QR)
    estadoMesa = 'disponible'
    await abrir('/pantalla/mesa/10')
    expect(sockets[0].opciones.auth).toEqual({ token: 'jwt-pantalla-10' })
    expect(screen.getByTestId('tablet-mesa-disponible')).toBeInTheDocument()
    expect(localStorage.getItem('smartdining_pantalla_qr_10')).toBeNull()
    expect(llamadas.some((l) => l.endsWith('/abrir'))).toBe(false)
  })

  it('qr:actualizado (solo trae el token): dibuja y guarda la url con el token nuevo', async () => {
    await abrir(`/pantalla/mesa/10#${new URLSearchParams({ t: 'jwt-pantalla-10', qr: QR })}`)
    act(() => sockets[0].oyentes['qr:actualizado']({ id_mesa: 10, token_qr: 'v1.nuevo.zz' }))
    expect(localStorage.getItem('smartdining_pantalla_qr_10')).toBe('http://192.168.1.9:5174/mesa/10?token=v1.nuevo.zz')
    act(() => sockets[0].oyentes['mesa:liberada']({ id_mesa: 10 }))
    expect(screen.getByTestId('tablet-mesa-disponible')).toBeInTheDocument()
    expect(localStorage.getItem('smartdining_pantalla_qr_10')).toBeNull()
  })

  it('tablet preparada con la mesa libre: al abrirla llega qr:actualizado (solo token) → dibuja y lo guarda', async () => {
    estadoMesa = 'disponible'
    await abrir('/pantalla/mesa/10#t=jwt-pantalla-10')
    expect(screen.getByTestId('tablet-mesa-disponible')).toBeInTheDocument()
    act(() => sockets[0].oyentes['qr:actualizado']({ id_mesa: 10, token_qr: 'v1.al.abrir' }))
    expect(qrDibujado()).toBeTruthy()
    expect(localStorage.getItem('smartdining_pantalla_qrtoken_10')).toBe('v1.al.abrir')
  })

  it('credencial rechazada por el socket: se olvida y pide configurar', async () => {
    await abrir(`/pantalla/mesa/10#${new URLSearchParams({ t: 'jwt-vencido' })}`)
    act(() => sockets[0].oyentes.connect_error(new Error('TOKEN_INVALIDO')))
    expect(localStorage.getItem('smartdining_pantalla_token_10')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Configurar pantalla' })).toBeInTheDocument()
  })
})

describe('PantallaMesa: tablet física sin credencial (login de una sola vez)', () => {
  const configurar = async () => {
    fireEvent.change(screen.getByLabelText('Correo del personal'), { target: { value: 'mesero@x.com' } })
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'clave' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Configurar' })) })
    await espera()
  }

  it('sin credencial no se conecta: pide configurar (y no muestra un QR)', async () => {
    await abrir('/pantalla/mesa/10')
    expect(sockets).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'Configurar pantalla' })).toBeInTheDocument()
    expect(qrDibujado()).toBeFalsy()
  })

  it('mesa LIBRE: login → credencial → GET; NUNCA /abrir; «Mesa disponible»; la sesión no queda', async () => {
    estadoMesa = 'disponible'
    await abrir('/pantalla/mesa/10')
    await configurar()
    expect(llamadas).toEqual(['GET /mesas/10', 'POST /auth/login', 'POST /qr/pantalla', 'GET /mesas/10'])
    expect(llamadas.some((l) => l.endsWith('/abrir'))).toBe(false)
    expect(screen.getByTestId('tablet-mesa-disponible')).toBeInTheDocument()
    expect(localStorage.getItem('smartdining_pantalla_token_10')).toBe('jwt-pantalla-nuevo')
    expect(sockets.at(-1).opciones.auth).toEqual({ token: 'jwt-pantalla-nuevo' })
    expect(screen.queryByRole('dialog', { name: 'Configurar pantalla' })).toBeNull()
    nadaDelPersonal()
  })

  it('mesa OCUPADA: después del GET pide el QR vigente con /abrir y lo dibuja', async () => {
    await abrir('/pantalla/mesa/10')
    await configurar()
    expect(llamadas.slice(1)).toEqual(['POST /auth/login', 'POST /qr/pantalla', 'GET /mesas/10', 'POST /mesas/10/abrir'])
    expect(qrDibujado()).toBeTruthy()
    expect(localStorage.getItem('smartdining_pantalla_qr_10')).toContain('v1.vig.ente')
    nadaDelPersonal()
  })
})
