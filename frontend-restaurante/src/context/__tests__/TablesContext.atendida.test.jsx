import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { useContext, useEffect } from 'react'

// mesa:atendida (socket-server/EVENTS.md §4) desde la bandeja del panel.
// Socket simulado: los oyentes se disparan a mano y cada emit guarda su ack
// para responderlo cuando la prueba quiera (o nunca).
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))
const socket = {
  connected: true,
  emitidos: [],
  esperas: [],
  timeout(ms) {
    this.esperas.push(ms)
    return this
  },
  emit(evento, data, ack) {
    this.emitidos.push({ evento, data, ack })
  },
  on() {},
  off() {},
}
vi.mock('../../hooks/useSocket', () => ({ getSocket: () => socket }))
// El cierre de sesión de un 401 (cerrarSesionInvalida) se espía: el real
// redirige con window.location, que jsdom no implementa.
const cerrarSesionInvalida = vi.fn()
vi.mock('../../services/api', async (original) => ({
  ...(await original()),
  cerrarSesionInvalida: (...args) => cerrarSesionInvalida(...args),
}))

import { TablesProvider, AVISO_ATENDIDA_SOLO_AQUI, AVISO_ATENDIDA_REINTENTAR } from '../TablesContext'
import { TablesContext } from '../tablesContextDef'
import { BandejaAlertas } from '../../components/BandejaAlertas'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// id_mesa ≠ número: la mesa 3 del salón tiene id_mesa 10. El evento lleva el id.
const fila = (id, numero) => ({
  id, id_mesa: id, number: numero, numero, name: `Mesa ${numero}`, status: 'Ocupada', estado: 'ocupada',
  seats: 4, capacidad: 4, location: 'Salón', ubicacion: 'Salón', sesion_abierta: true, token_qr: null, qr_url: null,
  active: true, detail: '', openedAt: null, expiresAt: null,
})

const vivo = { ctx: null }
function Vista() {
  const c = useContext(TablesContext)
  useEffect(() => {
    vivo.ctx = c
  })
  return (
    <>
      <span data-testid="aviso">{c.notification?.mensaje || ''}</span>
      <BandejaAlertas alertas={c.alertas} onAtender={c.atenderAlerta} onLimpiarTodas={c.limpiarAlertas} />
    </>
  )
}

const disparar = (evento, data) => act(() => oyentes[evento](data))
const llamado = (idMesa, motivo) => disparar('mesa:llamar_mesero', { eventId: crypto.randomUUID(), id_mesa: idMesa, motivo })
const cuenta = (idMesa) => disparar('cuenta:solicitada', { eventId: crypto.randomUUID(), id_mesa: idMesa })
const atendida = (eventId, idMesa, tipo) => disparar('mesa:atendida', { eventId, id_mesa: idMesa, tipo, emitidoEn: new Date().toISOString() })

const MSG_CUENTA = 'Comensales solicitan la cuenta y factura'
const item = (texto) => screen.getByText(texto).closest('.sd-alerta-item')
const boton = (texto) => within(item(texto)).getByRole('button')
const clic = (texto) => fireEvent.click(boton(texto))
const hay = (texto) => screen.queryByText(texto) !== null
const atendidas = () => socket.emitidos.filter((e) => e.evento === 'mesa:atendida')
const responder = (i, err, r) => act(() => atendidas()[i].ack(err, r))
const aviso = () => screen.getByTestId('aviso').textContent

beforeEach(() => {
  vi.restoreAllMocks()
  cerrarSesionInvalida.mockClear()
  for (const e of Object.keys(oyentes)) delete oyentes[e]
  socket.connected = true
  socket.emitidos = []
  socket.esperas = []
  sessionStorage.clear()
  sessionStorage.setItem('smartdining_tables_state', JSON.stringify([fila(10, 3), fila(11, 4)]))
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}),
  })
  render(
    <TablesProvider>
      <Vista />
    </TablesProvider>
  )
})

