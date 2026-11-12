import { describe, it, expect, vi, beforeEach } from 'vitest'

// socket.io-client simulado: guarda las opciones y cuenta conexiones.
const creados = []
vi.mock('socket.io-client', () => ({
  io: (url, opciones) => {
    const s = {
      url,
      opciones,
      connected: false,
      active: false,
      conexiones: 0,
      desconexiones: 0,
      on: () => s,
      connect() { s.conexiones++; s.active = true; s.connected = true; return s },
      disconnect() { s.desconexiones++; s.active = false; s.connected = false; return s },
    }
    creados.push(s)
    return s
  },
}))

const tokenDeAuth = (s) => new Promise((resolve) => s.opciones.auth((a) => resolve(a.token)))

async function cargar() {
  vi.resetModules()
  creados.length = 0
  sessionStorage.clear()
  return import('../useSocket')
}

describe('useSocket: el socket sigue a la sesión', () => {
  beforeEach(() => sessionStorage.clear())

  it('se crea SIN conectar (antes conectaba en /login sin token) y con auth como función', async () => {
    const { getSocket } = await cargar()
    const s = getSocket()
    expect(s.opciones.autoConnect).toBe(false)
    expect(typeof s.opciones.auth).toBe('function')
    expect(s.conexiones).toBe(0)
  })

  it('sin token no conecta', async () => {
    const { conectarSocket, getSocket } = await cargar()
    conectarSocket(null)
    conectarSocket('')
    expect(getSocket().conexiones).toBe(0)
  })

  it('al iniciar sesión conecta con ESE token (leído en cada conexión, no al crear el socket)', async () => {
    const { conectarSocket, getSocket } = await cargar()
    getSocket() // creado antes del login, como pasa en /login
    conectarSocket('token-ana')
    const s = getSocket()
    expect(s.conexiones).toBe(1)
    expect(await tokenDeAuth(s)).toBe('token-ana')
  })

  it('el mismo token otra vez no reconecta; otro usuario sí, y con su token', async () => {
    const { conectarSocket, getSocket } = await cargar()
    conectarSocket('token-ana')
    conectarSocket('token-ana')
    const s = getSocket()
    expect(s.conexiones).toBe(1)
    conectarSocket('token-beto')
    expect(s.desconexiones).toBe(1)
    expect(s.conexiones).toBe(2)
    expect(await tokenDeAuth(s)).toBe('token-beto')
  })

  it('al salir desconecta y olvida el token', async () => {
    const { conectarSocket, desconectarSocket, getSocket } = await cargar()
    conectarSocket('token-ana')
    desconectarSocket()
    const s = getSocket()
    expect(s.connected).toBe(false)
    expect(await tokenDeAuth(s)).toBe('')
  })
})
