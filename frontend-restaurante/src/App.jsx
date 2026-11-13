import './App.css'
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Topbar } from './components'
import {
  Home,
  Mesas,
  Pedidos,
  Menu,
  Caja,
  Reportes,
  Login,
  PantallaMesa,
  TomarPedido,
  Configuracion,
  Inventario,
  Entregas,
  Despacho,
} from './pages'
import { useSocket, useAuth } from './hooks'
import { AuthProvider } from './context/AuthContext'
import { TablesProvider } from './context/TablesContext'
import { esCocina } from './utils/kds'
import { esRepartidor, puedeDespachar } from './utils/domicilios'

/** Cierra una sesión de cocina (estado, almacenamiento y socket) y va al aviso del login. */
function CerrarSesionDeCocina() {
  const { logout } = useAuth()
  useEffect(() => {
    logout()
  }, [logout])
  return <Navigate to="/login" replace state={{ cocina: true }} />
}

function AppContent() {
  useSocket()
  const { user } = useAuth()
  const location = useLocation()
  const isLoginPage = location.pathname === '/login'
  const isPantallaPage = location.pathname.startsWith('/pantalla')

  if (isLoginPage) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    )
  }

  if (isPantallaPage) {
    return (
      <Routes>
        <Route path="/pantalla/mesa/:id" element={<PantallaMesa />} />
        <Route path="/pantalla/:id" element={<PantallaMesa />} />
      </Routes>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  // Red de seguridad: AuthContext ya no deja entrar al rol cocina (login() no
  // guarda nada y una sesión vieja de cocina se descarta al cargar). Si aun así
  // llegara una, se cierra del todo (estado, almacenamiento y socket) y el login
  // muestra el aviso con el enlace al KDS.
  if (esCocina(user.rol)) {
    return <CerrarSesionDeCocina />
  }

  // P-24: el repartidor solo tiene su pantalla de entregas. Cualquier otra
  // dirección del panel lo devuelve allí (el backend le da 403 en todo lo demás).
  if (esRepartidor(user.rol)) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="sd-page-wrapper">
          <Routes>
            <Route path="/entregas" element={<Entregas />} />
            <Route path="*" element={<Navigate to="/entregas" replace />} />
          </Routes>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Topbar />

      <main className="sd-page-wrapper">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/mesas" element={<Mesas />} />
          <Route path="/mesas/:id/tomar-pedido" element={<TomarPedido />} />
          <Route path="/pedidos" element={<Pedidos />} />
          <Route path="/menu" element={<Menu />} />
          <Route path="/caja" element={<Caja />} />
          <Route path="/reportes" element={<Reportes />} />
          <Route path="/configuracion" element={<Configuracion />} />
          <Route path="/inventario" element={<Inventario />} />
          {/* P-24: despacho de domicilios, solo admin y cajero (como el backend). */}
          <Route path="/despacho" element={puedeDespachar(user.rol) ? <Despacho /> : <Navigate to="/" replace />} />
          <Route path="/entregas" element={<Navigate to="/" replace />} />
          <Route path="/pantalla/mesa/:id" element={<PantallaMesa />} />
          <Route path="/pantalla/:id" element={<PantallaMesa />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <TablesProvider>
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </TablesProvider>
    </AuthProvider>
  )
}

export default App
