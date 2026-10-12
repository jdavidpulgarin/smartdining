import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// El KDS vive en 5175: es el origen que el socket-server tiene en CORS_ORIGINS,
// asi que strictPort evita que Vite se mueva a otro puerto en silencio y la
// pantalla de cocina quede sin tiempo real sin explicacion.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5175,
    strictPort: true,
    cors: true,
    allowedHosts: true,
  },
})
