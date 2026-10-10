import { useState, useEffect } from 'react'
import { AuthContext } from './authContextDef'
import { DEMO_USERS } from '../constants/demoUsers'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('smartdining_staff_user')
      return stored ? JSON.parse(stored) : DEMO_USERS[0]
    } catch {
      return DEMO_USERS[0]
    }
  })

  useEffect(() => {
    if (user) {
      localStorage.setItem('smartdining_staff_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('smartdining_staff_user')
    }
  }, [user])

  const login = (email, _password) => {
    const found = DEMO_USERS.find((u) => u.email.toLowerCase() === email.toLowerCase())
    if (found) {
      setUser(found)
      return { success: true, user: found }
    }
    const customUser = {
      id: Date.now(),
      name: email.split('@')[0],
      email,
      role: 'admin',
      roleLabel: 'Administrador',
      avatar: email.substring(0, 2).toUpperCase(),
    }
    setUser(customUser)
    return { success: true, user: customUser }
  }

  const loginAsDemo = (role) => {
    const demo = DEMO_USERS.find((u) => u.role === role) || DEMO_USERS[0]
    setUser(demo)
    return demo
  }

  const logout = () => {
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, loginAsDemo, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
