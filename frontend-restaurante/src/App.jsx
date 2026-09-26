import './App.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Topbar, Sidebar } from './components'
import {
  Home,
  Mesas,
  Pedidos,
  Menu,
  Caja,
  Reportes,
} from './pages'

function App() {
  return (
    <BrowserRouter>
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
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
