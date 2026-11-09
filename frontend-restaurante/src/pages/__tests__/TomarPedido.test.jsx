import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TomarPedido } from '../TomarPedido'
import { AuthProvider } from '../../context/AuthContext'
import { TablesProvider } from '../../context/TablesContext'
import { TableDetailModal } from '../../components/TableDetailModal'

describe('Paso 1: Elegir o registrar comensal al tomar pedido (J-16)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  function renderTomarPedido(rol = 'mesero', idMesa = 5) {
    sessionStorage.setItem(
      'smartdining_staff_user',
      JSON.stringify({ token: 'test-token', rol, role: rol, nombre: 'Juan Mesero' })
    )

    return render(
      <MemoryRouter initialEntries={[`/mesas/${idMesa}/tomar-pedido`]}>
        <AuthProvider>
          <TablesProvider>
            <Routes>
              <Route path="/mesas/:id/tomar-pedido" element={<TomarPedido />} />
            </Routes>
          </TablesProvider>
        </AuthProvider>
      </MemoryRouter>
    )
  }

  it('muestra el botón "Tomar Pedido" en TableDetailModal solo para mesas ocupadas y rol mesero/admin', () => {
    sessionStorage.setItem(
      'smartdining_staff_user',
      JSON.stringify({ token: 'test-token', rol: 'mesero', nombre: 'Juan Mesero' })
    )

    const mesaOcupada = { id: 5, number: 5, name: 'Mesa 5', status: 'Ocupada' }

    const { rerender } = render(
      <MemoryRouter>
        <AuthProvider>
          <TableDetailModal table={mesaOcupada} onClose={() => {}} />
        </AuthProvider>
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: /tomar pedido/i })).toBeInTheDocument()

    // Si la mesa está disponible, no debe mostrar el botón
    const mesaLibre = { id: 6, number: 6, name: 'Mesa 6', status: 'Disponible' }
    rerender(
      <MemoryRouter>
        <AuthProvider>
          <TableDetailModal table={mesaLibre} onClose={() => {}} />
        </AuthProvider>
      </MemoryRouter>
    )
    expect(screen.queryByRole('button', { name: /tomar pedido/i })).not.toBeInTheDocument()
  })

  it('no muestra el botón "Tomar Pedido" si el usuario es cajero o cocina', () => {
    sessionStorage.setItem(
      'smartdining_staff_user',
      JSON.stringify({ token: 'test-token', rol: 'cajero', nombre: 'Cajero Pepe' })
    )

    const mesaOcupada = { id: 5, number: 5, name: 'Mesa 5', status: 'Ocupada' }

    render(
      <MemoryRouter>
        <AuthProvider>
          <TableDetailModal table={mesaOcupada} onClose={() => {}} />
        </AuthProvider>
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: /tomar pedido/i })).not.toBeInTheDocument()
  })

  it('restringe el acceso a /mesas/:id/tomar-pedido si el usuario no es mesero ni admin', async () => {
    renderTomarPedido('cajero', 5)

    await waitFor(() => {
      expect(screen.getByText(/Acceso Restringido/i)).toBeInTheDocument()
      expect(screen.queryByText(/¿Para quién es el pedido?/i)).not.toBeInTheDocument()
    })
  })

  it('lista comensales existentes de la cuenta y avanza al hacer clic en uno', async () => {
    const mockCuenta = {
      id_mesa: 5,
      total_mesa: 60000,
      comensales: [
        { comensal: 'General', saldo: 10000 },
        { comensal: 'Abuela', saldo: 25000 },
        { comensal: 'Ana', saldo: 25000 },
      ],
    }

    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (url.includes('/api/mesas/5/cuenta')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockCuenta,
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    renderTomarPedido('mesero', 5)

    // Debe cargar los comensales y excluir "General"
    await waitFor(() => {
      expect(screen.getByText('Abuela')).toBeInTheDocument()
      expect(screen.getByText('Ana')).toBeInTheDocument()
      expect(screen.queryByText('General')).not.toBeInTheDocument()
    })

    // Al hacer clic en "Abuela", debe pasar al paso 2
    fireEvent.click(screen.getByText('Abuela'))

    await waitFor(() => {
      expect(screen.getByText(/Menú y Carta para Abuela/i)).toBeInTheDocument()
    })
  })

  it('registra a alguien sin celular y usa el alias normalizado devuelto por el servidor (201)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url.includes('/api/mesas/5/cuenta')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id_mesa: 5, comensales: [] }),
        }
      }
      if (url.includes('/api/mesas/5/comensales') && opts?.method === 'POST') {
        // El servidor devuelve el alias normalizado con mayúsculas corregidas
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id_mesa: 5, alias: 'Señora sin celular' }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    renderTomarPedido('mesero', 5)

    const input = await screen.findByPlaceholderText(/Ej\. Señora sin celular/i)
    fireEvent.change(input, { target: { value: '  señora sin celular  ' } })

    const btnRegistrar = screen.getByRole('button', { name: /registrar y pedir/i })
    fireEvent.click(btnRegistrar)

    // Debe avanzar al paso 2 usando el alias exacto del servidor: "Señora sin celular"
    await waitFor(() => {
      expect(screen.getByText(/Menú y Carta para Señora sin celular/i)).toBeInTheDocument()
    })
  })

  it('muestra error y ofrece sugerencia al recibir 409 alias_en_uso', async () => {
    const mockCuenta = {
      id_mesa: 5,
      comensales: [{ comensal: 'Abuela', saldo: 15000 }],
    }

    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url.includes('/api/mesas/5/cuenta')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockCuenta,
        }
      }
      if (url.includes('/api/mesas/5/comensales') && opts?.method === 'POST') {
        return {
          ok: false,
          status: 409,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            error: 'Ese nombre ya está en la mesa',
            motivo: 'alias_en_uso',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    renderTomarPedido('mesero', 5)

    await screen.findByText('Abuela')

    const input = screen.getByPlaceholderText(/Ej\. Señora sin celular/i)
    fireEvent.change(input, { target: { value: 'abuela' } })

    const btnRegistrar = screen.getByRole('button', { name: /registrar y pedir/i })
    fireEvent.click(btnRegistrar)

    // Debe mostrar el error "Ese nombre ya está en la mesa"
    await waitFor(() => {
      expect(screen.getByText(/Ese nombre ya está en la mesa/i)).toBeInTheDocument()
    })

    // Debe sugerir pedir para el alias existente "Abuela"
    const btnSugerido = screen.getByRole('button', { name: /Pedir para «Abuela»/i })
    expect(btnSugerido).toBeInTheDocument()

    // Al hacer clic en el botón sugerido, debe avanzar al paso 2 con "Abuela"
    fireEvent.click(btnSugerido)
    await waitFor(() => {
      expect(screen.getByText(/Menú y Carta para Abuela/i)).toBeInTheDocument()
    })
  })

  it('muestra error específico cuando la mesa no tiene sesión abierta (409 mesa_sin_sesion)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url.includes('/api/mesas/5/cuenta')) {
        return {
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id_mesa: 5, comensales: [] }),
        }
      }
      if (url.includes('/api/mesas/5/comensales') && opts?.method === 'POST') {
        return {
          ok: false,
          status: 409,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            error: 'Esa mesa no tiene una sesión abierta: ábrela antes de agregar comensales',
            motivo: 'mesa_sin_sesion',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    renderTomarPedido('admin', 5)

    const input = await screen.findByPlaceholderText(/Ej\. Señora sin celular/i)
    fireEvent.change(input, { target: { value: 'Carlos' } })

    const btnRegistrar = screen.getByRole('button', { name: /registrar y pedir/i })
    fireEvent.click(btnRegistrar)

    await waitFor(() => {
      expect(screen.getByText(/Esa mesa no tiene una sesión abierta/i)).toBeInTheDocument()
    })
  })
})
