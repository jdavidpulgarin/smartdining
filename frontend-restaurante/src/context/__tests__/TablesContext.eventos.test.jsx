import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// Socket simulado: guarda los oyentes para disparar eventos a mano.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))

import { TablesProvider } from '../TablesContext'
import { useContext } from 'react'
import { TablesContext } from '../tablesContextDef'
import { emitirSonidoAlerta } from '../../utils/audio'

function Vista() {
  const { pedidosActivos, alertas } = useContext(TablesContext)
  return (
    <>
      <span data-testid="pedidos">{pedidosActivos.map((p) => p.id_pedido).join(',')}</span>
      <span data-testid="alertas">{alertas.length}</span>
    </>
  )
}

const pedido = { id_pedido: 87, codigo_pedido: 'PED-1', id_mesa: 5, estado: 'recibido' }
const creado = (eventId) => ({ eventId, pedido, emitidoEn: new Date().toISOString() })
const estado = (eventId, nuevo) => ({
  eventId, id_pedido: 87, id_mesa: 5, codigo_pedido: 'PED-1', estado: nuevo, emitidoEn: new Date().toISOString(),
})

function disparar(evento, data) {
  act(() => oyentes[evento](data))
}

describe('TablesContext: order:created y order:status deduplicados por eventId', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    emitirSonidoAlerta.mockClear()
    for (const e of Object.keys(oyentes)) delete oyentes[e]
    sessionStorage.clear()
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({}),
    })
    render(
      <TablesProvider>
        <Vista />
      </TablesProvider>
    )
  })

  it('un order:created reintentado tarde no resucita un pedido ya cancelado', () => {
    disparar('order:created', creado('evt-creado'))
    expect(screen.getByTestId('pedidos')).toHaveTextContent('87')

    disparar('order:status', estado('evt-cancelado', 'cancelado'))
    expect(screen.getByTestId('pedidos')).toHaveTextContent('')

    // El servidor reintenta el MISMO evento: se ignora entero.
    disparar('order:created', creado('evt-creado'))
    expect(screen.getByTestId('pedidos')).toHaveTextContent('')
  })

  it('un "listo" repetido con el mismo eventId alerta y suena una sola vez', () => {
    disparar('order:created', creado('evt-creado'))
    disparar('order:status', estado('evt-listo', 'listo'))
    disparar('order:status', estado('evt-listo', 'listo'))

    expect(screen.getByTestId('alertas')).toHaveTextContent('1')
    expect(emitirSonidoAlerta).toHaveBeenCalledTimes(1)
  })

  it('dos eventos distintos sí se aplican los dos', () => {
    disparar('order:status', estado('evt-listo-1', 'listo'))
    disparar('order:status', estado('evt-listo-2', 'listo'))
    expect(screen.getByTestId('alertas')).toHaveTextContent('2')
  })
})
