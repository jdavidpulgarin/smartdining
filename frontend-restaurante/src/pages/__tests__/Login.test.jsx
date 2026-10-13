import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Login } from '../Login'
import { AuthProvider } from '../../context/AuthContext'

describe('Flujo de Login en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('debe renderizar el formulario con correo, contraseña y botón de acceso', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )

    expect(screen.getByText('SmartDining POS')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('admin@smartdining.com')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ingresar al sistema/i })).toBeInTheDocument()
  })

  it('debe procesar el inicio de sesión exitoso y guardar el token en sessionStorage', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        token: 'fake-jwt-token-admin',
        usuario: { id: 1, nombre: 'Jarrison Pulgarin', rol: 'admin', correo: 'admin@smartdining.com' },
      }),
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse)

    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )

    const emailInput = screen.getByPlaceholderText('admin@smartdining.com')
    const passInput = screen.getByPlaceholderText('••••••••')
    const submitBtn = screen.getByRole('button', { name: /ingresar al sistema/i })

    fireEvent.change(emailInput, { target: { value: 'admin@smartdining.com' } })
    fireEvent.change(passInput, { target: { value: 'Password123' } })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/auth/login'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ email: 'admin@smartdining.com', password: 'Password123' }),
        })
      )
    })

    await waitFor(() => {
      const saved = JSON.parse(sessionStorage.getItem('smartdining_staff_user') || '{}')
      expect(saved.token).toBe('fake-jwt-token-admin')
    })
  })

  it('debe mostrar mensaje de error cuando las credenciales son incorrectas', async () => {
    const mockErrorResponse = {
      ok: false,
      status: 401,
      json: async () => ({
        error: 'Credenciales inválidas',
      }),
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(mockErrorResponse)

    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )

    const emailInput = screen.getByPlaceholderText('admin@smartdining.com')
    const passInput = screen.getByPlaceholderText('••••••••')
    const submitBtn = screen.getByRole('button', { name: /ingresar al sistema/i })

    fireEvent.change(emailInput, { target: { value: 'admin@smartdining.com' } })
    fireEvent.change(passInput, { target: { value: 'WrongPassword' } })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Credenciales inválidas')).toBeInTheDocument()
    })
  })

  it('debe mostrar banner de advertencia cuando hay un mensaje de sesión inválida en sessionStorage (401)', () => {
    sessionStorage.setItem(
      'smartdining_auth_message',
      'Tu sesión no es válida o tu cuenta fue desactivada'
    )

    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )

    expect(
      screen.getByText('Tu sesión no es válida o tu cuenta fue desactivada')
    ).toBeInTheDocument()
  })

  it('debe mostrar cuenta regresiva y deshabilitar botón al recibir 429 con Retry-After', async () => {
    const mockRateLimitResponse = {
      ok: false,
      status: 429,
      headers: new Headers({
        'content-type': 'application/json',
        'retry-after': '30',
      }),
      json: async () => ({
        error: 'Demasiados intentos de inicio de sesión. Espera un momento y vuelve a intentarlo.',
      }),
    }
    vi.spyOn(global, 'fetch').mockResolvedValue(mockRateLimitResponse)

    render(
      <MemoryRouter>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </MemoryRouter>
    )

    const emailInput = screen.getByPlaceholderText('admin@smartdining.com')
    const passInput = screen.getByPlaceholderText('••••••••')
    const submitBtn = screen.getByRole('button', { name: /ingresar al sistema/i })

    fireEvent.change(emailInput, { target: { value: 'admin@smartdining.com' } })
    fireEvent.change(passInput, { target: { value: 'WrongPassword' } })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/30s/i)
    })

    // El botón debe quedar deshabilitado mientras dura la cuenta regresiva
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText(/espera 30s para reintentar/i)).toBeInTheDocument()
  })
})

