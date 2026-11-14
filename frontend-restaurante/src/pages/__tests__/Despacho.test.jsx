import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { Despacho } from '../Despacho'
import { Entregas } from '../Entregas'
import { Pedidos } from '../Pedidos'
import { Caja } from '../Caja'
import { Topbar } from '../../components/Topbar'
import { AuthProvider } from '../../context/AuthContext'
import { TablesProvider } from '../../context/TablesContext'
import * as socket from '../../hooks/useSocket'
import App from '../../App'

vi.mock('../../hooks/useSocket', async (original) => {
  const real = await original()
  return { ...real, conectarSocket: vi.fn(real.conectarSocket), desconectarSocket: vi.fn() }
})

// P-24 · Despacho (admin, cajero), Entregas (repartidor), y «Domicilio» donde el
// panel esperaba un número de mesa. Backend simulado por URL, con el contrato de #231.

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

const sesionComo = (rol) => {
  sessionStorage.clear()
  sessionStorage.setItem('smartdining_token', 'test-token')
  sessionStorage.setItem('smartdining_staff_user', JSON.stringify({ id: 7, id_usuario: 7, nombre: 'Uno', rol, role: rol, token: 'test-token' }))
}

const dom = (id, estado_entrega, { estado = 'listo', repartidor = null, motivo_fallo = null } = {}) => ({
  pedido: { id_pedido: id, codigo_pedido: `D-${id}`, estado, total: 18000 },
  cliente: { nombre: 'Lucía', telefono: '3001112233' },
  direccion: { direccion: 'Cra 3 # 5-10', barrio: 'Bocagrande', referencia: 'Portón azul', lat: null, lng: null, telefono_contacto: '3001112233' },
  zona: { id_zona: 2, nombre: 'Bocagrande' },
  costo_envio: 6000,
  repartidor,
  estado_entrega,
  motivo_fallo,
  tiempos: { creado_en: '2026-11-13T15:00:00Z', asignado_en: null, en_camino_en: null, entregado_en: null, fallido_en: null },
})
const RAFA = { id_usuario: 40, nombre: 'Rafa' }

let llamadas
function backend(rutas) {
  llamadas = []
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, config = {}) => {
    const metodo = config.method || 'GET'
    const camino = url.replace(/^https?:\/\/[^/]+\/api/, '')
    llamadas.push({ metodo, camino, body: config.body ? JSON.parse(config.body) : undefined })
    for (const [patron, respuesta] of rutas) {
      if (patron.test(`${metodo} ${camino}`)) return typeof respuesta === 'function' ? respuesta(config) : json(respuesta)
    }
    return json({})
  })
}
const hizo = (metodo, re) => llamadas.filter((l) => l.metodo === metodo && re.test(l.camino))

const montar = (ui, ruta = '/') =>
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={[ruta]}>
        <TablesProvider>
          <Routes><Route path="*" element={ui} /></Routes>
        </TablesProvider>
      </MemoryRouter>
    </AuthProvider>
  )

beforeEach(() => {
  vi.restoreAllMocks()
  socket.conectarSocket.mockClear()
})

