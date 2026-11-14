import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useContext } from 'react'

const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))

import { TablesProvider } from '../TablesContext'
import { TablesContext } from '../tablesContextDef'
import { BandejaAlertas } from '../../components/BandejaAlertas'
import { mesaDelAviso } from '../../utils/avisos'

function Vista() {
  const { alertas, notification } = useContext(TablesContext)
  return (
    <>
      <span data-testid="mesas">{alertas.map((a) => String(a.idMesa)).join(',')}</span>
      <span data-testid="aviso">{notification?.mensaje || ''}</span>
      <BandejaAlertas alertas={alertas} onAtender={() => {}} onLimpiarTodas={() => {}} />
    </>
  )
}

describe('utils/avisos · mesaDelAviso', () => {
  it('toma id_mesa o mesa si es un entero > 0; si no, null (nunca la Mesa 1 por defecto)', () => {
    expect(mesaDelAviso({ id_mesa: 3 })).toBe(3)
    expect(mesaDelAviso({ mesa: '4' })).toBe(4)
    for (const d of [{}, null, undefined, { id_mesa: 0 }, { id_mesa: -2 }, { id_mesa: 'abc' }, { mesa: 1.5 }]) {
      expect(mesaDelAviso(d)).toBeNull()
    }
  })
})

describe('TablesContext: un aviso sin número de mesa', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const e of Object.keys(oyentes)) delete oyentes[e]
    sessionStorage.clear()
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}),
    })
    render(<TablesProvider><Vista /></TablesProvider>)
  })

  it.each([
    ['mesa:llamar_mesero', 'Una mesa sin número llama al mesero'],
    ['waiter:call', 'Una mesa sin número llama al mesero'],
    ['cuenta:solicitada', 'Una mesa sin número solicita la cuenta'],
    ['bill:requested', 'Una mesa sin número solicita la cuenta'],
  ])('%s sin mesa: alerta de «mesa desconocida» (no Mesa 1) y queda en el log', (evento, aviso) => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => oyentes[evento]({}))
    expect(screen.getByTestId('mesas')).toHaveTextContent('null')
    expect(screen.getByTestId('aviso')).toHaveTextContent(aviso)
    expect(log).toHaveBeenCalledWith('[alertas] aviso sin número de mesa:', {})
  })

  it('la bandeja de alertas la muestra como MESA DESCONOCIDA', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    act(() => oyentes['mesa:llamar_mesero']({}))
    expect(screen.getAllByText(/MESA DESCONOCIDA/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/MESA 1 ·/)).toBeNull()
  })
})
