import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notificarQrRotado } from '../qrService'

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

describe('notificarQrRotado (T3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.setItem('smartdining_token', 'test-token')
  })

  it('desde la tablet pide solo_si_vacia: nunca fuerza la rotación', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(json({ url: 'http://h:5174/mesa/1?token=nuevo', expira_en: null }))
    const r = await notificarQrRotado(1)
    const [url, config] = spy.mock.calls[0]
    expect(url).toMatch(/\/mesas\/1\/rotar-qr$/)
    expect(JSON.parse(config.body)).toEqual({ solo_si_vacia: true })
    expect(r.token).toBe('nuevo')
  })
})
