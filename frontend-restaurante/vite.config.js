import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    cors: true,
    allowedHosts: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // e2e/ es la suite de Playwright (npm run test:e2e): necesita el sistema
    // entero levantado y no la corre Vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // P-15: `npm run test:cobertura`. Mide el código de src/ (sin pruebas,
    // fixtures ni el arranque de la app).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.{js,jsx}', 'src/test/**', 'src/main.jsx'],
      reporter: ['text-summary', 'text', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
})
