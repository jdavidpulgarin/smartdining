import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { useContext, useEffect } from 'react'

// #336: «Rotar QR» con el contexto real (regenerarQr → api.rotarQr → fetch).
// Comprueba el cuerpo que llega al backend y los toasts del panel.
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal()),
  useSocketListener: () => {},
}))
vi.mock('../../utils/audio', () => ({ emitirSonidoAlerta: vi.fn() }))

import { TablesProvider } from '../../context/TablesContext'
import { TablesContext } from '../../context/tablesContextDef'
import { QRModal } from '../QRModal'

const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
const tokenDe = (idMesa, sid) => `v1.${b64({ m: idMesa, iat: Date.now(), exp: Date.now() + 3600e3, sid })}.firma`

const T0 = tokenDe(5, 'sid-0')
const MESA = {
  id: 5, id_mesa: 5, number: 5, numero: 5, name: 'Mesa 5', status: 'ocupada', estado: 'ocupada',
  seats: 4, capacidad: 4, location: 'Salón', ubicacion: 'Salón', sesion_abierta: true,
  token_qr: T0, qr_url: `http://x/mesa?token=${T0}`, active: true,
}

// Respuestas de POST /mesas/5/rotar-qr en orden; el resto responde {}.
let rotaciones
let cuerpos
function responder(url, init = {}) {
  const json = (data, status = 200) => ({ ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => data })
  if (/\/mesas\/5\/rotar-qr$/.test(String(url))) {
    cuerpos.push(init.body === undefined ? undefined : JSON.parse(init.body))
    const siguiente = rotaciones.shift()
    if (siguiente === 409) {
      return json({ error: 'La mesa ya tiene comensales: el QR queda fijo', motivo: 'mesa_con_comensales' }, 409)
    }
    const t = tokenDe(5, `sid-${cuerpos.length}`)
    return json({ url: `http://x/mesa?token=${t}`, expira_en: null }, 201)
  }
  return json({})
}

const vivo = { ctx: null }
function Espia() {
  const c = useContext(TablesContext)
  useEffect(() => {
    vivo.ctx = c
  })
  return <span data-testid="aviso">{c.notification ? `${c.notification.tipo}: ${c.notification.mensaje}` : ''}</span>
}

function montar() {
  render(
    <TablesProvider>
      <Espia />
      <QRModal
        table={MESA}
        onClose={() => {}}
        onUpdateToken={(id, opciones) => vivo.ctx.regenerarQr(id, undefined, opciones)}
      />
    </TablesProvider>
  )
}

const aviso = () => screen.getByTestId('aviso')
const rotarQr = () => screen.getByRole('button', { name: /Rotar QR/ })

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  sessionStorage.setItem('smartdining_tables_state', JSON.stringify([MESA]))
  rotaciones = []
  cuerpos = []
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => responder(url, init))
})

describe('QRModal + TablesContext: «Rotar QR» manual (#336)', () => {
  it('rota con solo_si_vacia: true y muestra el toast de éxito', async () => {
    rotaciones = [201, 201]
    montar()
    // La renovación de apertura es silenciosa.
    await waitFor(() => expect(cuerpos).toHaveLength(1))
    await waitFor(() => expect(rotarQr()).toBeEnabled())
    expect(aviso()).toHaveTextContent('')

    await act(async () => { fireEvent.click(rotarQr()) })
    await waitFor(() => expect(cuerpos).toHaveLength(2))
    expect(cuerpos[1]).toEqual({ solo_si_vacia: true })
    await waitFor(() => expect(aviso()).toHaveTextContent('success: QR regenerado para Mesa 5'))
  })

  it('409 mesa_con_comensales: sin toast de éxito, con aviso de QR fijo y los botones deshabilitados', async () => {
    rotaciones = [201, 409]
    montar()
    await waitFor(() => expect(cuerpos).toHaveLength(1))
    await waitFor(() => expect(rotarQr()).toBeEnabled())

    await act(async () => { fireEvent.click(rotarQr()) })
    await waitFor(() => expect(cuerpos).toHaveLength(2))
    expect(cuerpos[1]).toEqual({ solo_si_vacia: true })
    await waitFor(() => expect(aviso()).toHaveTextContent('info: La mesa tiene comensales: el QR queda fijo'))
    expect(aviso()).not.toHaveTextContent('QR regenerado')
    // fijadoPorBackend: el modal ya trata la mesa como con comensales.
    expect(rotarQr()).toBeDisabled()
    expect(screen.getByRole('button', { name: /Pausar/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Nuevo QR/ })).toBeDisabled()
  })
})
