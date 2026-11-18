import { useState, useEffect, useCallback } from 'react'
import { AuthContext } from './authContextDef'
import { authApi, EVENT_UNAUTHORIZED } from '../services/api'
import { conectarSocket, desconectarSocket } from '../hooks/useSocket'
import { esCocina } from '../utils/kds'

const CLAVE_USUARIO = 'smartdining_staff_user'
const CLAVE_TOKEN = 'smartdining_token'

const ROLE_LABELS = {
  admin: 'Administrador',
  mesero: 'Mesero de Sala',
  cajero: 'Caja & Facturación',
  cocina: 'Jefe de Cocina',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem(CLAVE_USUARIO)
      const guardado = stored ? JSON.parse(stored) : null
      // Una sesión de cocina guardada antes de esta regla no se usa: se borra
      // sin conectar el socket (el rol cocina trabaja en el KDS).
      if (guardado && esCocina(guardado.rol)) {
        sessionStorage.removeItem(CLAVE_USUARIO)
        sessionStorage.removeItem(CLAVE_TOKEN)
        return null
      }
      return guardado
    } catch {
      return null
    }
  })

  // Sincronizar usuario y token en sessionStorage
  useEffect(() => {
    if (user) {
      sessionStorage.setItem('smartdining_staff_user', JSON.stringify(user))
    } else {
      sessionStorage.removeItem('smartdining_staff_user')
    }
  }, [user])

  // El socket sigue a la sesión: conecta con su token al iniciar sesión (o al
  // recargar con sesión guardada), se reconecta si cambia el usuario y se cierra
  // al salir. Antes se conectaba en /login sin token y se quedaba rechazado.
  const tokenSesion = user?.token || null
  useEffect(() => {
    if (tokenSesion) conectarSocket(tokenSesion)
    else desconectarSocket()
  }, [tokenSesion])

  const logout = useCallback(() => {
    setUser(null)
    sessionStorage.removeItem('smartdining_staff_user')
    sessionStorage.removeItem('smartdining_token')
  }, [])

  // Escuchar respuestas 401 emitidas por cualquier llamada apiFetch
  useEffect(() => {
    const handleUnauthorized = () => {
      logout()
    }
    window.addEventListener(EVENT_UNAUTHORIZED, handleUnauthorized)
    return () => window.removeEventListener(EVENT_UNAUTHORIZED, handleUnauthorized)
  }, [logout])

  /**
   * Inicia sesión contra la API real: POST /api/auth/login
   */
  const login = async (email, password) => {
    const data = await authApi.login(email, password)
    const u = data.usuario
    const rol = u.rol || 'admin'

    // El rol cocina trabaja en el KDS, no en el panel. Se decide ANTES de
    // setUser: no se guarda el usuario ni el token, y no se conecta el socket
    // (revisión de Roberto en #213). La página de login muestra el aviso.
    if (esCocina(rol)) {
      return { success: false, cocina: true }
    }

    const userObj = {
      id: u.id_usuario,
      id_usuario: u.id_usuario,
      name: u.nombre,
      nombre: u.nombre,
      email: u.email,
      role: rol,
      rol: rol,
      roleLabel: ROLE_LABELS[rol] || rol,
      avatar: (u.nombre || 'U')
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase(),
      token: data.token,
    }

    setUser(userObj)
    return { success: true, user: userObj }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
