import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SoloCocina, SEGUNDOS_PARA_IR_AL_KDS } from '../SoloCocina'
import { Login } from '../Login'
import { AuthProvider } from '../../context/AuthContext'
import { esCocina, urlDelKds } from '../../utils/kds'

const json = (body, status = 200) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })

describe('utils/kds', () => {
  it('esCocina: solo el rol cocina', () => {
    expect(['cocina', 'admin', 'mesero', 'cajero', undefined].map(esCocina)).toEqual([true, false, false, false, false])
  })

  it('urlDelKds: VITE_KDS_URL manda; si no, staff.<dominio> → cocina.<dominio>; si no, el puerto 5175', () => {
    expect(urlDelKds({ protocol: 'https:', hostname: 'staff.x.co' }, { VITE_KDS_URL: 'https://kds.otro.co/' })).toBe('https://kds.otro.co/')
    expect(urlDelKds({ protocol: 'https:', hostname: 'staff.staging.smartdining.co' }, {})).toBe('https://cocina.staging.smartdining.co/')
    expect(urlDelKds({ protocol: 'http:', hostname: 'localhost' }, {})).toBe('http://localhost:5175/')
    expect(urlDelKds({ protocol: 'http:', hostname: '192.168.1.20' }, { VITE_KDS_URL: '  ' })).toBe('http://192.168.1.20:5175/')
  })
})

describe('SoloCocina: aviso y paso al KDS', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('muestra el aviso y el enlace a la pantalla de cocina (sin «cerrar sesión»: no hay sesión)', () => {
    render(<SoloCocina irA={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/Tu usuario es de cocina/)
    expect(screen.getByRole('link', { name: 'IR A LA PANTALLA DE COCINA' })).toHaveAttribute('href', 'http://localhost:5175/')
    expect(screen.queryByRole('button', { name: /CERRAR SESIÓN/ })).toBeNull()
  })

  it(`a los ${SEGUNDOS_PARA_IR_AL_KDS} s lleva al KDS solo`, () => {
    const irA = vi.fn()
    render(<SoloCocina irA={irA} />)
    // Cada segundo se agenda después de su render: se avanza de a uno.
    const unSegundo = () => act(() => vi.advanceTimersByTime(1000))
    for (let s = 1; s < SEGUNDOS_PARA_IR_AL_KDS; s++) unSegundo()
    expect(irA).not.toHaveBeenCalled()
    expect(screen.getByText(/Te llevamos allá en 1 s/)).toBeInTheDocument()
    unSegundo()
    expect(irA).toHaveBeenCalledTimes(1)
    expect(irA).toHaveBeenCalledWith('http://localhost:5175/')
  })
})

describe('Login con rol cocina (revisión de Roberto en #213)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('no guarda sesión ni token, y muestra el aviso con el enlace al KDS', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ token: 'jwt-cocina', usuario: { id_usuario: 4, nombre: 'Chef', email: 'cocina@x.co', rol: 'cocina' } }))
    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )
    fireEvent.change(screen.getByPlaceholderText('admin@smartdining.com'), { target: { value: 'cocina@x.co' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'Admin123!' } })
    fireEvent.click(screen.getByRole('button', { name: /ingresar al sistema/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Tu usuario es de cocina/))
    expect(screen.getByRole('link', { name: 'IR A LA PANTALLA DE COCINA' })).toBeInTheDocument()
    expect(sessionStorage.getItem('smartdining_staff_user')).toBeNull()
    expect(sessionStorage.getItem('smartdining_token')).toBeNull()
  })

  it('llegando con state { cocina: true } (sesión vieja cerrada por AppContent) muestra el aviso', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { cocina: true } }]}>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Tu usuario es de cocina/)
  })
})
