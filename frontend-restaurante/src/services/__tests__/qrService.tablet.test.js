import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prepararTabletDesdePanel, configurarTabletConLogin, solicitarTokenPantalla } from '../qrService'
import { leerFragmentoTablet } from '../../utils/enlaceTablet'

// Regresión v1.0.0 (FALLO 1): preparar la tablet de la mesa. Rutas que ya
// existen: POST /qr/pantalla (socket-server), GET /api/mesas/:id (pública) y
// POST /api/mesas/:id/abrir (con la mesa ya abierta devuelve el mismo token).
const QR = 'http://192.168.1.9:5174/mesa/10?token=v1.abc.def'
const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
})

let llamadas
function servidor({ estado }) {
  llamadas = []
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, init = {}) => {
    const ruta = String(url).replace(/^https?:\/\/[^/]+/, '')
    const metodo = (init.method || 'GET').toUpperCase()
    llamadas.push({ ruta: `${metodo} ${ruta}`, auth: init.headers?.Authorization || null, body: init.body || null })
    if (ruta === '/auth/login' || ruta === '/api/auth/login') return json({ usuario: { rol: 'mesero' }, token: 'jwt-del-mesero' })
    if (ruta === '/qr/pantalla') return json({ token: 'jwt-pantalla-10', id_mesa: 10, expira_en: '30d' }, 201)
    if (/\/mesas\/10$/.test(ruta)) return json({ id_mesa: 10, numero: 13, estado, activa: true })
    if (/\/mesas\/10\/abrir$/.test(ruta)) return json({ token: 'v1.abc.def', url: QR, reutilizado: true }, 201)
    return json({}, 404)
  })
}
const rutas = () => llamadas.map((l) => l.ruta.replace(/^(\w+) \/api/, '$1 '))

beforeEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  localStorage.clear()
})

describe('prepararTabletDesdePanel (Lanzar Pantalla / Copiar URL Tablet)', () => {
  beforeEach(() => {
    sessionStorage.setItem('smartdining_staff_user', JSON.stringify({ token: 'jwt-del-panel' }))
  })

  it('mesa ocupada: credencial → GET de la mesa → /abrir (reutiliza); enlace /pantalla/mesa/<id_mesa>#t=…&qr=…', async () => {
    servidor({ estado: 'ocupada' })
    const r = await prepararTabletDesdePanel(10, 'http://panel')
    expect(rutas()).toEqual(['POST /qr/pantalla', 'GET /mesas/10', 'POST /mesas/10/abrir'])
    expect(JSON.parse(llamadas[0].body)).toEqual({ id_mesa: 10 })
    expect(llamadas[0].auth).toBe('Bearer jwt-del-panel')
    expect(r.enlace.startsWith('http://panel/pantalla/mesa/10#')).toBe(true)
    expect(leerFragmentoTablet(r.enlace.split('#')[1])).toEqual({ credencial: 'jwt-pantalla-10', qrUrl: QR, token: 'v1.abc.def' })
  })

  it('mesa LIBRE: nunca llama a /abrir; el enlace lleva solo la credencial', async () => {
    servidor({ estado: 'disponible' })
    const r = await prepararTabletDesdePanel(10, 'http://panel')
    expect(rutas()).toEqual(['POST /qr/pantalla', 'GET /mesas/10'])
    expect(llamadas.some((l) => l.ruta.endsWith('/abrir'))).toBe(false)
    expect(r.enlace).toBe('http://panel/pantalla/mesa/10#t=jwt-pantalla-10')
  })
})

describe('configurarTabletConLogin (tablet física sin credencial: login de una sola vez)', () => {
  it('mesa libre: login → credencial → GET; sin /abrir, y la sesión del personal no queda guardada', async () => {
    servidor({ estado: 'disponible' })
    const r = await configurarTabletConLogin(10, 'mesero@x.com', 'clave')
    expect(rutas()).toEqual(['POST /auth/login', 'POST /qr/pantalla', 'GET /mesas/10'])
    expect(llamadas[1].auth).toBe('Bearer jwt-del-mesero')
    expect(r).toMatchObject({ credencial: 'jwt-pantalla-10', estado: 'disponible', numero: 13, qrUrl: null })
    const guardado = JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage })
    expect(guardado).not.toContain('jwt-del-mesero')
  })

  it('mesa ocupada: /abrir con el token del login (explícito), después del GET', async () => {
    servidor({ estado: 'ocupada' })
    const r = await configurarTabletConLogin(10, 'mesero@x.com', 'clave')
    expect(rutas()).toEqual(['POST /auth/login', 'POST /qr/pantalla', 'GET /mesas/10', 'POST /mesas/10/abrir'])
    expect(llamadas[3].auth).toBe('Bearer jwt-del-mesero')
    expect(r).toMatchObject({ qrUrl: QR, token: 'v1.abc.def' })
    expect(JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage })).not.toContain('jwt-del-mesero')
  })
})

describe('solicitarTokenPantalla', () => {
  it('sin sesión del personal no inventa nada ni reusa una caché: error claro', async () => {
    const spy = servidor({ estado: 'ocupada' })
    sessionStorage.setItem('smartdining_pantalla_token_10', 'viejo')
    await expect(solicitarTokenPantalla(10)).rejects.toThrow(/sin sesión de personal/)
    expect(spy).not.toHaveBeenCalled()
  })
})