describe('TablesContext · «Atendida» emite mesa:atendida', () => {
  it('llamado: cuerpo exacto { eventId UUID, idMesa = id_mesa, tipo: "llamado" } con ack; ok quita la alerta', () => {
    llamado(10, 'Más servilletas')
    expect(within(item('Más servilletas')).getByText(/MESA 3/)).toBeInTheDocument()
    clic('Más servilletas')

    expect(atendidas()).toHaveLength(1)
    const { data } = atendidas()[0]
    expect(Object.keys(data).sort()).toEqual(['eventId', 'idMesa', 'tipo'])
    expect(data.eventId).toMatch(UUID)
    expect(data.idMesa).toBe(10) // el id_mesa, no el número 3
    expect(data.tipo).toBe('llamado')
    expect(socket.esperas.at(-1)).toBe(5000)

    // Hasta el ack, la alerta sigue (y su botón, desactivado).
    expect(hay('Más servilletas')).toBe(true)
    responder(0, null, { ok: true, eventId: data.eventId, duplicado: false })
    expect(hay('Más servilletas')).toBe(false)
  })

  it('cuenta: tipo "cuenta"; un ack duplicado: true también la quita', () => {
    cuenta(11)
    clic(MSG_CUENTA)
    const { data } = atendidas()[0]
    expect(data).toEqual({ eventId: expect.stringMatching(UUID), idMesa: 11, tipo: 'cuenta' })
    responder(0, null, { ok: true, eventId: data.eventId, duplicado: true })
    expect(hay(MSG_CUENTA)).toBe(false)
  })

  it('cada alerta lleva un eventId nuevo', () => {
    llamado(10, 'Uno')
    llamado(11, 'Dos')
    clic('Uno')
    clic('Dos')
    const [a, b] = atendidas().map((e) => e.data.eventId)
    expect(a).not.toBe(b)
  })

  it('el botón queda desactivado mientras espera el ack: un doble clic emite una sola vez', () => {
    llamado(10, 'Agua')
    clic('Agua')
    expect(boton('Agua')).toBeDisabled()
    clic('Agua')
    fireEvent.click(boton('Agua'))
    // Aunque el botón no se desactivara a tiempo, el contexto tampoco repite.
    act(() => vivo.ctx.atenderAlerta(vivo.ctx.alertas[0].id))
    expect(atendidas()).toHaveLength(1)
    responder(0, null, { ok: true })
    expect(hay('Agua')).toBe(false)
  })
})

describe('TablesContext · al recibir mesa:atendida', () => {
  it('de otra pantalla: quita solo las alertas de esa mesa y ese tipo', () => {
    llamado(10, 'Llamado de la 3')
    llamado(10, 'Otro llamado de la 3')
    cuenta(10)
    llamado(11, 'Llamado de la 4')

    atendida(crypto.randomUUID(), 10, 'llamado')

    expect(hay('Llamado de la 3')).toBe(false)
    expect(hay('Otro llamado de la 3')).toBe(false)
    expect(hay(MSG_CUENTA)).toBe(true) // otro tipo, misma mesa
    expect(hay('Llamado de la 4')).toBe(true) // otra mesa
    expect(atendidas()).toHaveLength(0) // recibir no emite nada
  })

  it('el mismo eventId recibido dos veces no rompe nada y no se vuelve a aplicar', () => {
    llamado(10, 'Primero')
    const eventId = crypto.randomUUID()
    atendida(eventId, 10, 'llamado')
    atendida(eventId, 10, 'llamado')
    expect(hay('Primero')).toBe(false)

    // Un llamado NUEVO de la misma mesa no se borra con el aviso repetido.
    llamado(10, 'Llamado nuevo')
    atendida(eventId, 10, 'llamado')
    expect(hay('Llamado nuevo')).toBe(true)
  })

  it('el que emitió esta pantalla también llega (se ignora sin problema)', () => {
    llamado(10, 'Mío')
    clic('Mío')
    const { data } = atendidas()[0]
    atendida(data.eventId, 10, 'llamado') // llega antes que el ack
    expect(hay('Mío')).toBe(false)
    responder(0, null, { ok: true, eventId: data.eventId, duplicado: false })
    expect(hay('Mío')).toBe(false)
  })

  it('un aviso con mesa o tipo inválidos no toca nada', () => {
    llamado(10, 'Queda')
    atendida(crypto.randomUUID(), 0, 'llamado')
    atendida(crypto.randomUUID(), 10, 'pedido_listo')
    atendida(crypto.randomUUID(), '10x', 'llamado')
    expect(hay('Queda')).toBe(true)
  })
})

