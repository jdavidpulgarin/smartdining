import { io } from 'socket.io-client'
import { getAuthToken } from '../services/api'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

let socketInstance = null
// El token con el que se conecta el socket. Lo fija conectarSocket() con el de
// la sesión; si no hay, se lee el guardado. Se consulta en CADA conexión y
// reconexión (auth como función), nunca se congela al crear el socket.
let tokenSocket = null

/**
 * El socket del panel (uno para toda la app). Se crea SIN conectar
 * (autoConnect: false): antes se conectaba al montar la app, también en
 * /login y sin token. El socket-server lo rechazaba (AUTH_REQUERIDA) y, como
 * el login cambia de pantalla sin recargar, nadie volvía a conectarlo con el
 * token: el panel se quedaba sin tiempo real hasta recargar. Ahora conecta
 * AuthContext cuando hay sesión (conectarSocket) y desconecta al salir.
 */
export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      auth: (cb) => cb({ token: tokenSocket || getAuthToken() || '' }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      autoConnect: false,
    })

    socketInstance.on('connect_error', (error) => {
      console.error('✗ Error de conexión socket:', error.message)
    })
  }
  return socketInstance
}

/**
 * Conecta el socket con `token` (el de la sesión). Si ya estaba conectado o
 * conectándose con otro token (cambio de usuario), se reconecta con el nuevo.
 * Sin token no hace nada: no tiene sentido conectarse para que lo rechacen.
 */
export function conectarSocket(token) {
  const socket = getSocket()
  if (!token) return socket
  const mismoToken = token === tokenSocket
  tokenSocket = token
  if (socket.connected || socket.active) {
    if (mismoToken) return socket
    socket.disconnect()
  }
  socket.connect()
  return socket
}

/** Cierra el socket (logout o sesión inválida) y olvida el token. */
export function desconectarSocket() {
  tokenSocket = null
  if (socketInstance) socketInstance.disconnect()
}

export function useSocket() {
  return getSocket()
}
