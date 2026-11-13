import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SoloCocina, SEGUNDOS_PARA_IR_AL_KDS } from '../SoloCocina'
import { AuthProvider } from '../../context/AuthContext'
import { esCocina, urlDelKds } from '../../utils/kds'

function sesionComo(rol) {
  sessionStorage.setItem('smartdining_token', 'test-token')
  sessionStorage.setItem(
    'smartdining_staff_user',
    JSON.stringify({ id: 9, id_usuario: 9, nombre: 'Chef', email: 'cocina@mail.com', rol, role: rol })
  )
}

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

describe('SoloCocina: el rol cocina no usa el panel', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sesionComo('cocina')
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  function montar(irA) {
    render(
      <AuthProvider>
        <MemoryRouter>
          <SoloCocina irA={irA} />
        </MemoryRouter>
      </AuthProvider>
    )
  }

  it('muestra el aviso y el enlace a la pantalla de cocina', () => {
    montar(vi.fn())
    expect(screen.getByRole('alert')).toHaveTextContent(/Tu usuario es de cocina/)
    expect(screen.getByRole('link', { name: 'IR A LA PANTALLA DE COCINA' })).toHaveAttribute('href', 'http://localhost:5175/')
  })

  it(`a los ${SEGUNDOS_PARA_IR_AL_KDS} s lleva al KDS solo y cierra la sesión del panel`, () => {
    const irA = vi.fn()
    montar(irA)
    // Cada segundo se agenda después de su render: se avanza de a uno.
    const unSegundo = () => act(() => vi.advanceTimersByTime(1000))
    for (let s = 1; s < SEGUNDOS_PARA_IR_AL_KDS; s++) unSegundo()
    expect(irA).not.toHaveBeenCalled()
    expect(screen.getByText(/Te llevamos allá en 1 s/)).toBeInTheDocument()
    unSegundo()
    expect(irA).toHaveBeenCalledTimes(1)
    expect(irA).toHaveBeenCalledWith('http://localhost:5175/')
    expect(sessionStorage.getItem('smartdining_token')).toBeNull()
  })

  it('CERRAR SESIÓN cierra la sesión sin ir al KDS', () => {
    const irA = vi.fn()
    montar(irA)
    fireEvent.click(screen.getByRole('button', { name: 'CERRAR SESIÓN' }))
    expect(sessionStorage.getItem('smartdining_staff_user')).toBeNull()
    expect(irA).not.toHaveBeenCalled()
  })
})
