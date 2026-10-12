import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Tablero from './pages/Tablero'

/**
 * Ruta protegida: sin sesion valida se vuelve al login. La comprobacion del rol
 * ya la hizo AuthContext al entrar, y al leer la sesion guardada, asi que aqui
 * basta con mirar si hay token.
 */
function SoloConSesion({ children }) {
  const { autenticado } = useAuth()
  if (!autenticado) return <Navigate to="/login" replace />
  return children
}

/** Con sesion abierta, el login no tiene nada que hacer. */
function SoloSinSesion({ children }) {
  const { autenticado } = useAuth()
  if (autenticado) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <SoloSinSesion>
                <Login />
              </SoloSinSesion>
            }
          />
          <Route
            path="/"
            element={
              <SoloConSesion>
                <Tablero />
              </SoloConSesion>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
