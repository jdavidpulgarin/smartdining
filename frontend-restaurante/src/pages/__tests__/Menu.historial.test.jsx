import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Menu } from '../Menu'
import { AuthContext } from '../../context/authContextDef'
import { LIMITE_HISTORIAL } from '../../components/admin/HistorialPrecios'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

const categorias = [{ id_categoria: 1, nombre: 'Hamburguesas' }]
const platos = [
  { id_plato: 7, id_categoria: 1, nombre: 'Hamburguesa Clásica', precio: 30000, disponible: true },
  { id_plato: 8, id_categoria: 1, nombre: 'Hamburguesa Doble', precio: 36000, disponible: true },
]
const usuarios = [
  { id_usuario: 1, nombre: 'Ana Admin', rol: 'admin' },
  { id_usuario: 2, nombre: 'Beto Caja', rol: 'cajero' },
]

/** Backend simulado por URL; `historial` y `personal` deciden esas dos rutas. */
function simularBackend({ historial = () => json({ historial: [] }), personal = () => json({ usuarios }) } = {}) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (url.includes('/historial-precios')) return historial(url)
    if (url.includes('/usuarios')) return personal(url)
    if (url.includes('/categorias')) return json({ categorias })
    if (url.includes('/platos')) return json({ platos })
    return json({})
  })
}

function montar(rol = 'admin') {
  const valor = rol ? { user: { id_usuario: 1, nombre: 'Ana Admin', rol } } : null
  render(
    <AuthContext.Provider value={valor}>
      <MemoryRouter>
        <Menu />
      </MemoryRouter>
    </AuthContext.Provider>
  )
}

const abrirHistorial = async (nombre) => {
  fireEvent.click(await screen.findByRole('button', { name: `Ver historial de precios de ${nombre}` }))
  return screen.findByRole('dialog', { name: `Historial de precios · ${nombre}` })
}

