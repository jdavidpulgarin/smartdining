import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useContext } from 'react'

// Socket simulado: guarda los oyentes para disparar eventos a mano.
const oyentes = {}
vi.mock('../../hooks', () => ({
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))

import { TablesProvider } from '../TablesContext'
import { TablesContext } from '../tablesContextDef'
import { emitirSonidoAlerta } from '../../utils/audio'

// Mesas guardadas como las deja el propio contexto (sessionStorage), sin sesión
// de personal: así el contexto no pide nada al backend al montar.
const MESAS = [1, 2, 3].map((n) => ({
  id: n, id_mesa: n, number: n, numero: n, name: `Mesa ${n}`, status: 'Ocupada', estado: 'ocupada',
  seats: 4, capacidad: 4, location: 'Salón', ubicacion: 'Salón', sesion_abierta: true,
  token_qr: `tok-${n}`, qr_url: `http://x/?mesa=${n}`, active: true, detail: 'Sesión activa · QR generado',
}))

function Vista() {
  const { tables, alertas, presenciaPorMesa, notification, atenderAlerta, limpiarAlertas } = useContext(TablesContext)
  return (
    <>
      <ul>
        {tables.map((t) => (
          <li key={t.id} data-testid={`mesa-${t.id}`}>{`${t.estado}|${t.token_qr}|${t.detail}`}</li>
        ))}
      </ul>
      <ul>
        {alertas.map((a) => (
          <li key={a.id} data-testid="alerta">
            {`${a.tipo}|${a.idMesa}|${a.mensaje}`}
            <button type="button" onClick={() => atenderAlerta(a.id)}>{`atender ${a.tipo}`}</button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={limpiarAlertas}>limpiar</button>
      <span data-testid="presencia">{JSON.stringify(presenciaPorMesa)}</span>
      <span data-testid="aviso">{notification?.mensaje || ''}</span>
    </>
  )
}

const disparar = (evento, data) => act(() => oyentes[evento](data))
const alertas = () => screen.queryAllByTestId('alerta').map((a) => a.firstChild.textContent)

describe('TablesContext: alertas y cambios de mesa en vivo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    emitirSonidoAlerta.mockClear()
    for (const e of Object.keys(oyentes)) delete oyentes[e]
    sessionStorage.clear()
    sessionStorage.setItem('smartdining_tables_state', JSON.stringify(MESAS))
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}),
    })
    render(
      <TablesProvider>
        <Vista />
      </TablesProvider>
    )
  })

  it('mesa:llamar_mesero: alerta de llamado en esa mesa, con sonido y aviso', () => {
    disparar('mesa:llamar_mesero', { id_mesa: 3 })
    expect(alertas()).toEqual(['llamado|3|Comensal solicita asistencia urgente en mesa'])
    expect(emitirSonidoAlerta).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('aviso')).toHaveTextContent('Mesa 3 llama al mesero')
  })

  it('waiter:call (nombre viejo) hace lo mismo y respeta el motivo si viene', () => {
    disparar('waiter:call', { id_mesa: 2, motivo: 'Necesitan servilletas' })
    expect(alertas()).toEqual(['llamado|2|Necesitan servilletas'])
  })

  it('cuenta:solicitada y bill:requested: alerta de cuenta', () => {
    disparar('cuenta:solicitada', { id_mesa: 1 })
    disparar('bill:requested', { mesa: 2 })
    expect(alertas()).toEqual(['cuenta|2|Comensales solicitan la cuenta y factura', 'cuenta|1|Comensales solicitan la cuenta y factura'])
    expect(screen.getByTestId('aviso')).toHaveTextContent('Mesa 2 solicita la cuenta')
  })

  it('payment:confirmed: alerta de pago con el monto en pesos', () => {
    disparar('payment:confirmed', { id_mesa: 2, monto: 58000 })
    expect(alertas()).toEqual(['pago|2|Pago confirmado por $58.000 (Mesa 2)'])
    expect(emitirSonidoAlerta).toHaveBeenCalledTimes(1)
  })

  it('payment:confirmed sin mesa no hace nada', () => {
    disparar('payment:confirmed', { monto: 1000 })
    expect(alertas()).toEqual([])
  })

  it('atender quita esa alerta; limpiar las quita todas', () => {
    disparar('mesa:llamar_mesero', { id_mesa: 1 })
    disparar('cuenta:solicitada', { id_mesa: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'atender llamado' }))
    expect(alertas()).toEqual(['cuenta|2|Comensales solicitan la cuenta y factura'])
    fireEvent.click(screen.getByRole('button', { name: 'limpiar' }))
    expect(alertas()).toEqual([])
  })

  it('mesa:liberada (y table:released): la mesa queda disponible y sin QR, y se borra su presencia', () => {
    disparar('mesa:presencia', { id_mesa: 2, comensales: ['Ana'] })
    expect(screen.getByTestId('presencia')).toHaveTextContent('"2"')
    disparar('mesa:liberada', { id_mesa: 2 })
    expect(screen.getByTestId('mesa-2')).toHaveTextContent('disponible|null|Lista para asignar')
    expect(screen.getByTestId('presencia')).not.toHaveTextContent('"2"')
    disparar('table:released', { id_mesa: 3 })
    expect(screen.getByTestId('mesa-3')).toHaveTextContent('disponible|null|Lista para asignar')
    expect(screen.getByTestId('mesa-1')).toHaveTextContent('ocupada|tok-1')
  })

  it('qr:actualizado: la mesa toma el token nuevo y queda ocupada con sesión', () => {
    disparar('mesa:liberada', { id_mesa: 1 })
    disparar('qr:actualizado', { id_mesa: 1, token_qr: 'tok-nuevo' })
    expect(screen.getByTestId('mesa-1')).toHaveTextContent('ocupada|tok-nuevo|QR sincronizado en vivo por el servidor')
  })

  it('qr:actualizado sin token no toca la mesa', () => {
    disparar('qr:actualizado', { id_mesa: 1 })
    expect(screen.getByTestId('mesa-1')).toHaveTextContent('ocupada|tok-1')
  })

  it('order:created marca la mesa como ocupada con el código de la comanda', () => {
    disparar('mesa:liberada', { id_mesa: 3 })
    disparar('order:created', { eventId: 'e1', pedido: { id_pedido: 9, codigo_pedido: 'PED-9', id_mesa: 3, estado: 'recibido' } })
    expect(screen.getByTestId('mesa-3')).toHaveTextContent('ocupada|null|Comanda PED-9 · En cocina')
    expect(screen.getByTestId('aviso')).toHaveTextContent('Nuevo pedido recibido: PED-9 (Mesa 3)')
  })

  it('order:status entregado avisa sin alerta ni sonido', () => {
    disparar('order:status', { eventId: 's1', id_pedido: 9, id_mesa: 3, codigo_pedido: 'PED-9', estado: 'entregado' })
    expect(alertas()).toEqual([])
    expect(emitirSonidoAlerta).not.toHaveBeenCalled()
    expect(screen.getByTestId('aviso')).toHaveTextContent('Pedido PED-9 entregado a los comensales')
  })
})
