import { describe, it, expect, afterEach, vi } from 'vitest'
import { extraerHostDeUrl, esHostLocal, obtenerHostPorDefecto, resolverDiningUrl } from '../qrUrl'

describe('utils/qrUrl (enlace del QR de la mesa)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('extraerHostDeUrl: el hostname, o vacío si no es una URL', () => {
    expect(extraerHostDeUrl('http://192.168.1.9:5174/?token=a&mesa=3')).toBe('192.168.1.9')
    expect(extraerHostDeUrl('no es url')).toBe('')
    expect(extraerHostDeUrl(null)).toBe('')
  })

  it('esHostLocal: localhost, 127.0.0.1 y ::1 (sin importar mayúsculas ni espacios)', () => {
    expect(['localhost', ' LOCALHOST ', '127.0.0.1', '::1'].map(esHostLocal)).toEqual([true, true, true, true])
    expect(['192.168.1.9', 'app.smartdining.co', '', undefined].map(esHostLocal)).toEqual([false, false, false, false])
  })

  it('obtenerHostPorDefecto: primero el host del qr_url del backend', () => {
    expect(obtenerHostPorDefecto('http://10.0.0.5:5174/?mesa=1')).toBe('10.0.0.5')
  })

  it('obtenerHostPorDefecto: sin qr_url, el host del navegador si no es local; si no, localhost', () => {
    vi.stubGlobal('location', { hostname: '192.168.1.20' })
    expect(obtenerHostPorDefecto()).toBe('192.168.1.20')
    vi.stubGlobal('location', { hostname: 'localhost' })
    expect(obtenerHostPorDefecto('')).toBe('localhost')
  })

  it('resolverDiningUrl con qr_url: tal cual, con otra IP, o forzado a localhost (mismo puerto, ruta y token)', () => {
    const backendUrl = 'http://192.168.1.9:5174/?token=abc&mesa=3'
    expect(resolverDiningUrl({ backendUrl })).toBe(backendUrl)
    expect(resolverDiningUrl({ backendUrl, hostIp: ' 10.0.0.7 ' })).toBe('http://10.0.0.7:5174/?token=abc&mesa=3')
    expect(resolverDiningUrl({ backendUrl, useWifiIp: false })).toBe('http://localhost:5174/?token=abc&mesa=3')
    expect(resolverDiningUrl({ backendUrl, hostIp: '   ' })).toBe(backendUrl)
  })

  it('resolverDiningUrl con un qr_url que no es una URL válida: reemplazo de texto', () => {
    // Puerto no numérico: new URL lanza y se cae al reemplazo de texto.
    expect(resolverDiningUrl({ backendUrl: 'http://localhost:abc/?mesa=1', hostIp: '10.0.0.7' })).toBe('http://10.0.0.7:abc/?mesa=1')
    expect(resolverDiningUrl({ backendUrl: 'algo raro' })).toBe('algo raro')
  })

  it('resolverDiningUrl sin qr_url: arma la URL con host, puerto, token y mesa codificados', () => {
    expect(resolverDiningUrl({ token: 'a b', tableNumber: 4, hostIp: '10.0.0.7' })).toBe('http://10.0.0.7:5174/?token=a%20b&mesa=4')
    expect(resolverDiningUrl({ tableNumber: 2, useWifiIp: false, hostIp: '10.0.0.7', fallbackPort: '3000' })).toBe('http://localhost:3000/?mesa=2')
    expect(resolverDiningUrl({})).toBe('http://localhost:5174/?mesa=1')
  })
})