describe('Menú · Ver historial de precios (P-21, P2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('el admin ve el enlace junto al precio de cada plato', async () => {
    simularBackend()
    montar('admin')
    expect(await screen.findByRole('button', { name: 'Ver historial de precios de Hamburguesa Clásica' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver historial de precios de Hamburguesa Doble' })).toBeInTheDocument()
  })

  it.each([['mesero'], ['cajero'], [null]])('con rol %s no se ofrece el enlace (la ruta es solo de admin)', async (rol) => {
    const fetchSpy = simularBackend()
    montar(rol)
    await screen.findByText('Hamburguesa Clásica')
    expect(screen.queryByText('Ver historial')).not.toBeInTheDocument()
    expect(fetchSpy.mock.calls.some(([url]) => url.includes('/historial-precios'))).toBe(false)
  })

  it('pide el historial del plato pulsado, con límite, y muestra cada cambio con su autor', async () => {
    const fetchSpy = simularBackend({
      historial: () =>
        json({
          historial: [
            { id: 12, tipo: 'plato', id_referencia: 7, precio_anterior: 28000, precio_nuevo: 30000, id_usuario: 1, cambiado_en: '2026-11-08T12:00:00.000Z' },
            { id: 9, tipo: 'plato', id_referencia: 7, precio_anterior: 30000, precio_nuevo: 28000, id_usuario: 2, cambiado_en: '2026-11-01T12:00:00.000Z' },
          ],
        }),
    })
    montar()
    const ventana = await abrirHistorial('Hamburguesa Clásica')

    const llamada = fetchSpy.mock.calls.find(([url]) => url.includes('/historial-precios'))
    expect(llamada[0]).toMatch(/\/platos\/7\/historial-precios\?limite=50$/)
    expect(llamada[1].headers.Authorization).toBe('Bearer test-token')

    const subida = await within(ventana).findByTestId('cambio-precio-12')
    expect(subida).toHaveTextContent('$28.000')
    expect(subida).toHaveTextContent('$30.000')
    expect(subida).toHaveTextContent('+$2.000')
    await waitFor(() => expect(subida).toHaveTextContent('Ana Admin'))

    const bajada = within(ventana).getByTestId('cambio-precio-9')
    expect(bajada).toHaveTextContent('−$2.000')
    expect(bajada).toHaveTextContent('Beto Caja')

    // Lo más reciente primero, como lo manda el servidor.
    const filas = within(ventana).getAllByTestId(/^cambio-precio-/)
    expect(filas.map((f) => f.dataset.testid)).toEqual(['cambio-precio-12', 'cambio-precio-9'])
    expect(within(ventana).getByText(/Precio actual:/)).toHaveTextContent('Precio actual: $30.000.')
  })

  it('un cambio sin autor dice "Sin registro" y un autor desconocido, "Usuario N"', async () => {
    simularBackend({
      historial: () =>
        json({
          historial: [
            { id: 3, precio_anterior: 30000, precio_nuevo: 31000, id_usuario: null, cambiado_en: '2026-11-02T12:00:00.000Z' },
            { id: 2, precio_anterior: 29000, precio_nuevo: 30000, id_usuario: 99, cambiado_en: '2026-11-01T12:00:00.000Z' },
          ],
        }),
    })
    montar()
    const ventana = await abrirHistorial('Hamburguesa Clásica')
    expect(await within(ventana).findByTestId('cambio-precio-3')).toHaveTextContent('Sin registro')
    expect(within(ventana).getByTestId('cambio-precio-2')).toHaveTextContent('Usuario 99')
  })

  it('si la lista del personal falla, el historial sale igual con "Usuario N"', async () => {
    simularBackend({
      historial: () => json({ historial: [{ id: 5, precio_anterior: 1000, precio_nuevo: 2000, id_usuario: 1, cambiado_en: '2026-11-01T12:00:00.000Z' }] }),
      personal: () => json({ error: 'Error interno' }, 500),
    })
    montar()
    const ventana = await abrirHistorial('Hamburguesa Clásica')
    expect(await within(ventana).findByTestId('cambio-precio-5')).toHaveTextContent('Usuario 1')
    expect(within(ventana).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('un plato sin cambios lo dice', async () => {
    simularBackend()
    montar()
    const ventana = await abrirHistorial('Hamburguesa Doble')
    expect(await within(ventana).findByText('Este plato no ha cambiado de precio.')).toBeInTheDocument()
  })

  it('un error del servidor se muestra; no se inventa un historial', async () => {
    simularBackend({ historial: () => json({ error: 'Plato no encontrado' }, 404) })
    montar()
    const ventana = await abrirHistorial('Hamburguesa Clásica')
    expect(await within(ventana).findByRole('alert')).toHaveTextContent('Plato no encontrado')
    expect(within(ventana).queryByTestId(/^cambio-precio-/)).not.toBeInTheDocument()
  })

  it('sin conexión lo dice así', async () => {
    simularBackend({
      historial: () => {
        throw new TypeError('Failed to fetch')
      },
    })
    montar()
    const ventana = await abrirHistorial('Hamburguesa Clásica')
    expect(await within(ventana).findByRole('alert')).toHaveTextContent('Sin conexión con el servidor')
  })

  it(`con ${LIMITE_HISTORIAL} filas avisa que solo se ven los últimos`, async () => {
    const muchas = Array.from({ length: LIMITE_HISTORIAL }, (_, i) => ({
      id: i + 1,
      precio_anterior: 1000 + i,
      precio_nuevo: 1001 + i,
      id_usuario: 1,
      cambiado_en: '2026-11-01T12:00:00.000Z',
    }))
    simularBackend({ historial: () => json({ historial: muchas }) })
    montar()
    const ventana = await abrirHistorial('Hamburguesa Clásica')
    expect(await within(ventana).findByText(`Se muestran los últimos ${LIMITE_HISTORIAL} cambios.`)).toBeInTheDocument()
  })

  it('se cierra con el botón y con Escape', async () => {
    simularBackend()
    montar()
    let ventana = await abrirHistorial('Hamburguesa Clásica')
    fireEvent.click(within(ventana).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    ventana = await abrirHistorial('Hamburguesa Clásica')
    expect(ventana).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
