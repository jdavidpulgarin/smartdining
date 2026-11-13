import './App.css'
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
  SoloCocina,
} from './pages'
import { esCocina } from './utils/kds'
import { useSocket, useAuth } from './hooks'
import { AuthProvider } from './context/AuthContext'
import { TablesProvider } from './context/TablesContext'

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

  // El rol cocina no usa el panel: aviso y paso al KDS, en cualquier ruta.
  if (esCocina(user.rol)) {
    return <SoloCocina />
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