describe('TablesContext · ack con error', () => {
  it('ERROR_INTERNO: la alerta sigue, sale el aviso y el reintento usa el MISMO eventId', () => {
    llamado(10, 'Reintento')
    clic('Reintento')
    const primero = atendidas()[0].data.eventId
    responder(0, null, { ok: false, codigo: 'ERROR_INTERNO', eventId: primero })

    expect(hay('Reintento')).toBe(true)
    expect(boton('Reintento')).not.toBeDisabled()
    expect(aviso()).toBe(AVISO_ATENDIDA_REINTENTAR)

    clic('Reintento')
    expect(atendidas()).toHaveLength(2)
    expect(atendidas()[1].data).toEqual({ eventId: primero, idMesa: 10, tipo: 'llamado' })
    responder(1, null, { ok: true, eventId: primero, duplicado: false })
    expect(hay('Reintento')).toBe(false)
  })

  it('sin respuesta (timeout del ack): igual que ERROR_INTERNO', () => {
    cuenta(10)
    clic(MSG_CUENTA)
    const primero = atendidas()[0].data.eventId
    responder(0, new Error('operation has timed out'))
    expect(hay(MSG_CUENTA)).toBe(true)
    expect(aviso()).toBe(AVISO_ATENDIDA_REINTENTAR)
    clic(MSG_CUENTA)
    expect(atendidas()[1].data.eventId).toBe(primero)
  })

  it('el aviso de PAYLOAD_INVALIDO y NO_AUTORIZADO habla del cliente, no de la mesa', () => {
    expect(AVISO_ATENDIDA_SOLO_AQUI).toBe('No se pudo avisar al cliente; la alerta se quitó solo en esta pantalla')
  })

  it('PAYLOAD_INVALIDO: se quita solo en esta pantalla, con aviso, no se reintenta y NO cierra la sesión', () => {
    llamado(10, 'Mesa borrada')
    llamado(10, 'Otro de la misma mesa')
    clic('Mesa borrada')
    responder(0, null, { ok: false, codigo: 'PAYLOAD_INVALIDO', mensaje: 'idMesa no corresponde a ninguna mesa' })

    expect(hay('Mesa borrada')).toBe(false)
    expect(hay('Otro de la misma mesa')).toBe(true) // solo la pulsada
    expect(aviso()).toBe('No se pudo avisar al cliente; la alerta se quitó solo en esta pantalla')
    expect(atendidas()).toHaveLength(1)
    expect(cerrarSesionInvalida).not.toHaveBeenCalled()
  })

  it('NO_AUTORIZADO: se quita solo aquí, con aviso, y cierra la sesión como un 401 (al login)', () => {
    cuenta(11)
    clic(MSG_CUENTA)
    responder(0, null, { ok: false, codigo: 'NO_AUTORIZADO' })
    expect(hay(MSG_CUENTA)).toBe(false)
    expect(aviso()).toBe('No se pudo avisar al cliente; la alerta se quitó solo en esta pantalla')
    expect(atendidas()).toHaveLength(1)
    expect(cerrarSesionInvalida).toHaveBeenCalledTimes(1)
  })

  it('ERROR_INTERNO y sin respuesta no cierran la sesión', () => {
    llamado(10, 'Falla')
    clic('Falla')
    responder(0, null, { ok: false, codigo: 'ERROR_INTERNO' })
    clic('Falla')
    responder(1, new Error('operation has timed out'))
    expect(cerrarSesionInvalida).not.toHaveBeenCalled()
  })

  it('sin conexión: no emite, la alerta sigue con aviso y conserva su eventId para el reintento', () => {
    llamado(10, 'Sin red')
    socket.connected = false
    clic('Sin red')
    expect(atendidas()).toHaveLength(0)
    expect(hay('Sin red')).toBe(true)
    expect(aviso()).toBe(AVISO_ATENDIDA_REINTENTAR)
    const guardado = vivo.ctx.alertas[0].eventIdAtendida
    expect(guardado).toMatch(UUID)

    clic('Sin red') // sigue sin conexión: mismo eventId
    expect(vivo.ctx.alertas[0].eventIdAtendida).toBe(guardado)

    socket.connected = true
    clic('Sin red')
    expect(atendidas()).toHaveLength(1)
    expect(atendidas()[0].data.eventId).toBe(guardado)
  })
})

describe('TablesContext · alertas que se quitan solo en local', () => {
  it('pedido listo y pago: se quitan sin emitir', () => {
    disparar('order:status', {
      eventId: 'e1', id_pedido: 7, id_mesa: 10, codigo_pedido: 'PED-7', estado: 'listo', emitidoEn: new Date().toISOString(),
    })
    const listo = 'Pedido PED-7 listo en cocina para servir'
    clic(listo)
    expect(hay(listo)).toBe(false)

    disparar('payment:confirmed', { eventId: 'e2', id_mesa: 10, monto: 1000 })
    const pago = /Pago confirmado por \$/
    fireEvent.click(within(screen.getByText(pago).closest('.sd-alerta-item')).getByRole('button'))
    expect(screen.queryByText(pago)).toBeNull()
    expect(atendidas()).toHaveLength(0)
  })

  it('llamado o cuenta sin idMesa válido: se quita sin emitir', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    disparar('mesa:llamar_mesero', { eventId: 'x', motivo: 'Sin mesa' })
    clic('Sin mesa')
    expect(hay('Sin mesa')).toBe(false)
    expect(atendidas()).toHaveLength(0)
  })

  it('heredados (waiter:call, bill:requested): se quitan sin emitir y mesa:atendida no los toca', () => {
    disparar('waiter:call', { mesa: 10, motivo: 'Heredado' })
    disparar('bill:requested', { mesa: 10 })
    expect(vivo.ctx.alertas.every((a) => a.origen === 'heredado')).toBe(true)

    atendida(crypto.randomUUID(), 10, 'llamado')
    expect(hay('Heredado')).toBe(true)

    clic('Heredado')
    clic(MSG_CUENTA)
    expect(hay('Heredado')).toBe(false)
    expect(hay(MSG_CUENTA)).toBe(false)
    expect(atendidas()).toHaveLength(0)
  })

  it('«Limpiar todas» sigue local, sin emitir nada', () => {
    llamado(10, 'A')
    cuenta(11)
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar todas las alertas' }))
    expect(hay('A')).toBe(false)
    expect(hay(MSG_CUENTA)).toBe(false)
    expect(atendidas()).toHaveLength(0)
  })
})
