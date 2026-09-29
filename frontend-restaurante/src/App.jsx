import './App.css'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Topbar, Sidebar } from './components'
import {
  Home,
  Mesas,
  Pedidos,
  Menu,
  Caja,
  Reportes,
  Login,
  PantallaMesa,
} from './pages'
import { useSocket } from './hooks'
import { AuthProvider } from './context/AuthContext'
import { TablesProvider } from './context/TablesContext'

function AppContent() {
  useSocket()
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

  return (
    <div className="app-shell">
      <Topbar />
      <Sidebar />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/mesas" element={<Mesas />} />
        <Route path="/pedidos" element={<Pedidos />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/caja" element={<Caja />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/pantalla/mesa/:id" element={<PantallaMesa />} />
        <Route path="/pantalla/:id" element={<PantallaMesa />} />
        <Route path="/login" element={<Login />} />
      </Routes>
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
