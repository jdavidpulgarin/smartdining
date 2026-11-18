import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import { useContext, useEffect } from 'react'

// Regresión de la v1.0.0 (FALLO 2): con mesas de id ≠ número, abrir la mesa 13
// abría también la 10. El panel comparaba «t.id === n || t.number === n»: si el
// id_mesa de una mesa es el número de otra, las dos «eran» la misma.
// Aquí: la mesa 13 tiene id_mesa 10 y la mesa 10 tiene id_mesa 13.
const oyentes = {}
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal()),
  useSocketListener: (evento, callback) => {
    oyentes[evento] = callback
  },
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))

import { TablesProvider } from '../TablesContext'
import { TablesContext } from '../tablesContextDef'
import { TablesPanel } from '../../components/TablesPanel'
import { BandejaAlertas } from '../../components/BandejaAlertas'
import { mismaMesa, buscarMesa, numeroDeMesa } from '../../utils/mesaActualizada'

const fila = (id, numero) => ({
  id, id_mesa: id, number: numero, numero, name: `Mesa ${numero}`, status: 'Disponible', estado: 'disponible',
  seats: 4, capacidad: 4, location: 'Salón', ubicacion: 'Salón', sesion_abierta: false, token_qr: null, qr_url: null,
  active: false, detail: 'Lista para asignar', openedAt: null, expiresAt: null,
})
// Ordenadas por número, como las deja el panel: la 10 (id 13) va ANTES que la 13 (id 10).
const CRUZADAS = [fila(13, 10), fila(10, 13)]

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const tokenDe = (idMesa, sid) => `v1.${b64({ m: idMesa, iat: Date.now(), exp: Date.now() + 3600e3, sid })}.firma`

let llamadas
function responder(url, init = {}) {
  const metodo = (init.method || 'GET').toUpperCase()
  llamadas.push(`${metodo} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`)
  const json = (data, status = 200) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data })
  const abrir = String(url).match(/\/mesas\/(\d+)\/abrir$/)
  if (abrir) {
    const t = tokenDe(Number(abrir[1]), `sid-abrir-${abrir[1]}`)
    return json({ token: t, url: `http://x/mesa?token=${t}`, reutilizado: false }, 201)
  }
  const rotar = String(url).match(/\/mesas\/(\d+)\/rotar-qr$/)
  if (rotar) {
    const t = tokenDe(Number(rotar[1]), `sid-rotar-${rotar[1]}`)
    return json({ url: `http://x/mesa?token=${t}`, expira_en: null })
  }
  if (/\/mesas\/\d+\/liberar$/.test(String(url))) return json({ ok: true })
  return json({})
}

const vivo = { ctx: null }
function Espia() {
  const c = useContext(TablesContext)
  useEffect(() => {
    vivo.ctx = c
  })
  return (
    <>
      <span data-testid="aviso">{c.notification?.mensaje || ''}</span>
      <BandejaAlertas alertas={c.alertas} onAtender={() => {}} onLimpiarTodas={() => {}} />
    </>
  )
}
const mesa = (numero) => vivo.ctx.tables.find((t) => t.numero === numero)

beforeEach(() => {
  vi.restoreAllMocks()
  for (const e of Object.keys(oyentes)) delete oyentes[e]
  sessionStorage.clear()
  sessionStorage.setItem('smartdining_tables_state', JSON.stringify(CRUZADAS))
  llamadas = []
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => responder(url, init))
})

describe('utils/mesaActualizada · mismaMesa / buscarMesa / numeroDeMesa (solo por id_mesa)', () => {
  it('nunca toma el número por id', () => {
    expect(mismaMesa(fila(13, 10), 10)).toBe(false)
    expect(mismaMesa(fila(13, 10), 13)).toBe(true)
    expect(mismaMesa({ id_mesa: 13, numero: 10 }, '13')).toBe(true)
    expect(mismaMesa(fila(13, 10), null)).toBe(false)
    expect(buscarMesa(CRUZADAS, 10).numero).toBe(13)
    expect(buscarMesa(CRUZADAS, 13).numero).toBe(10)
    expect(numeroDeMesa(CRUZADAS, 13)).toBe(10)
    expect(numeroDeMesa(CRUZADAS, 99)).toBe(99)
  })
})

