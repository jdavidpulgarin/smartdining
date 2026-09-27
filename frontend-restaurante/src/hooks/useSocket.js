import { io } from 'socket.io-client'
import { DEMO_USERS } from '../constants/demoUsers'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

let socketInstance = null

export function getSocket() {
  if (!socketInstance) {
    let token = DEMO_USERS[0].token
    try {
      const stored = localStorage.getItem('smartdining_staff_user')
      if (stored) {
        const u = JSON.parse(stored)
        if (u.token) token = u.token
      }
    } catch {
      // Ignorar error de JSON parse y usar token por defecto
    }

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
