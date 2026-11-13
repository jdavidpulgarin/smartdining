import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useContext, useEffect } from 'react'

const conectarSocket = vi.fn()
const desconectarSocket = vi.fn()
vi.mock('../../hooks/useSocket', () => ({ conectarSocket: (...a) => conectarSocket(...a), desconectarSocket: () => desconectarSocket() }))

import { AuthProvider } from '../AuthContext'
import { AuthContext } from '../authContextDef'

const ref = { auth: null }
function Espia() {
  const valor = useContext(AuthContext)
  useEffect(() => {
    ref.auth = valor
  })
  return null
}

const json = (body, status = 200) => ({ ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })

describe('AuthContext: el socket se conecta con el token de la sesión', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    conectarSocket.mockClear()
    desconectarSocket.mockClear()
    sessionStorage.clear()
  })

  it('sin sesión no conecta; al iniciar sesión (sin recargar) conecta con el token; al salir desconecta', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ token: 'jwt-mesero', usuario: { id_usuario: 3, nombre: 'Juan Mesero', email: 'm@x.co', rol: 'mesero' } }))
    render(<AuthProvider><Espia /></AuthProvider>)
    expect(conectarSocket).not.toHaveBeenCalled()

    await act(async () => { await ref.auth.login('m@x.co', 'Admin123!') })
    expect(conectarSocket).toHaveBeenLastCalledWith('jwt-mesero')

    desconectarSocket.mockClear()
    act(() => ref.auth.logout())
    expect(desconectarSocket).toHaveBeenCalled()
  })

  it('rol cocina (revisión de Roberto en #213): login no guarda nada, no conecta el socket y devuelve { cocina: true }', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ token: 'jwt-cocina', usuario: { id_usuario: 4, nombre: 'Chef', email: 'c@x.co', rol: 'cocina' } }))
    render(<AuthProvider><Espia /></AuthProvider>)

    let resultado
    await act(async () => { resultado = await ref.auth.login('c@x.co', 'Admin123!') })
    expect(resultado).toEqual({ success: false, cocina: true })
    expect(ref.auth.user).toBeNull()
    expect(conectarSocket).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('smartdining_staff_user')).toBeNull()
    expect(sessionStorage.getItem('smartdining_token')).toBeNull()
  })

  it('una sesión de cocina guardada de antes se descarta al cargar, sin conectar el socket', () => {
    sessionStorage.setItem('smartdining_staff_user', JSON.stringify({ id: 4, rol: 'cocina', token: 'jwt-cocina-viejo' }))
    sessionStorage.setItem('smartdining_token', 'jwt-cocina-viejo')
    render(<AuthProvider><Espia /></AuthProvider>)
    expect(ref.auth.user).toBeNull()
    expect(conectarSocket).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('smartdining_staff_user')).toBeNull()
    expect(sessionStorage.getItem('smartdining_token')).toBeNull()
  })

  it('al recargar con la sesión guardada conecta con su token', () => {
    sessionStorage.setItem('smartdining_staff_user', JSON.stringify({ id: 1, rol: 'admin', token: 'jwt-guardado' }))
    render(<AuthProvider><Espia /></AuthProvider>)
    expect(conectarSocket).toHaveBeenCalledWith('jwt-guardado')
  })
})
