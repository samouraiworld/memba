/// <reference types="vite/client" />

/**
 * Build-time constants injected by Vite `define` in vite.config.ts.
 * This ensures TypeScript recognizes globals set at build time.
 */
declare const __APP_VERSION__: string

// Plausible Analytics (loaded via <script> in index.html)
interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string | number | boolean> }) => void
}
