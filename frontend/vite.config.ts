import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    port: 5173,
    proxy: {
      '/memba.v1.MultisigService': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/github/oauth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
