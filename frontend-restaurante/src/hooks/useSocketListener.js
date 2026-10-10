import { useEffect } from 'react'
import { useSocket } from './useSocket'

export function useSocketListener(eventName, callback) {
  const socket = useSocket()

  useEffect(() => {
    if (!socket) return

    socket.on(eventName, callback)

    return () => {
      socket.off(eventName, callback)
    }
  }, [socket, eventName, callback])
}
