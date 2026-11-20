import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Fuentes autoalojadas: el KDS tiene que arrancar igual en una cocina sin
// internet o con el wifi del local caido, asi que no se piden a un CDN. Solo
// los pesos que se usan y solo el subconjunto latino (cubre el español), para
// no inflar el bundle con latin-ext ni vietnamese.
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/bebas-neue/latin-400.css'

import './index.css'
// Piel del tablero: todo va bajo .tema-cocina, así que el login no la recoge.
import './tema-cocina.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
