import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], cacheDir: 'node_modules/.vite-notes-sushi', define: { __APP_VERSION__: JSON.stringify('notes-sushi-demo') }, optimizeDeps: { include: ['marked', 'marked-footnote', 'dompurify'], entries: ['e2e-notes/sushi/index.html'] } })
