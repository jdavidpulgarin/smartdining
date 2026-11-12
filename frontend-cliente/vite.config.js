import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/pwa-192x192.png', 'icons/pwa-512x512.png', 'icons/pwa-maskable-512x512.png'],
      manifest: {
        name: 'SmartDining',
        short_name: 'SmartDining',
        description: 'Aplicación cliente para comensales SmartDining - Menú digital, pedidos y pago.',
        theme_color: '#0B0B0B',
        background_color: '#0B0B0B',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        importScripts: ['/sw-push.js'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//]
      },
      devOptions: {
        enabled: process.env.PWA_DEV === '1',
        type: 'classic',
        navigateFallback: 'index.html'
      }
    })
  ],
  server: {
    host: true,
    port: 5174,
    strictPort: true,
  },
})
