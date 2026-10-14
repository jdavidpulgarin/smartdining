import { io } from 'socket.io-client'

/**
 * Conexion al socket-server. El rol 'cocina' entra solo a room:kds al conectar
 * (EVENTS.md §1), asi que el KDS no tiene que emitir nada para recibir.
 *
 * Se crea una conexion por sesion y se cierra al salir: el token va en el
 * handshake, asi que reusar el socket tras cambiar de usuario dejaria el JWT
 * viejo. El token no se registra en consola en ningun caso.
 */
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001'

export function crearSocket(token) {
  return io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    autoConnect: true,
  })
}

/**
 * ¿Este connect_error significa que el JWT ya no sirve?
 *
 * EVENTS.md §1: el servidor manda 'AUTH_REQUERIDA' o 'TOKEN_INVALIDO'. En esos
 * casos no hay nada que reintentar, hay que volver al login; cualquier otro
 * error es de red y socket.io seguira reintentando solo.
 */
export function esErrorDeToken(error) {
  const mensaje = error?.message || ''
  return mensaje === 'TOKEN_INVALIDO' || mensaje === 'AUTH_REQUERIDA'
}
