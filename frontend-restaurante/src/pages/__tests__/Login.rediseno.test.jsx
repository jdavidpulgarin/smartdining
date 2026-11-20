import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Login } from '../Login'
import { AuthProvider } from '../../context/AuthContext'

// Login con el diseño nuevo: lo que el rediseño no puede romper. La lógica es
// la de siempre (API real, mensajes del backend); aquí se miran el error del
// backend, la validación, el estado de carga y la accesibilidad.

const respuesta = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

function montar() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>
  )
  return {
    correo: screen.getByLabelText(/Correo/),
    clave: screen.getByLabelText(/Contraseña/),
    boton: screen.getByRole('button', { name: 'Ingresar al Sistema' }),
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe('Login (diseño nuevo): error del backend', () => {
  it('credenciales malas: muestra el mensaje que manda el backend, marca los campos y vuelve a habilitar ENTRAR', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(respuesta(401, { error: 'Correo o contraseña incorrectos' }))
    const { correo, clave, boton } = montar()
    fireEvent.change(correo, { target: { value: 'mesero@smartdining.com' } })
    fireEvent.change(clave, { target: { value: 'mal' } })
    fireEvent.click(boton)

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('Correo o contraseña incorrectos')
    expect(alerta).toHaveAttribute('id', 'ingreso-error')
    for (const campo of [correo, clave]) {
      expect(campo).toHaveAttribute('aria-invalid', 'true')
      expect(campo).toHaveAttribute('aria-describedby', 'ingreso-error')
    }
    expect(boton).toBeEnabled()
    expect(boton).toHaveTextContent('ENTRAR')
    expect(sessionStorage.getItem('smartdining_token')).toBeNull()
  })

  it('otro mensaje del backend (cuenta desactivada) sale tal cual, sin inventar uno', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(respuesta(403, { error: 'Tu cuenta está desactivada. Habla con el administrador.' }))
    const { correo, clave, boton } = montar()
    fireEvent.change(correo, { target: { value: 'cajero@smartdining.com' } })
    fireEvent.change(clave, { target: { value: 'Admin123!' } })
    fireEvent.click(boton)
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu cuenta está desactivada. Habla con el administrador.')
  })
})

describe('Login (diseño nuevo): validación de los campos', () => {
  it('sin correo no llama a la API: avisa con role="alert" y marca los campos', async () => {
    const fetch = vi.spyOn(global, 'fetch')
    const { correo, clave, boton } = montar()
    fireEvent.change(clave, { target: { value: 'Admin123!' } })
    fireEvent.click(boton)

    expect(screen.getByRole('alert')).toHaveTextContent('Por favor ingresa tu correo corporativo')
    expect(correo).toHaveAttribute('aria-invalid', 'true')
    expect(clave).toHaveAttribute('aria-invalid', 'true')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('al escribir el correo, el aviso se quita y los campos dejan de estar marcados', () => {
    const { correo, boton } = montar()
    fireEvent.click(boton)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(correo, { target: { value: 'a' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(correo).not.toHaveAttribute('aria-invalid')
    expect(correo).not.toHaveAttribute('aria-describedby')
  })

  it('Enter en el formulario (teclado) hace lo mismo que el botón', () => {
    const fetch = vi.spyOn(global, 'fetch')
    const { correo } = montar()
    fireEvent.submit(correo.closest('form'))
    expect(screen.getByRole('alert')).toHaveTextContent('Por favor ingresa tu correo corporativo')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Login (diseño nuevo): estado de carga', () => {
  it('mientras espera a la API: ENTRANDO, botón y campos deshabilitados; al responder vuelve a ENTRAR', async () => {
    let responder
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise((r) => { responder = r }))
    const { correo, clave, boton } = montar()
    fireEvent.change(correo, { target: { value: 'admin@smartdining.com' } })
    fireEvent.change(clave, { target: { value: 'Admin123!' } })
    fireEvent.click(boton)

    await waitFor(() => expect(boton).toBeDisabled())
    expect(boton).toHaveTextContent('ENTRANDO')
    expect(boton).toHaveAccessibleName('Ingresar al Sistema')
    expect(correo).toBeDisabled()
    expect(clave).toBeDisabled()
    expect(screen.getAllByRole('button')).toHaveLength(1)

    await act(async () => { responder(respuesta(401, { error: 'Credenciales inválidas' })) })
    await waitFor(() => expect(boton).toBeEnabled())
    expect(boton).toHaveTextContent('ENTRAR')
    expect(boton).not.toHaveTextContent('ENTRANDO')
  })
})

describe('Login (diseño nuevo): accesibilidad', () => {
  it('campos con su label, un solo botón, lo decorativo oculto y el título del ticket', () => {
    const { correo, clave } = montar()
    expect(correo).toHaveAttribute('type', 'email')
    expect(correo).toHaveAttribute('autocomplete', 'username')
    expect(clave).toHaveAttribute('type', 'password')
    expect(clave).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/ABRE TU\s*TURNO\./)
    expect(screen.getByRole('region', { name: /INICIAR\s*SESIÓN/ })).toBeInTheDocument()
    // Riel, tickets fantasma, sello, logo y cinta son decorativos.
    for (const sel of ['.ingreso-riel', '.ingreso-fantasma', '.ingreso-sello', '.ingreso-logo', '.ingreso-cinta']) {
      for (const nodo of document.querySelectorAll(sel)) expect(nodo).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
