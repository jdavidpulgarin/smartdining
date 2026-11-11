import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SesionProvider } from './context/SesionContext'
import { MesaSocketProvider } from './context/MesaSocketContext'
import { CarritoProvider } from './context/CarritoContext'
import Layout from './components/layout/Layout'
import Inicio from './pages/Inicio'
import './styles/seguimiento.css'
import './styles/cuenta.css'

const Menu = lazy(() => import('./pages/Menu'))
const Constructor = lazy(() => import('./pages/Constructor'))
const Carrito = lazy(() => import('./pages/Carrito'))
const Seguimiento = lazy(() => import('./pages/Seguimiento'))
const Pago = lazy(() => import('./pages/Pago'))
const Despedida = lazy(() => import('./pages/Despedida'))
const UiShowcase = lazy(() => import('./pages/dev/UiShowcase'))

function CargandoRuta() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen bg-fondo text-texto flex items-center justify-center p-6"
    >
      <span className="text-sm font-etiqueta uppercase tracking-wider text-texto-suave">
        Cargando vista...
      </span>
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <SesionProvider>
        <MesaSocketProvider>
          <CarritoProvider>
          <Suspense fallback={<CargandoRuta />}>
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
          </Suspense>
        </CarritoProvider>
      </MesaSocketProvider>
    </SesionProvider>
  </BrowserRouter>
  )
}

export default App
