import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthProvider } from '../AuthContext'
import { TablesProvider } from '../TablesContext'
import { useAuth, useTables } from '../../hooks'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

function Salon() {
  const { tables } = useTables()
  const { login } = useAuth()
  return (
    <>
      <span data-testid="mesas">{tables.length}</span>
      <button type="button" onClick={() => login('ana@smartdining.com', 'clave-de-prueba')}>
        entrar
      </button>
    </>
  )
}

describe('TablesContext: carga de mesas y sesión', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('carga las mesas al iniciar sesión, sin recargar la página', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
      // Como el backend real: sin "Authorization: Bearer <token>" es 401, y el
      // 401 cierra la sesión (así se encontró el fallo en la prueba manual).
      const conSesion = config.headers?.Authorization === 'Bearer token-de-prueba'
      if (!url.includes('/auth/login') && !conSesion) return json({ error: 'Token requerido' }, 401)
      if (url.includes('/auth/login')) {
        return json({
          token: 'token-de-prueba',
          usuario: { id_usuario: 1, nombre: 'Ana Ríos', email: 'ana@smartdining.com', rol: 'admin' },
        })
      }
      if (url.includes('/pedidos/activos')) return json({ pedidos: [] })
      if (url.includes('/mesas')) {
        return json({
          mesas: [
            { id_mesa: 1, numero: 1, capacidad: 4, ubicacion: 'Salón', estado: 'disponible' },
            { id_mesa: 2, numero: 2, capacidad: 2, ubicacion: 'Terraza', estado: 'ocupada' },
          ],
        })
      }
      return json({})
    })

    // Como en la app: el proveedor se monta en /login, todavía sin sesión.
    render(
      <AuthProvider>
        <TablesProvider>
          <Salon />
        </TablesProvider>
      </AuthProvider>
    )
    expect(screen.getByTestId('mesas')).toHaveTextContent('0')
    expect(fetchSpy.mock.calls.some(([url]) => url.includes('/mesas'))).toBe(false)

    fireEvent.click(screen.getByText('entrar'))

    await waitFor(() => expect(screen.getByTestId('mesas')).toHaveTextContent('2'))
  })
})
