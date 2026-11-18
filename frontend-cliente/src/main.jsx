import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { manejarPreloadError } from './utils/recargaPreload'

window.addEventListener('vite:preloadError', (evento) => {
  let storage = null
  try {
    storage = window.sessionStorage
  } catch {
    storage = null
  }
  manejarPreloadError(evento, {
    storage,
    ahora: Date.now(),
    recargar: () => window.location.reload(),
  })
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
