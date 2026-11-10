import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TomarPedido } from '../TomarPedido'
import { AuthProvider } from '../../context/AuthContext'
import { TablesProvider } from '../../context/TablesContext'
import { TableDetailModal } from '../../components/TableDetailModal'
import { MENU_REAL_FIXTURE, clonarMenuReal } from '../../test/fixtures/menuReal'

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

  it('ante 409 alias_en_uso sin alias en el error ni en la cuenta (registrado sin platos aún), recarga cuenta y ofrece pedir con el texto recortado', async () => {
    let llamadasCuenta = 0

    vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
      if (url.includes('/api/mesas/5/cuenta')) {
        llamadasCuenta++
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
            error: 'Ese nombre ya lo usa otra persona en la mesa, elige otro',
            motivo: 'alias_en_uso',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })

    renderTomarPedido('mesero', 5)

    const input = await screen.findByPlaceholderText(/Ej\. Señora sin celular/i)
    fireEvent.change(input, { target: { value: '  Tío Carlos  ' } })

    fireEvent.click(screen.getByRole('button', { name: /registrar y pedir/i }))

    const btnSugerido = await screen.findByRole('button', { name: /Pedir para «Tío Carlos»/i })
    expect(btnSugerido).toBeInTheDocument()
    // Se cargó al montar y se volvió a cargar tras el 409
    expect(llamadasCuenta).toBeGreaterThanOrEqual(2)

    fireEvent.click(btnSugerido)
    await waitFor(() => {
      expect(screen.getAllByText('Tío Carlos').length).toBeGreaterThan(0)
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
    it('agrega un plato estándar que NO trae campo disponible en GET /api/menu', async () => {
      const menuReal = clonarMenuReal()
      // Verificación explícita de que el fixture real no tiene "disponible" ni "nombre" en categorías
      expect('disponible' in menuReal.categorias[0].platos[0]).toBe(false)
      expect('nombre' in menuReal.categorias[0]).toBe(false)

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
            json: async () => menuReal,
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

      // Agregar la hamburguesa (sin campo disponible en el objeto plato)
      const btnAgregar = screen.getAllByRole('button', { name: /agregar/i })[0]
      fireEvent.click(btnAgregar)

      // Debe mostrar el botón de ver pedido con 1 ítem
      await waitFor(() => {
        expect(screen.getByText(/Ver comanda \(1\)/i)).toBeInTheDocument()
      })
    })

    it('muestra los botones de categoría usando el campo real "categoria" y permite cambiar de categoría', async () => {
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
            json: async () => MENU_REAL_FIXTURE,
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      fireEvent.click(await screen.findByText('Beto'))

      // Los botones de categoría deben mostrar el texto de "categoria" ("Hamburguesas", "Bebidas")
      const btnHamburguesas = await screen.findByRole('button', { name: 'Hamburguesas' })
      const btnBebidas = screen.getByRole('button', { name: 'Bebidas' })
      expect(btnHamburguesas).toBeInTheDocument()
      expect(btnBebidas).toBeInTheDocument()

      // Cambiar a la categoría "Bebidas" y agregar Limonada Natural (sin campo disponible)
      fireEvent.click(btnBebidas)
      await screen.findByText('Limonada Natural')
      fireEvent.click(screen.getByRole('button', { name: /agregar/i }))

      await waitFor(() => {
        expect(screen.getByText(/Ver comanda \(1\)/i)).toBeInTheDocument()
      })
    })

    it('muestra plato con disponible === false como agotado e impide agregarlo', async () => {
      const menuConAgotado = clonarMenuReal()
      menuConAgotado.categorias[0].platos.push({
        id_plato: 11,
        nombre: 'Costillas BBQ',
        descripcion: 'Costillas tiernas',
        precio: 42000,
        url_imagen: null,
        tiempo_estimado: 20,
        personalizable: false,
        calorias: 750,
        disponible: false,
        pasos: [],
      })

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
            json: async () => menuConAgotado,
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      const btnAna = await screen.findByText('Ana')
      fireEvent.click(btnAna)

      await screen.findByText('Costillas BBQ')
      expect(screen.getByText(/Agotado/i)).toBeInTheDocument()

      // El botón de agregar de las Costillas debe estar deshabilitado y no agregar al carrito
      const botonesAgregar = screen.getAllByRole('button', { name: /agregar/i })
      const btnAgotado = botonesAgregar.find((b) => b.disabled)
      expect(btnAgotado).toBeDefined()
      fireEvent.click(btnAgotado)
      expect(screen.queryByText(/Ver comanda/i)).not.toBeInTheDocument()
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
            json: async () => MENU_REAL_FIXTURE,
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
            json: async () => MENU_REAL_FIXTURE,
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

  describe('Paso 3: Resumen y envío del pedido del mesero (J-16)', () => {
    const mockMenu = MENU_REAL_FIXTURE

    it('muestra el resumen agrupado por comensal con total y permite enviar el pedido exitosamente (201)', async () => {
      let pedidoEnviado = null

      vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
        if (url.includes('/api/mesas/5/cuenta')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ id_mesa: 5, comensales: [{ comensal: 'Señora sin celular' }] }),
          }
        }
        if (url.includes('/api/menu')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockMenu,
          }
        }
        if (url.includes('/api/pedidos') && opts?.method === 'POST') {
          pedidoEnviado = JSON.parse(opts.body)
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              id_pedido: 99,
              codigo_pedido: 'PED-261108-XYZ99',
              id_mesa: 5,
              estado: 'recibido',
              total: 34000,
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      // 1. Elegir a "Señora sin celular"
      const btnComensal = await screen.findByText('Señora sin celular')
      fireEvent.click(btnComensal)

      // 2. Agregar Hamburguesa
      await screen.findByText('Hamburguesa Smart Angus')
      const btnAgregar = screen.getAllByRole('button', { name: /agregar/i })[0]
      fireEvent.click(btnAgregar)

      // 3. Ir a Paso 3: Resumen
      const btnVerComanda = await screen.findByRole('button', { name: /ver comanda/i })
      fireEvent.click(btnVerComanda)

      // 4. Verificar encabezado y agrupación
      await screen.findByText('Resumen de la Comanda')
      expect(screen.getAllByText('Señora sin celular').length).toBeGreaterThan(0)
      expect(screen.getByText('Hamburguesa Smart Angus')).toBeInTheDocument()
      expect(screen.getAllByText('$34.000').length).toBeGreaterThan(0)

      // 5. Enviar comanda a cocina
      const btnEnviar = screen.getByRole('button', { name: /enviar comanda a cocina/i })
      fireEvent.click(btnEnviar)

      // Debe haberse enviado el payload limpio con id_mesa y comensal, sin campos de precio
      await waitFor(() => {
        expect(pedidoEnviado).not.toBeNull()
        expect(pedidoEnviado.id_mesa).toBe(5)
        expect(pedidoEnviado.items).toHaveLength(1)
        expect(pedidoEnviado.items[0].id_plato).toBe(10)
        expect(pedidoEnviado.items[0].comensal).toBe('Señora sin celular')
        expect(pedidoEnviado.items[0].precio).toBeUndefined()
      })

      // Debe mostrar mensaje de éxito con el código del pedido
      await waitFor(() => {
        expect(screen.getByText(/¡Comanda enviada a cocina! Pedido PED-261108-XYZ99/i)).toBeInTheDocument()
      })
    })

    it('escribe " abuela ", recibe "Abuela" del servidor y comprueba que el pedido sale con "Abuela"', async () => {
      let pedidoEnviado = null

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
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ id_mesa: 5, alias: 'Abuela' }),
          }
        }
        if (url.includes('/api/menu')) {
          return {
            ok: true,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => mockMenu,
          }
        }
        if (url.includes('/api/pedidos') && opts?.method === 'POST') {
          pedidoEnviado = JSON.parse(opts.body)
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              id_pedido: 101,
              codigo_pedido: 'PED-261108-XYZ101',
              id_mesa: 5,
              estado: 'recibido',
              total: 34000,
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      // 1. Escribir " abuela " y registrar
      const input = await screen.findByPlaceholderText(/Ej\. Señora sin celular/i)
      fireEvent.change(input, { target: { value: ' abuela ' } })

      const btnRegistrar = screen.getByRole('button', { name: /registrar y pedir/i })
      fireEvent.click(btnRegistrar)

      // 2. Verificar que avanzó al menú con el alias exacto normalizado devuelto por el servidor ("Abuela")
      await waitFor(() => {
        expect(screen.getAllByText('Abuela').length).toBeGreaterThan(0)
      })

      // 3. Agregar Hamburguesa
      await screen.findByText('Hamburguesa Smart Angus')
      const btnAgregar = screen.getAllByRole('button', { name: /agregar/i })[0]
      fireEvent.click(btnAgregar)

      // 4. Ver comanda en Paso 3: Resumen
      const btnVerComanda = await screen.findByRole('button', { name: /ver comanda/i })
      fireEvent.click(btnVerComanda)

      // 5. Enviar comanda a cocina
      const btnEnviar = await screen.findByRole('button', { name: /enviar comanda a cocina/i })
      fireEvent.click(btnEnviar)

      // 6. Comprobar que el pedido enviado al backend tiene comensal: 'Abuela'
      await waitFor(() => {
        expect(pedidoEnviado).not.toBeNull()
        expect(pedidoEnviado.id_mesa).toBe(5)
        expect(pedidoEnviado.items).toHaveLength(1)
        expect(pedidoEnviado.items[0].comensal).toBe('Abuela')
        expect(pedidoEnviado.items[0].precio).toBeUndefined()
      })
    })

    it('maneja 409 sin_stock con la forma real [{ tipo, id, nombre }], marcando faltantes y explicando qué quitar con f.nombre', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
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
        if (url.includes('/api/pedidos') && opts?.method === 'POST') {
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              error: 'Sin stock suficiente para el pedido 87',
              motivo: 'sin_stock',
              faltantes: [{ tipo: 'plato', id: 10, nombre: 'Hamburguesa Smart Angus' }],
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      const btnBeto = await screen.findByText('Beto')
      fireEvent.click(btnBeto)

      await screen.findByText('Hamburguesa Smart Angus')
      fireEvent.click(screen.getAllByRole('button', { name: /agregar/i })[0])

      const btnVerComanda = await screen.findByRole('button', { name: /ver comanda/i })
      fireEvent.click(btnVerComanda)

      const btnEnviar = await screen.findByRole('button', { name: /enviar comanda a cocina/i })
      fireEvent.click(btnEnviar)

      // Debe mostrar el error con f.nombre indicando qué quitar y marcar el ítem con AGOTADO
      await waitFor(() => {
        expect(
          screen.getByText(/Algunos platos o ingredientes están agotados\. Quita del pedido: Hamburguesa Smart Angus\./i)
        ).toBeInTheDocument()
        expect(screen.getByText('AGOTADO')).toBeInTheDocument()
      })
    })

    it('maneja 409 comensal_no_registrado, permite volver a registrar y reintenta una vez', async () => {
      let intentosEnvio = 0
      let aliasRegistrado = null

      vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
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
        if (url.includes('/api/mesas/5/comensales') && opts?.method === 'POST') {
          const body = JSON.parse(opts.body)
          aliasRegistrado = body.alias
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ id_mesa: 5, alias: 'Abuela' }),
          }
        }
        if (url.includes('/api/pedidos') && opts?.method === 'POST') {
          intentosEnvio++
          if (intentosEnvio === 1) {
            // Primer intento falla con comensal_no_registrado
            return {
              ok: false,
              status: 409,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({
                error: 'Esa persona no está registrada en la mesa',
                motivo: 'comensal_no_registrado',
                alias: 'Abuela',
              }),
            }
          }
          // Segundo intento (tras re-registrar) triunfa con 201
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              id_pedido: 100,
              codigo_pedido: 'PED-RETRY-OK',
              id_mesa: 5,
              total: 34000,
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      const btnAbuela = await screen.findByText('Abuela')
      fireEvent.click(btnAbuela)

      await screen.findByText('Hamburguesa Smart Angus')
      fireEvent.click(screen.getAllByRole('button', { name: /agregar/i })[0])

      const btnVerComanda = await screen.findByRole('button', { name: /ver comanda/i })
      fireEvent.click(btnVerComanda)

      const btnEnviar = await screen.findByRole('button', { name: /enviar comanda a cocina/i })
      fireEvent.click(btnEnviar)

      // Debe mostrar el botón "Volver a registrar a «Abuela»"
      const btnReRegistrar = await screen.findByRole('button', {
        name: /volver a registrar a «abuela»/i,
      })
      expect(btnReRegistrar).toBeInTheDocument()

      // Hacer clic en volver a registrar
      fireEvent.click(btnReRegistrar)

      // Debe llamar a POST comensales y reintentar el envío con éxito
      await waitFor(() => {
        expect(aliasRegistrado).toBe('Abuela')
        expect(intentosEnvio).toBe(2)
        expect(screen.getByText(/¡Comanda enviada a cocina! Pedido PED-RETRY-OK/i)).toBeInTheDocument()
      })
    })

    it('ante 503 con motivo reintentar muestra mensaje de cruce, conserva el carrito, rehabilita Enviar y no reintenta solo', async () => {
      let intentosEnvio = 0

      vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
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
        if (url.includes('/api/pedidos') && opts?.method === 'POST') {
          intentosEnvio++
          return {
            ok: false,
            status: 503,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              error: 'intenta de nuevo',
              motivo: 'reintentar',
            }),
          }
        }
        return { ok: true, json: async () => ({}) }
      })

      renderTomarPedido('mesero', 5)

      fireEvent.click(await screen.findByText('Beto'))

      await screen.findByText('Hamburguesa Smart Angus')
      fireEvent.click(screen.getAllByRole('button', { name: /agregar/i })[0])

      fireEvent.click(await screen.findByRole('button', { name: /ver comanda/i }))

      const btnEnviar = await screen.findByRole('button', { name: /enviar comanda a cocina/i })
      fireEvent.click(btnEnviar)

      // 1. Muestra el mensaje exacto de cruce de pedidos
      await waitFor(() => {
        expect(
          screen.getByText('Hubo un cruce con otro pedido, vuelve a enviarlo.')
        ).toBeInTheDocument()
      })

      // 2. Conserva el carrito intacto
      expect(screen.getByText('Hamburguesa Smart Angus')).toBeInTheDocument()

      // 3. Rehabilita el botón de Enviar
      const btnEnviarRehabilitado = screen.getByRole('button', { name: /enviar comanda a cocina/i })
      expect(btnEnviarRehabilitado).not.toBeDisabled()

      // 4. No reintenta automáticamente
      expect(intentosEnvio).toBe(1)
    })
  })
})
