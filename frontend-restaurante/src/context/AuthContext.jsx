import { useState, useEffect, useCallback } from 'react'
import { AuthContext } from './authContextDef'
import { authApi, EVENT_UNAUTHORIZED } from '../services/api'

const ROLE_LABELS = {
  admin: 'Administrador',
  mesero: 'Mesero de Sala',
  cajero: 'Caja & Facturación',
  cocina: 'Jefe de Cocina',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = sessionStorage.getItem('smartdining_staff_user')
      return stored ? JSON.parse(stored) : null
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

    sessionStorage.setItem('smartdining_token', data.token)
    sessionStorage.setItem('smartdining_staff_user', JSON.stringify(userObj))
    setUser(userObj)
    return { success: true, user: userObj }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
