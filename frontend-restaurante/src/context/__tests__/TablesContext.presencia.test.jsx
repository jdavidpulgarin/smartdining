import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { useContext } from 'react'

// Socket simulado: los listeners de eventos y un socket con emit/on de verdad.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))

const socket = {
  connected: false,
  handlers: {},
  emitidos: [],
  respuesta: null,
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn) },
  off(ev, fn) { this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn) },
  timeout() { return this },
  emit(ev, data, ack) { this.emitidos.push(ev); ack(null, this.respuesta) },
  conectar() { this.connected = true; (this.handlers.connect || []).forEach((f) => f()) },
}
vi.mock('../../hooks/useSocket', () => ({ getSocket: () => socket }))

import { TablesProvider } from '../TablesContext'
import { TablesContext } from '../tablesContextDef'

function Vista() {
  const { presenciaPorMesa } = useContext(TablesContext)
  return <span data-testid="presencia">{JSON.stringify(presenciaPorMesa)}</span>
}

const presencia = (id, comensales, sin = []) => ({ id_mesa: id, comensales, total: comensales.length, pagaron: [], sin_celular: sin })

describe('TablesContext: mesa:presencia:solicitar en cada conexión', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    socket.connected = false
    socket.handlers = {}
    socket.emitidos = []
    socket.respuesta = null
    sessionStorage.clear()
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ mesas: [], pedidos: [] }) })
  })

  it('al conectar pide la presencia y guarda la foto completa de las mesas', () => {
    socket.respuesta = { ok: true, mesas: [presencia(2, ['Abuela'], ['Abuela']), presencia(4, ['Carla'])] }
    render(<TablesProvider><Vista /></TablesProvider>)
    expect(socket.emitidos).toEqual([])
    act(() => socket.conectar())
    expect(socket.emitidos).toEqual(['mesa:presencia:solicitar'])
    const p = JSON.parse(screen.getByTestId('presencia').textContent)
    expect(Object.keys(p)).toEqual(['2', '4'])
    expect(p[4].comensales).toEqual(['Carla'])
  })

  it('si ya estaba conectado al montar, la pide de una vez', () => {
    socket.connected = true
    socket.respuesta = { ok: true, mesas: [presencia(3, ['Ana'])] }
    render(<TablesProvider><Vista /></TablesProvider>)
    expect(socket.emitidos).toEqual(['mesa:presencia:solicitar'])
    expect(JSON.parse(screen.getByTestId('presencia').textContent)[3].comensales).toEqual(['Ana'])
  })

  it('al reconectar la vuelve a pedir y reemplaza la foto (la mesa que ya no viene desaparece)', () => {
    socket.respuesta = { ok: true, mesas: [presencia(2, ['Abuela']), presencia(4, ['Carla'])] }
    render(<TablesProvider><Vista /></TablesProvider>)
    act(() => socket.conectar())
    socket.respuesta = { ok: true, mesas: [presencia(4, ['Carla', 'Beto'])] }
    act(() => socket.conectar())
    const p = JSON.parse(screen.getByTestId('presencia').textContent)
    expect(Object.keys(p)).toEqual(['4'])
    expect(p[4].total).toBe(2)
  })

  it('si responde RATE_LIMIT no toca lo que había (queda el envío automático y los avisos)', () => {
    socket.respuesta = { ok: true, mesas: [presencia(2, ['Abuela'])] }
    render(<TablesProvider><Vista /></TablesProvider>)
    act(() => socket.conectar())
    socket.respuesta = { ok: false, codigo: 'RATE_LIMIT' }
    act(() => socket.conectar())
    expect(Object.keys(JSON.parse(screen.getByTestId('presencia').textContent))).toEqual(['2'])
  })
})
