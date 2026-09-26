import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

export function useSocket() {
  const socketRef = useRef(null)

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      })

      socketRef.current.on('connect', () => {
        console.log('✓ Conectado a socket server')
      })

      socketRef.current.on('disconnect', () => {
        console.log('✗ Desconectado de socket server')
      })

      socketRef.current.on('connect_error', (error) => {
        console.error('✗ Error de conexión:', error)
      })
    }

    return () => {
      // No desconectar al desmontar para mantener sesión
    }
  }, [])

  return socketRef.current
}
