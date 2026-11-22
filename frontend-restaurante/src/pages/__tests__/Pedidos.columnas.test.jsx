import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Socket simulado: guarda los oyentes para poder disparar eventos a mano.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
  useSocketEmit: () => vi.fn(),
  useAuth: () => ({ user: { rol: 'admin' } }),
}))

import { Pedidos } from '../Pedidos'

// La columna de cada estado del backend. Un estado desconocido o vacío cae en
// Pendientes (default de backendEstadoAUI), también «cancelado», que no debería
// llegar: GET /pedidos/activos no lo trae y order:status lo saca de la lista.
const COLUMNA = {
  recibido: 'PENDIENTES',
  en_preparacion: 'EN COCINA',
  listo: 'POR SERVIR',
  entregado: 'ENTREGADAS',
  pagado: 'ENTREGADAS',
  cancelado: 'PENDIENTES',
}
const RAROS = ['estado_nuevo', '', null, undefined]
const COLUMNAS = ['PENDIENTES', 'EN COCINA', 'POR SERVIR', 'ENTREGADAS']
const CASOS = [...Object.entries(COLUMNA), ...RAROS.map((e) => [e, 'PENDIENTES'])]

const codigo = (i) => `PED-COL-${String(i).padStart(2, '0')}`
// Dos comandas por estado: una columna que se quedara solo con la primera se nota.
const comandas = [...CASOS, ...CASOS].map(([estado, columna], i) => ({
  columna,
  pedido: {
    id_pedido: i + 1,
    codigo_pedido: codigo(i),
    id_mesa: (i % 5) + 1,
    estado,
    total: 10000 + i,
    detalles: [{ id_detalle: i + 1, nombre: `Plato ${i}`, cantidad: 1, comensal: 'Ana' }],
  },
}))

async function montar(pedidos) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ pedidos }),
  })
  render(
    <MemoryRouter>
      <Pedidos />
    </MemoryRouter>
  )
  await waitFor(() => expect(screen.queryByText(/CARGANDO COMANDAS/)).toBeNull())
}

/** Las columnas pintadas: { titulo: { contador, codigos } }, en orden. */
function columnas() {
  return Object.fromEntries(
    screen.getAllByRole('heading', { level: 2 }).map((h) => {
      const [, titulo, contador] = h.textContent.match(/^(.*?)(\d+)$/)
      const codigos = within(h.parentElement)
        .queryAllByText(/PED-COL-\d+/)
        .map((n) => n.textContent.match(/PED-COL-\d+/)[0])
      return [titulo, { contador: Number(contador), codigos }]
    })
  )
}

const esperados = (columna) => comandas.filter((c) => c.columna === columna).map((c) => c.pedido.codigo_pedido)

/** Cada código de `lista` está pintado exactamente una vez en toda la pantalla. */
function unaSolaVez(lista) {
  const pintados = Object.values(columnas()).flatMap((c) => c.codigos)
  expect([...pintados].sort()).toEqual([...lista].sort())
  for (const cod of lista) expect(screen.getAllByText(new RegExp(cod))).toHaveLength(1)
}

const filtrar = (nombre) => fireEvent.click(screen.getByRole('button', { name: nombre }))

describe('Pedidos: cada comanda cae en exactamente una columna', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const evento of Object.keys(oyentes)) delete oyentes[evento]
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('estas pruebas recorren todos los ESTADOS_VALIDOS del backend', () => {
    const fuente = readFileSync(resolve(process.cwd(), '../backend/src/services/pedidos.service.js'), 'utf8')
    const lista = fuente.match(/const ESTADOS_VALIDOS = \[([^\]]+)\]/)[1]
    const estados = [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(estados.length).toBeGreaterThan(0)
    expect(Object.keys(COLUMNA).sort()).toEqual([...estados].sort())
  })

  it.each(CASOS)('estado %j → solo en %s', async (estado, columna) => {
    const { pedido } = comandas[CASOS.findIndex(([e]) => e === estado)]
    await montar([pedido])
    const cols = columnas()
    expect(cols[columna].codigos).toEqual([pedido.codigo_pedido])
    expect(Object.values(cols).flatMap((c) => c.codigos)).toHaveLength(1)
  })

  it('con «Todas», las cuatro columnas reparten todas las comandas sin perder ni repetir ninguna', async () => {
    await montar(comandas.map((c) => c.pedido))
    const cols = columnas()
    expect(Object.keys(cols)).toEqual(COLUMNAS)
    for (const c of COLUMNAS) {
      expect(cols[c].codigos).toEqual(esperados(c))
      expect(cols[c].contador).toBe(esperados(c).length)
    }
    unaSolaVez(comandas.map((c) => c.pedido.codigo_pedido))
  })

  it.each([
    [/^PENDIENTES/, 'PENDIENTES'],
    [/^EN COCINA/, 'EN COCINA'],
    [/^POR SERVIR/, 'POR SERVIR'],
    [/^ENTREGADAS/, 'ENTREGADAS'],
  ])('con el filtro %s solo sale su columna, completa', async (boton, columna) => {
    await montar(comandas.map((c) => c.pedido))
    filtrar(boton)
    expect(Object.keys(columnas())).toEqual([columna])
    expect(columnas()[columna].codigos).toEqual(esperados(columna))
    unaSolaVez(esperados(columna))
    filtrar(/^TODAS/)
    unaSolaVez(comandas.map((c) => c.pedido.codigo_pedido))
  })

  it('la suma de los cuatro filtros es exactamente la lista de «Todas»', async () => {
    await montar(comandas.map((c) => c.pedido))
    const vistos = []
    for (const boton of [/^PENDIENTES/, /^EN COCINA/, /^POR SERVIR/, /^ENTREGADAS/]) {
      filtrar(boton)
      vistos.push(...Object.values(columnas()).flatMap((c) => c.codigos))
    }
    expect(vistos.sort()).toEqual(comandas.map((c) => c.pedido.codigo_pedido).sort())
  })

  it('sin entregadas, «Todas» muestra las otras tres columnas, aunque estén vacías', async () => {
    await montar([comandas[0].pedido])
    expect(Object.keys(columnas())).toEqual(['PENDIENTES', 'EN COCINA', 'POR SERVIR'])
    expect(columnas()['EN COCINA']).toEqual({ contador: 0, codigos: [] })
  })

  it('al cambiar de estado en vivo, la comanda pasa de columna y nunca queda en dos', async () => {
    const { pedido } = comandas[0]
    await montar([pedido])
    for (const [i, [estado, columna]] of CASOS.filter(([e]) => e !== 'cancelado').entries()) {
      act(() => oyentes['order:status']({ eventId: `evt-${i}`, id_pedido: pedido.id_pedido, estado }))
      expect(columnas()[columna].codigos).toEqual([pedido.codigo_pedido])
      unaSolaVez([pedido.codigo_pedido])
    }
    act(() => oyentes['order:status']({ eventId: 'evt-fin', id_pedido: pedido.id_pedido, estado: 'cancelado' }))
    expect(screen.queryByText(new RegExp(pedido.codigo_pedido))).toBeNull()
  })

  it('una comanda nueva en vivo entra en una sola columna', async () => {
    await montar([])
    act(() => oyentes['order:created']({ eventId: 'evt-nueva', pedido: comandas[2].pedido }))
    expect(columnas()['POR SERVIR'].codigos).toEqual([comandas[2].pedido.codigo_pedido])
    unaSolaVez([comandas[2].pedido.codigo_pedido])
  })
})
