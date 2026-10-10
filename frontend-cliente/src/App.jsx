import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { CarritoProvider } from './context/CarritoContext'
import Layout from './components/layout/Layout'
import Inicio from './pages/Inicio'
import Menu from './pages/Menu'
import Carrito from './pages/Carrito'
import Seguimiento from './pages/Seguimiento'
import Pago from './pages/Pago'

function App() {
  return (
    <BrowserRouter>
      <CarritoProvider>
        <Routes>
          <Route path="/" element={<Inicio />} />
          <Route
            path="/menu"
            element={
              <Layout>
                <Menu />
              </Layout>
            }
          />
          <Route
            path="/carrito"
            element={
              <Layout>
                <Carrito />
              </Layout>
            }
          />
          <Route
            path="/seguimiento"
            element={
              <Layout>
                <Seguimiento />
              </Layout>
            }
          />
          <Route
            path="/pago"
            element={
              <Layout>
                <Pago />
              </Layout>
            }
          />
        </Routes>
      </CarritoProvider>
    </BrowserRouter>
  )
}

export default App
