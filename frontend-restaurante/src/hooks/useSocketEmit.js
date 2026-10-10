import { useCallback } from 'react'
import { useSocket } from './useSocket'

export function useSocketEmit() {
  const socket = useSocket()

  const emit = useCallback(
    (eventName, data, callback) => {
      if (!socket) {
        console.warn('Socket no conectado')
        return
      }

      if (callback) {
        socket.emit(eventName, data, callback)
      } else {
        socket.emit(eventName, data)
      }
    },
    [socket]
  )

  return emit
}
