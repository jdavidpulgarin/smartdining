import { describe, it, expect, vi } from 'vitest'
import { tokenDeUrl, puedeRotarSolo, errorDeRotacion, tabletSinQr, RENOVAR_CADA_SEGUNDOS, ROTACION_SOCKET_SEGUNDOS } from '../qrRotacion'

describe('utils/qrRotacion', () => {
  it('tokenDeUrl: saca el token del url del comensal', () => {
    expect(tokenDeUrl('http://192.168.1.34:5174/?token=v1.abc.def')).toBe('v1.abc.def')
    expect(tokenDeUrl('http://x/?mesa=5&token=v1.a.b&z=1')).toBe('v1.a.b')
    for (const malo of [undefined, null, '', 'http://x/', 'http://x/?token=', 42]) expect(tokenDeUrl(malo)).toBeNull()
  })

  it('renueva antes de que rote el socket-server', () => {
    expect(RENOVAR_CADA_SEGUNDOS).toBeLessThan(ROTACION_SOCKET_SEGUNDOS)
  })

  it('puedeRotarSolo: solo mesa abierta, con token y sin comensales', () => {
    expect(puedeRotarSolo({ ocupada: true, tieneComensales: false, token: 't' })).toBe(true)
    expect(puedeRotarSolo({ ocupada: true, tieneComensales: true, token: 't' })).toBe(false)
    expect(puedeRotarSolo({ ocupada: false, tieneComensales: false, token: 't' })).toBe(false)
    expect(puedeRotarSolo({ ocupada: true, tieneComensales: false, token: '' })).toBe(false)
  })

  it('errorDeRotacion: cada caso con su mensaje y si se reintenta', () => {
    const e = (status, extra) => Object.assign(new Error('x'), { status, ...extra })
    expect(errorDeRotacion(e(404))).toMatchObject({ reintentar: false, texto: expect.stringMatching(/ya no existe/) })
    expect(errorDeRotacion(e(409))).toMatchObject({ reintentar: false, texto: expect.stringMatching(/ya no está abierta/) })
    expect(errorDeRotacion(e(409, { motivo: 'mesa_con_comensales' }))).toMatchObject({ reintentar: false, conComensales: true })
    expect(errorDeRotacion(e(403)).reintentar).toBe(false)
    expect(errorDeRotacion(e(503))).toMatchObject({ reintentar: true, texto: expect.stringMatching(/Reintentando/) })
    expect(errorDeRotacion({ sinConexion: true }).reintentar).toBe(true)
    expect(errorDeRotacion(e(500)).reintentar).toBe(false)
  })
})

describe('hayPresencia', () => {
  it('total, comensales o sin_celular cuentan; vacío o nada, no', async () => {
    const { hayPresencia } = await import('../qrRotacion')
    expect(hayPresencia({ total: 1 })).toBe(true)
    expect(hayPresencia({ total: 0, comensales: ['Ana'] })).toBe(true)
    expect(hayPresencia({ total: 0, comensales: [], sin_celular: ['Abuela'] })).toBe(true)
    expect(hayPresencia({ total: 0, comensales: [], sin_celular: [] })).toBe(false)
    expect(hayPresencia(undefined)).toBe(false)
  })
})

describe('mesasApi.rotarQr', () => {
  it('solo las rotaciones automáticas mandan { solo_si_vacia: true }', async () => {
    vi.resetModules()
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 201, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ url: 'http://x/?token=v1.a.b' }) })
    const { mesasApi } = await import('../../services/api')
    await mesasApi.rotarQr(5)
    await mesasApi.rotarQr(5, { soloSiVacia: true })
    expect(spy.mock.calls[0][1].body).toBeUndefined()
    expect(JSON.parse(spy.mock.calls[1][1].body)).toEqual({ solo_si_vacia: true })
    spy.mockRestore()
  })
})

describe('qrService.rotarTokenQrMesa', () => {
  it('toma el token del url, que es lo que devuelve rotar-qr', async () => {
    vi.resetModules()
    vi.doMock('../../services/api', () => ({ mesasApi: { rotarQr: async () => ({ url: 'http://x:5174/?token=v1.nuevo.firma', expira_en: null, mesa: { id_mesa: 5 } }) } }))
    const { rotarTokenQrMesa } = await import('../../services/qrService')
    const r = await rotarTokenQrMesa(5)
    expect(r.token).toBe('v1.nuevo.firma')
    expect(r.url).toContain('v1.nuevo.firma')
    vi.doUnmock('../../services/api')
  })

  it('sin token ni url con token: error, nunca un QR inventado', async () => {
    vi.resetModules()
    vi.doMock('../../services/api', () => ({ mesasApi: { rotarQr: async () => ({ expira_en: null }) } }))
    const { rotarTokenQrMesa } = await import('../../services/qrService')
    await expect(rotarTokenQrMesa(5)).rejects.toThrow(/no devolvió/)
    vi.doUnmock('../../services/api')
  })
})

describe('tabletSinQr: la tablet no muestra un QR revocado', () => {
  it('mesa:liberada → «Mesa disponible», aunque mostrara un QR', () => {
    expect(tabletSinQr(false, { tipo: 'mesa:liberada' })).toBe(true)
  })

  it('vuelve el QR solo cuando llega uno nuevo', () => {
    expect(tabletSinQr(true, { tipo: 'qr', token_qr: 'v1.nuevo' })).toBe(false)
    expect(tabletSinQr(true, { tipo: 'qr' })).toBe(true)
    expect(tabletSinQr(true, { tipo: 'qr', token_qr: '' })).toBe(true)
  })

  it('con los datos de la mesa: disponible oculta el QR; ocupada con token lo muestra', () => {
    expect(tabletSinQr(false, { tipo: 'mesa', estado: 'disponible', token_qr: null })).toBe(true)
    expect(tabletSinQr(true, { tipo: 'mesa', estado: 'ocupada', token_qr: 'v1.a' })).toBe(false)
  })

  it('ocupada sin token (la lista de mesas no lo trae) no cambia lo que se ve', () => {
    expect(tabletSinQr(true, { tipo: 'mesa', estado: 'ocupada', token_qr: null })).toBe(true)
    expect(tabletSinQr(false, { tipo: 'mesa', estado: 'ocupada', token_qr: null })).toBe(false)
    expect(tabletSinQr(false, { tipo: 'mesa' })).toBe(false)
  })

  it('un evento desconocido no cambia nada', () => {
    expect(tabletSinQr(true, { tipo: 'otro' })).toBe(true)
    expect(tabletSinQr(false, null)).toBe(false)
  })
})
