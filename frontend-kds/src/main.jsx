import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Fuentes autoalojadas: el KDS tiene que arrancar igual en una cocina sin
// internet o con el wifi del local caido, asi que no se piden a un CDN. Solo
// los pesos que se usan, para no inflar el bundle.
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'

import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
