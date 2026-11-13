import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import {
  CLAVE_RECARGA_PRELOAD,
  debeRecargarPorPreload,
} from './utils/recargaPreload'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const ultima = sessionStorage.getItem(CLAVE_RECARGA_PRELOAD)
    const ahora = Date.now()
    if (debeRecargarPorPreload(ahora, ultima)) {
      sessionStorage.setItem(CLAVE_RECARGA_PRELOAD, String(ahora))
      window.location.reload()
    }
  } catch {
    // Si sessionStorage falla (ej. almacenamiento deshabilitado), recargar igual una vez
    window.location.reload()
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
