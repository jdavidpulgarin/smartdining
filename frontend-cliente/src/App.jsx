import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Inicio from './pages/Inicio'
import Menu from './pages/Menu'
import Carrito from './pages/Carrito'
import Seguimiento from './pages/Seguimiento'
import Pago from './pages/Pago'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/carrito" element={<Carrito />} />
        <Route path="/seguimiento" element={<Seguimiento />} />
        <Route path="/pago" element={<Pago />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
