import { describe, it, expect, beforeEach } from 'vitest'
import {
  armarEnlaceTablet,
  leerFragmentoTablet,
  tomarFragmentoTablet,
  guardarTablet,
  leerTablet,
  olvidarTablet,
  urlConToken,
  qrVigenteDeMesa,
  prepararTablet,
} from '../enlaceTablet'

// Regresión v1.0.0 (FALLO 1): la tablet de la mesa sin sesión del personal.
const QR = 'http://192.168.1.9:5174/mesa/10?token=v1.abc.def&x=1'

describe('utils/enlaceTablet', () => {
  beforeEach(() => localStorage.clear())

  it('el enlace lleva el id_mesa en la ruta y credencial + QR en el # (y se leen igual)', () => {
    const enlace = armarEnlaceTablet({ origen: 'http://panel', idMesa: 10, credencial: 'jwt.pantalla', qrUrl: QR })
    expect(enlace.startsWith('http://panel/pantalla/mesa/10#')).toBe(true)
    const f = leerFragmentoTablet(enlace.slice(enlace.indexOf('#')))
    expect(f).toEqual({ credencial: 'jwt.pantalla', qrUrl: QR, token: 'v1.abc.def' })
    expect(armarEnlaceTablet({ idMesa: 7, credencial: 'c' })).toBe('/pantalla/mesa/7#t=c')
    expect(leerFragmentoTablet('')).toEqual({ credencial: null, qrUrl: null, token: null })
  })

  it('al abrir la tablet guarda SOLO la credencial de pantalla y el QR (nada del personal)', () => {
    const r = tomarFragmentoTablet(localStorage, 10, `#${new URLSearchParams({ t: 'jwt.pantalla', qr: QR })}`)
    expect(r).toMatchObject({ credencial: 'jwt.pantalla', qrUrl: QR, token: 'v1.abc.def', venia: true })
    expect(Object.keys(localStorage).sort()).toEqual(['smartdining_pantalla_qr_10', 'smartdining_pantalla_token_10'])
    // Recargar (ya sin #): sigue con lo guardado.
    expect(tomarFragmentoTablet(localStorage, 10, '')).toMatchObject({ credencial: 'jwt.pantalla', qrUrl: QR, venia: false })
    // Otra mesa no ve lo de la 10.
    expect(leerTablet(localStorage, 13)).toEqual({ credencial: null, qrUrl: null, token: null })
  })

  it('qrUrl null olvida el QR (mesa liberada); olvidarTablet borra todo', () => {
    guardarTablet(localStorage, 10, { credencial: 'c', qrUrl: QR })
    guardarTablet(localStorage, 10, { qrUrl: null })
    expect(leerTablet(localStorage, 10)).toMatchObject({ credencial: 'c', qrUrl: null })
    olvidarTablet(localStorage, 10)
    expect(Object.keys(localStorage)).toEqual([])
    // Sin almacenamiento (modo privado) no rompe.
    expect(() => guardarTablet(null, 1, { credencial: 'c' })).not.toThrow()
    expect(leerTablet(null, 1).credencial).toBeNull()
  })

  it('un QR sin url (qr:actualizado en una tablet que no tenía) se guarda como token; liberar lo olvida', () => {
    guardarTablet(localStorage, 11, { credencial: 'c', qrUrl: null, token: 'v1.solo.token' })
    expect(leerTablet(localStorage, 11)).toEqual({ credencial: 'c', qrUrl: null, token: 'v1.solo.token' })
    guardarTablet(localStorage, 11, { qrUrl: QR })
    expect(leerTablet(localStorage, 11).token).toBe('v1.abc.def')
    guardarTablet(localStorage, 11, { qrUrl: null })
    expect(leerTablet(localStorage, 11)).toEqual({ credencial: 'c', qrUrl: null, token: null })
  })

  it('urlConToken: qr:actualizado trae solo el token; la url guardada pasa al nuevo', () => {
    expect(urlConToken(QR, 'v1.nuevo.zz')).toBe('http://192.168.1.9:5174/mesa/10?token=v1.nuevo.zz&x=1')
    expect(urlConToken('', 'v1.n')).toBe('')
    expect(urlConToken(QR, null)).toBe(QR)
  })

  it('QR vigente: con la mesa LIBRE (o reservada / en mantenimiento) NUNCA llama a /abrir', async () => {
    for (const estado of ['disponible', 'reservada', 'mantenimiento', undefined]) {
      const llamadas = []
      const r = await qrVigenteDeMesa(10, {
        obtenerMesa: async (id) => { llamadas.push(`GET ${id}`); return { id_mesa: 10, numero: 13, estado } },
        abrirMesa: async (id) => { llamadas.push(`ABRIR ${id}`); return { url: QR } },
      })
      expect(llamadas).toEqual(['GET 10'])
      expect(r).toMatchObject({ estado: estado ?? null, numero: 13, qrUrl: null, token: null })
    }
  })

  it('QR vigente: con la mesa OCUPADA mira primero el estado y después pide el QR (reutilizado)', async () => {
    const llamadas = []
    const r = await qrVigenteDeMesa(10, {
      obtenerMesa: async (id) => { llamadas.push(`GET ${id}`); return { estado: 'ocupada', numero: 13 } },
      abrirMesa: async (id) => { llamadas.push(`ABRIR ${id}`); return { token: 'v1.abc.def', url: QR, reutilizado: true } },
    })
    expect(llamadas).toEqual(['GET 10', 'ABRIR 10'])
    expect(r).toEqual({ estado: 'ocupada', numero: 13, qrUrl: QR, token: 'v1.abc.def' })
  })

  it('prepararTablet: credencial + QR vigente + enlace por id_mesa; sin credencial, error', async () => {
    const io = {
      origen: 'http://panel',
      pedirCredencial: async () => ({ token: 'jwt.pantalla' }),
      obtenerMesa: async () => ({ estado: 'ocupada', numero: 13 }),
      abrirMesa: async () => ({ url: QR }),
    }
    const r = await prepararTablet(10, io)
    expect(r.enlace).toBe(armarEnlaceTablet({ origen: 'http://panel', idMesa: 10, credencial: 'jwt.pantalla', qrUrl: QR }))
    expect(r.numero).toBe(13)
    await expect(prepararTablet(10, { ...io, pedirCredencial: async () => ({}) })).rejects.toThrow(/credencial/)
  })
})
