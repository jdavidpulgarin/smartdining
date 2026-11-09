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
      expect(screen.getAllByText('Abuela').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Pidiendo para:/i).length).toBeGreaterThan(0)
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
      expect(screen.getAllByText('Señora sin celular').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Pidiendo para:/i).length).toBeGreaterThan(0)
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
      expect(screen.getAllByText('Abuela').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Pidiendo para:/i).length).toBeGreaterThan(0)
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

  describe('Paso 2: Menú y constructor para tomar pedido (J-16)', () => {
    const mockMenu = {
      categorias: [
        {
          id_categoria: 1,
          nombre: 'Hamburguesas',
          platos: [
            {
              id_plato: 10,
              nombre: 'Hamburguesa Smart Angus',
              precio: 34000,
              disponible: true,
              personalizable: false,
              descripcion: 'Carne angus jugosa',
            },
            {
              id_plato: 11,
              nombre: 'Costillas BBQ',
              precio: 42000,
              disponible: false,
              personalizable: false,
              descripcion: 'Costillas tiernas',
            },
            {
              id_plato: 12,
              nombre: 'Bowl Personalizado',
              precio: 28000,
              disponible: true,
              personalizable: true,
              descripcion: 'Arma tu bowl a tu gusto',
              pasos: [
                {
                  id_paso: 1,
                  nombre: 'Elige tu Base',
                  orden: 1,
                  min_sel: 1,
                  max_sel: 1,
                  obligatorio: true,
                  ingredientes: [
                    { id_ingrediente: 101, nombre: 'Arroz Integral', precio_extra: 0, disponible: true },
                    { id_ingrediente: 102, nombre: 'Quinua Orgánica', precio_extra: 3000, disponible: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    it('lista los platos del menú y permite agregar un plato estándar al carrito', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (url.includes('/api/mesas/5/cuenta')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ id_mesa: 5, comensales: [{ comensal: 'Beto' }] }),
          }
        }
        if (url.includes('/api/menu')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockMenu,
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      // Seleccionar comensal "Beto"
      const btnBeto = await screen.findByText('Beto')
      fireEvent.click(btnBeto)

      // Debe mostrar el catálogo con la Hamburguesa Smart Angus
      await screen.findByText('Hamburguesa Smart Angus')
      expect(screen.getAllByText(/Pidiendo para:/i).length).toBeGreaterThan(0)

      // Agregar la hamburguesa
      const btnAgregar = screen.getAllByRole('button', { name: /agregar/i })[0]
      fireEvent.click(btnAgregar)

      // Debe mostrar el botón de ver pedido con 1 ítem
      await waitFor(() => {
        expect(screen.getByText(/Ver comanda \(1\)/i)).toBeInTheDocument()
      })
    })

    it('muestra plato agotado deshabilitado e impide agregarlo', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (url.includes('/api/mesas/5/cuenta')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ id_mesa: 5, comensales: [{ comensal: 'Ana' }] }),
          }
        }
        if (url.includes('/api/menu')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockMenu,
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      const btnAna = await screen.findByText('Ana')
      fireEvent.click(btnAna)

      await screen.findByText('Costillas BBQ')
      expect(screen.getByText(/Agotado/i)).toBeInTheDocument()

      // El botón de agregar de las Costillas debe estar deshabilitado
      const botonesAgregar = screen.getAllByRole('button', { name: /agregar/i })
      const btnAgotado = botonesAgregar.find((b) => b.disabled)
      expect(btnAgotado).toBeDefined()
    })

    it('permite personalizar plato en ConstructorModal y agregar con ingredientes y recargo', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (url.includes('/api/mesas/5/cuenta')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ id_mesa: 5, comensales: [{ comensal: 'Abuela' }] }),
          }
        }
        if (url.includes('/api/menu')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockMenu,
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      const btnAbuela = await screen.findByText('Abuela')
      fireEvent.click(btnAbuela)

      await screen.findByText('Bowl Personalizado')
      const btnPersonalizar = screen.getByRole('button', { name: /personalizar/i })
      fireEvent.click(btnPersonalizar)

      // Debe abrir ConstructorModal
      await screen.findByText('Elige tu Base')
      expect(screen.getByText('Arroz Integral')).toBeInTheDocument()

      // Seleccionar Arroz Integral
      fireEvent.click(screen.getByText('Arroz Integral'))

      // Debe habilitar el botón de agregar
      const btnConfirmarConstructor = screen.getByRole('button', { name: /agregar a la comanda/i })
      expect(btnConfirmarConstructor).not.toBeDisabled()
      fireEvent.click(btnConfirmarConstructor)

      // Modal se cierra y el carrito ahora tiene 1 ítem
      await waitFor(() => {
        expect(screen.getByText(/Ver comanda \(1\)/i)).toBeInTheDocument()
      })
    })

    it('permite cambiar de comensal ("Pedir para otra persona") sin perder el carrito', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (url.includes('/api/mesas/5/cuenta')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              id_mesa: 5,
              comensales: [{ comensal: 'Ana' }, { comensal: 'Beto' }],
            }),
          }
        }
        if (url.includes('/api/menu')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockMenu,
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      // 1. Elegir a Ana
      const btnAna = await screen.findByText('Ana')
      fireEvent.click(btnAna)

      // 2. Agregar Hamburguesa para Ana
      await screen.findByText('Hamburguesa Smart Angus')
      const btnAgregar = screen.getAllByRole('button', { name: /agregar/i })[0]
      fireEvent.click(btnAgregar)

      await waitFor(() => {
        expect(screen.getByText(/Ver comanda \(1\)/i)).toBeInTheDocument()
      })

      // 3. Cambiar comensal
      const btnCambiar = screen.getByRole('button', { name: /pedir para otra persona/i })
      fireEvent.click(btnCambiar)

      // 4. Volver a ver la lista de comensales, y el carrito aún tiene 1 ítem
      await screen.findByText('¿Para quién es el pedido?')
      expect(screen.getByText(/Ver Pedido \(1\)/i)).toBeInTheDocument()

      // 5. Elegir a Beto
      const btnBeto = screen.getByText('Beto')
      fireEvent.click(btnBeto)

      // 6. Ahora pidiendo para Beto, y el carrito sigue en 1
      await waitFor(() => {
        expect(screen.getAllByText(/Pidiendo para:/i).length).toBeGreaterThan(0)
        expect(screen.getAllByText('Beto').length).toBeGreaterThan(0)
      })
      expect(screen.getByText(/Ver comanda \(1\)/i)).toBeInTheDocument()
    })
  })
})
