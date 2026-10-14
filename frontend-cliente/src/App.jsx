import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SesionProvider } from './context/SesionContext'
import { CarritoProvider } from './context/CarritoContext'
import Layout from './components/layout/Layout'
import Inicio from './pages/Inicio'
import Menu from './pages/Menu'
import Constructor from './pages/Constructor'
import Carrito from './pages/Carrito'
import Seguimiento from './pages/Seguimiento'
import Pago from './pages/Pago'
import Despedida from './pages/Despedida'
import UiShowcase from './pages/dev/UiShowcase'

function App() {
  return (
    <BrowserRouter>
      <SesionProvider>
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
              path="/armar/:idPlato"
              element={
                <Layout>
                  <Constructor />
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
            <Route path="/despedida" element={<Despedida />} />
            {import.meta.env.DEV && (
              <Route path="/dev/ui" element={<UiShowcase />} />
            )}
          </Routes>
        </CarritoProvider>
      </SesionProvider>
    </BrowserRouter>
  )
}

export default App