describe('Entregas (repartidor)', () => {
  it('asignado y listo: SALIR manda POST /salir sin cuerpo', async () => {
    sesionComo('repartidor')
    backend([[/^GET \/domicilios\/mios$/, { domicilios: [dom(1, 'asignado', { repartidor: RAFA })] }], [/^POST \/domicilios\/1\/salir$/, { domicilio: dom(1, 'en_camino') }]])
    montar(<Entregas />)
    fireEvent.click(await screen.findByText('SALIR A ENTREGAR'))
    await waitFor(() => expect(hizo('POST', /\/domicilios\/1\/salir$/)).toHaveLength(1))
    expect(hizo('POST', /\/salir$/)[0].body).toBeUndefined()
    expect(await screen.findByRole('status')).toHaveTextContent('saliste')
  })

  it('asignado pero cocina no terminó: el botón está deshabilitado y lo dice', async () => {
    sesionComo('repartidor')
    backend([[/^GET \/domicilios\/mios$/, { domicilios: [dom(1, 'asignado', { estado: 'en_preparacion', repartidor: RAFA })] }]])
    montar(<Entregas />)
    expect((await screen.findByText('SALIR A ENTREGAR')).closest('button')).toBeDisabled()
    expect(screen.getByText(/Espera a que cocina/)).toBeInTheDocument()
  })

  it('en camino: NO SE PUDO ENTREGAR pide motivo y lo manda', async () => {
    sesionComo('repartidor')
    backend([[/^GET \/domicilios\/mios$/, { domicilios: [dom(2, 'en_camino', { repartidor: RAFA })] }], [/^POST \/domicilios\/2\/fallar$/, { domicilio: dom(2, 'fallido') }]])
    montar(<Entregas />)
    fireEvent.click(await screen.findByText('NO SE PUDO ENTREGAR'))
    fireEvent.click(screen.getByText('CONFIRMAR'))
    expect(screen.getByRole('alert')).toHaveTextContent(/Escribe por qué/)
    expect(hizo('POST', /fallar$/)).toHaveLength(0)
    fireEvent.change(screen.getByLabelText(/POR QUÉ NO SE PUDO/), { target: { value: '  Nadie abrió  ' } })
    fireEvent.click(screen.getByText('CONFIRMAR'))
    await waitFor(() => expect(hizo('POST', /\/domicilios\/2\/fallar$/)).toHaveLength(1))
    expect(hizo('POST', /fallar$/)[0].body).toEqual({ motivo: 'Nadie abrió' })
  })

  it('en camino: ENTREGADO manda POST /entregar; un 409 se muestra con su motivo', async () => {
    sesionComo('repartidor')
    backend([[/^GET \/domicilios\/mios$/, { domicilios: [dom(3, 'en_camino', { repartidor: RAFA })] }], [/^POST \/domicilios\/3\/entregar$/, () => json({ error: 'x', motivo: 'transicion_invalida' }, 409)]])
    montar(<Entregas />)
    fireEvent.click(await screen.findByText('ENTREGADO'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Actualiza la lista/)
  })
})

describe('Despacho (admin y cajero)', () => {
  it('elegir repartidor manda PATCH con su id; en camino ya no se puede cambiar', async () => {
    sesionComo('cajero')
    backend([
      [/^GET \/domicilios(\?|$)/, { domicilios: [dom(1, 'por_asignar', { estado: 'recibido' }), dom(2, 'en_camino', { repartidor: RAFA })] }],
      [/^GET \/usuarios\/repartidores$/, { repartidores: [RAFA] }],
      [/^PATCH \/domicilios\/1\/repartidor$/, { domicilio: dom(1, 'asignado', { repartidor: RAFA }) }],
    ])
    montar(<Despacho />)
    const select = await screen.findByLabelText('Repartidor del pedido D-1')
    fireEvent.change(select, { target: { value: '40' } })
    await waitFor(() => expect(hizo('PATCH', /\/domicilios\/1\/repartidor$/)).toHaveLength(1))
    expect(hizo('PATCH', /repartidor$/)[0].body).toEqual({ id_repartidor: 40 })
    expect(within(screen.getByTestId('despacho-2')).queryByRole('combobox')).toBeNull()
    expect(within(screen.getByTestId('despacho-2')).getByText('Rafa')).toBeInTheDocument()
  })

  it('fallido: el admin lo cancela (POST /pedidos/:id/cancelar); el cajero no tiene el botón', async () => {
    sesionComo('admin')
    const rutas = [
      [/^GET \/domicilios(\?|$)/, { domicilios: [dom(5, 'fallido', { repartidor: RAFA, motivo_fallo: 'Nadie abrió' })] }],
      [/^GET \/usuarios\/repartidores$/, { repartidores: [RAFA] }],
      [/^POST \/pedidos\/5\/cancelar$/, { id_pedido: 5, estado: 'cancelado' }],
    ]
    backend(rutas)
    const { unmount } = montar(<Despacho />)
    fireEvent.click(await screen.findByText('CANCELAR PEDIDO'))
    await waitFor(() => expect(hizo('POST', /\/pedidos\/5\/cancelar$/)).toHaveLength(1))
    expect(hizo('POST', /cancelar$/)[0].body.razon).toMatch(/Nadie abrió/)
    unmount()
    sesionComo('cajero')
    backend(rutas)
    montar(<Despacho />)
    expect(await screen.findByText(/Solo el administrador/)).toBeInTheDocument()
    expect(screen.queryByText('CANCELAR PEDIDO')).toBeNull()
  })
})

describe('el repartidor en el panel', () => {
  it('entra directo a sus entregas: cualquier ruta lo devuelve a /entregas, sin socket ni salón', async () => {
    sesionComo('repartidor')
    backend([[/^GET \/domicilios\/mios$/, { domicilios: [] }]])
    window.history.pushState({}, '', '/mesas')
    render(<App />)
    expect(await screen.findByText('MIS ENTREGAS')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/entregas')
    const barra = screen.getByRole('navigation', { name: /Navegación principal/ })
    expect(within(barra).getAllByRole('link').map((a) => a.textContent.trim())).toEqual(['ENTREGAS'])
    expect(hizo('GET', /^\/mesas|^\/pedidos/)).toHaveLength(0)
    expect(socket.conectarSocket).not.toHaveBeenCalled()
  })

  it('admin y cajero ven DESPACHO; el mesero no', () => {
    for (const [rol, ve] of [['admin', true], ['cajero', true], ['mesero', false]]) {
      sesionComo(rol)
      backend([])
      const { unmount } = montar(<Topbar />)
      expect(Boolean(screen.queryByRole('link', { name: 'DESPACHO' }))).toBe(ve)
      expect(screen.queryByRole('link', { name: 'ENTREGAS' })).toBeNull()
      unmount()
    }
  })
})

describe('«Domicilio» donde se esperaba una mesa', () => {
  const pedidoDom = { id_pedido: 9, codigo_pedido: 'D-9', id_mesa: null, mesa_numero: null, canal: 'domicilio', estado: 'listo', total: 18000, detalles: [{ id_detalle: 1, nombre: 'Limonada', cantidad: 1, estado_item: 'listo' }] }

  it('Pedidos (admin): «Domicilio» con zona y dirección, y sin botón Entregar: lo entrega el repartidor', async () => {
    sesionComo('admin')
    backend([
      [/^GET \/pedidos\/activos$/, { pedidos: [pedidoDom] }],
      [/^GET \/domicilios\?estado_entrega=/, { domicilios: [dom(9, 'asignado', { repartidor: RAFA })] }],
    ])
    montar(<Pedidos />)
    expect(await screen.findByText('Domicilio')).toBeInTheDocument()
    expect(await screen.findByText('Bocagrande · Cra 3 # 5-10')).toBeInTheDocument()
    expect(screen.getByTestId('lo-lleva-repartidor-9')).toHaveTextContent('Lo entrega el repartidor · Asignado')
    expect(screen.queryByText('Entregar')).toBeNull()
    expect(screen.queryByText('Barra')).toBeNull()
  })

  it('Pedidos (mesero): «Domicilio» sin pedir el despacho (le daría 403)', async () => {
    sesionComo('mesero')
    backend([[/^GET \/pedidos\/activos$/, { pedidos: [pedidoDom] }]])
    montar(<Pedidos />)
    expect(await screen.findByText('Domicilio')).toBeInTheDocument()
    expect(hizo('GET', /^\/domicilios/)).toHaveLength(0)
    expect(screen.queryByText('Entregar')).toBeNull()
  })

  it('Caja: el historial nombra el cobro como «Domicilio» con su zona, no «Mesa null»', async () => {
    sesionComo('cajero')
    backend([
      [/^GET \/transacciones\?desde=hoy$/, { desde: '2026-11-13', hasta: '2026-11-13', total: 18000, cantidad: 1, transacciones: [
        { id_transaccion: 7, id_pedido: 9, codigo_pedido: 'D-9', id_mesa: null, numero_mesa: null, canal: 'domicilio', monto: 18000, metodo_pago: 'online', comensal: null, fecha: '2026-11-13T15:10:00Z', referencia_pago: 'wompi-1' },
      ] }],
      [/^GET \/domicilios\?estado_entrega=/, { domicilios: [dom(9, 'entregado', { estado: 'pagado', repartidor: RAFA })] }],
      [/^GET \/mesas/, { mesas: [] }],
    ])
    montar(<Caja />, '/caja')
    fireEvent.click(await screen.findByRole('button', { name: /HISTORIAL DE PAGOS/ }))
    expect(await screen.findByText('Domicilio')).toBeInTheDocument()
    expect(await screen.findByText('Bocagrande · Cra 3 # 5-10')).toBeInTheDocument()
    expect(screen.getByText('Pago anticipado')).toBeInTheDocument()
    expect(screen.queryByText(/Mesa null/)).toBeNull()
  })
})
