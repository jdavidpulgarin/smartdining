import { useState, useEffect, useCallback } from 'react'
import { AuthContext } from './authContextDef'
import { DEMO_USERS } from '../constants/demoUsers'
import { authApi, EVENT_UNAUTHORIZED } from '../services/api'

const ROLE_LABELS = {
  admin: 'Administrador',
  mesero: 'Mesero de Sala',
  cajero: 'Caja & Facturación',
  cocina: 'Jefe de Cocina',
}

const DEMO_EMAILS_BY_ROLE = {
  admin: 'admin@smartdining.com',
  cajero: 'caja@smartdining.com',
  mesero: 'mesero@smartdining.com',
  cocina: 'cocina@smartdining.com',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('smartdining_staff_user')
      return stored ? JSON.parse(stored) : DEMO_USERS[0]
    } catch {
      return DEMO_USERS[0]
    }
  })

  // Sincronizar usuario y token en localStorage
  useEffect(() => {
    if (user) {
      localStorage.setItem('smartdining_staff_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('smartdining_staff_user')
    }
  }, [user])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem('smartdining_staff_user')
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
    try {
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

      setUser(userObj)
      return { success: true, user: userObj }
    } catch (err) {
      // Si el servidor falla o no responde y coincide con un demo user en dev
      const fallbackDemo = DEMO_USERS.find(
        (u) => u.email.toLowerCase() === email.toLowerCase()
      )
      if (fallbackDemo && (err.status === undefined || err.status >= 500)) {
        setUser(fallbackDemo)
        return { success: true, user: fallbackDemo, offline: true }
      }
      throw err
    }
  }

  /**
   * Inicio de sesión rápido para demostraciones y pruebas
   */
  const loginAsDemo = async (role) => {
    const email = DEMO_EMAILS_BY_ROLE[role] || 'admin@smartdining.com'
    try {
      return await login(email, 'Admin123!')
    } catch {
      // Fallback a DEMO_USERS si el backend está apagado en dev
      const demo = DEMO_USERS.find((u) => u.role === role) || DEMO_USERS[0]
      setUser(demo)
      return { success: true, user: demo, offline: true }
    }
  }

  return (
    <AuthContext.Provider value={{ user, login, loginAsDemo, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
