import { io } from 'socket.io-client'
import { getAuthToken } from '../services/api'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

let socketInstance = null

export function getSocket() {
  if (!socketInstance) {
    const token = getAuthToken() || ''

    socketInstance = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      autoConnect: true,
    })

    socketInstance.on('connect', () => {
      console.log('✓ Conectado a socket server en', SOCKET_URL)
    })

    socketInstance.on('disconnect', (reason) => {
      console.log('✗ Desconectado de socket server:', reason)
    })

    socketInstance.on('connect_error', (error) => {
      console.error('✗ Error de conexión socket:', error.message)
    })
  }
  return socketInstance
}

export function useSocket() {
  return getSocket()
}