describe('TablesContext con mesas de id cruzado (la 13 tiene id 10; la 10, id 13)', () => {
  beforeEach(() => {
    render(<TablesProvider><Espia /></TablesProvider>)
  })

  it('abrir la mesa 13 (id 10) abre SOLO la 13 y el QR queda en la 13', async () => {
    await act(async () => { await vivo.ctx.abrirMesa(10) })
    expect(llamadas).toContain('POST /api/mesas/10/abrir')
    expect(mesa(13)).toMatchObject({ estado: 'ocupada', active: true })
    expect(mesa(13).token_qr).toMatch(/^v1\./)
    expect(mesa(10)).toMatchObject({ estado: 'disponible', active: false, token_qr: null })
  })

  it('liberar y rotar por id tocan solo esa mesa', async () => {
    await act(async () => { await vivo.ctx.abrirMesa(10) })
    await act(async () => { await vivo.ctx.abrirMesa(13) })
    await act(async () => { await vivo.ctx.regenerarQr(13) })
    expect(mesa(10).detail).toMatch(/rotada/)
    expect(mesa(13).detail).not.toMatch(/rotada/)
    await act(async () => { await vivo.ctx.liberarMesa(13) })
    expect(mesa(10)).toMatchObject({ estado: 'disponible', token_qr: null })
    expect(mesa(13)).toMatchObject({ estado: 'ocupada' })
  })

  it('qr:actualizado de id 13 va a la mesa 10, no copia el token a la 13, y el aviso dice «Mesa 10»', () => {
    act(() => oyentes['qr:actualizado']({ id_mesa: 13, token_qr: 'v1.tok.firma', emitidoEn: 'x' }))
    expect(mesa(10).token_qr).toBe('v1.tok.firma')
    expect(mesa(13).token_qr).toBeNull()
    expect(mesa(13).estado).toBe('disponible')
    expect(screen.getByTestId('aviso')).toHaveTextContent('Mesa 10: Código QR actualizado en vivo')
  })

  it('mesa:liberada de id 10 libera la 13, no la 10', async () => {
    await act(async () => { await vivo.ctx.abrirMesa(10) })
    await act(async () => { await vivo.ctx.abrirMesa(13) })
    act(() => oyentes['mesa:liberada']({ id_mesa: 10 }))
    expect(mesa(13).estado).toBe('disponible')
    expect(mesa(10).estado).toBe('ocupada')
    expect(screen.getByTestId('aviso')).toHaveTextContent('Mesa 13 liberada por el sistema')
  })

  it('order:created de id 13 ocupa la mesa 10 y el aviso dice «Mesa 10»', () => {
    act(() => oyentes['order:created']({ eventId: 'e1', pedido: { id_pedido: 1, codigo_pedido: 'PED-1', id_mesa: 13, estado: 'recibido' } }))
    expect(mesa(10).estado).toBe('ocupada')
    expect(mesa(13).estado).toBe('disponible')
    expect(screen.getByTestId('aviso')).toHaveTextContent('(Mesa 10)')
  })

  it('una alerta de id 13 se muestra como «MESA 10» en la bandeja y en el aviso', () => {
    act(() => oyentes['mesa:llamar_mesero']({ id_mesa: 13 }))
    expect(screen.getByTestId('aviso')).toHaveTextContent('Mesa 10 llama al mesero')
    expect(vivo.ctx.alertas[0]).toMatchObject({ idMesa: 13, numeroMesa: 10 })
  })
})

describe('TablesPanel con mesas de id cruzado', () => {
  it('«Abrir / QR» en la mesa 13 abre el modal de la MESA 13 y abre su id (10)', async () => {
    render(<TablesProvider><TablesPanel /><Espia /></TablesProvider>)
    const tarjeta = screen.getByLabelText(/^Mesa 13, estado/)
    fireEvent.click(within(tarjeta).getByRole('button', { name: /Abrir \/ QR/ }))
    expect(screen.getByRole('heading', { name: /QR · MESA/ })).toHaveTextContent('QR · MESA 13')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Abrir Mesa y Generar QR/ }))
    })
    expect(llamadas).toContain('POST /api/mesas/10/abrir')
    expect(llamadas).not.toContain('POST /api/mesas/13/abrir')
    expect(mesa(13).estado).toBe('ocupada')
    expect(mesa(10).estado).toBe('disponible')
  })
})
