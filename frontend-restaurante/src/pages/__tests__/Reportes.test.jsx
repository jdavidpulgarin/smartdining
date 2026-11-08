import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Reportes } from '../Reportes'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

// Respuesta de GET /api/reportes (los campos que pinta el dashboard).
function reporte(totalVentas) {
  return {
    totalVentas,
    totalPedidos: 12,
    pedidosLiquidados: 10,
    tiempoCocinaPromedio: 12.5,
    ocupacionMesas: '40%',
    ticketPromedio: 45000,
    topPlatos: [],
    topIngredientes: [],
    metodosPago: [],
  }
}

function montar() {
  render(
    <MemoryRouter>
      <Reportes />
    </MemoryRouter>
  )
}

describe('Flujo de Reportes & BI en frontend-restaurante', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('pinta las cifras que devuelve GET /api/reportes', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json(reporte(540000)))
    montar()

    await waitFor(() => {
      expect(screen.getByText(/ASÍ VA/i)).toBeInTheDocument()
      expect(screen.getByText(/\$540\.000/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/datos de demostración/i)).not.toBeInTheDocument()
  })

  it('P-13: si la ruta responde 404 muestra el error y NO inventa cifras', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(json({ error: 'Ruta no encontrada' }, 404))
    montar()

    expect(await screen.findByText(/No se pudieron cargar los datos de reporte/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Ruta no encontrada')
    // Las cifras de demostración (1.280.000 del día) ya no aparecen.
    expect(screen.queryByText(/\$1\.280\.000/)).not.toBeInTheDocument()
    expect(screen.queryByText(/simulación|demostración/i)).not.toBeInTheDocument()
  })

  it('P-13: sin conexión dice "Sin conexión con el servidor" y no inventa cifras', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    montar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión con el servidor')
    expect(screen.queryByText(/\$1\.280\.000/)).not.toBeInTheDocument()
  })

  it('pinta los top que manda GET /reportes con sus nombres reales', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      json({
        ...reporte(540000),
        topPlatos: [
          { id_plato: 7, nombre: 'Hamburguesa Smart Angus', categoria: 'Fuertes', unidades: 20, total: 680000, porcentaje: 100 },
          { id_plato: 9, nombre: 'Limonada de Coco', categoria: 'Bebidas', unidades: 4, total: 36000, porcentaje: 20 },
        ],
        topIngredientes: [
          { id_ingrediente: 31, nombre_ingrediente: 'Panceta Crujiente', nombre_paso: 'Proteína', nombre_plato: 'Bowl', veces_solicitado: 12, porciones_extra: 2, porciones_normal: 10, ingresos_extras: 6000 },
        ],
      })
    )
    montar()

    expect(await screen.findByText(/1\. HAMBURGUESA SMART ANGUS/)).toBeInTheDocument()
    expect(screen.getByText(/20 vendidos · \$680\.000/)).toBeInTheDocument()
    expect(screen.getByText(/2\. LIMONADA DE COCO/)).toBeInTheDocument()
    expect(screen.getByText('Panceta Crujiente')).toBeInTheDocument()
    expect(screen.getByText('12 veces')).toBeInTheDocument()
    // Solo lo que vino: no se completa hasta 3 platos ni 6 ingredientes.
    expect(screen.queryByText(/^3\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/Arroz Integral|Bowl Personalizado|Arepa Rellena/)).not.toBeInTheDocument()
  })

  it('con listas vacías las muestra vacías: sin nombres fijos ni cifras inventadas', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      json({ ...reporte(0), totalPedidos: 0, pedidosLiquidados: 0, ticketPromedio: 0, horasPico: [], tiemposKds: [] })
    )
    montar()

    expect(await screen.findByText(/Sin platos vendidos en este periodo/)).toBeInTheDocument()
    expect(screen.getByText(/Sin ingredientes pedidos en este periodo/)).toBeInTheDocument()
    expect(screen.getByText(/Sin pagos completados en este periodo/)).toBeInTheDocument()
    expect(screen.getByText(/Sin pedidos en este periodo/)).toBeInTheDocument()
    expect(screen.getByText(/Sin comandas registradas/)).toBeInTheDocument()
    expect(screen.getByText(/todavía no incluye las ventas por día/)).toBeInTheDocument()
    expect(screen.getByText('0 liquidados')).toBeInTheDocument()

    // Nada del seed ni del diseño de muestra.
    for (const fijo of [/Bowl Personalizado/, /Arepa Rellena/, /Wrap Personalizado/, /Arroz Integral/, /Salsa de Ajo/, /212 vendidos/, /12\.4%/, /\$1,28 M/]) {
      expect(screen.queryByText(fijo)).not.toBeInTheDocument()
    }
  })

  it('al elegir "Esta semana" pide rango=semana y pinta esa respuesta', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
      json(reporte(url.includes('rango=semana') ? 3150000 : 540000))
    )
    montar()
    await waitFor(() => expect(screen.getByText(/\$540\.000/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /últimos 7 días|esta semana/i }))

    await waitFor(() => expect(screen.getByText(/\$3\.150\.000/)).toBeInTheDocument())
    expect(fetchSpy.mock.calls.some(([url]) => url.includes('/reportes?rango=semana'))).toBe(true)
  })
})
