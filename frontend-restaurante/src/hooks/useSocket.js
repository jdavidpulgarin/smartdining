import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

let socketInstance = null

export function getSocket() {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      autoConnect: true,
    })

    socketInstance.on('connect', () => {
      console.log('✓ Conectado a socket server')
    })

    socketInstance.on('disconnect', () => {
      console.log('✗ Desconectado de socket server')
    })

    socketInstance.on('connect_error', (error) => {
      console.error('✗ Error de conexión:', error)
    })
  }
  return socketInstance
}

export function useSocket() {
  return getSocket()
}
