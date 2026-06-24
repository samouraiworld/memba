import { defineConfig } from 'vitest/config'
import { loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'node:fs'
import { assertSafeFlags } from './src/lib/safeFlags'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Build-time fund-flag safety gate — fails `vite build` (CI AND the Netlify
// build) if a safety-gated VITE_ENABLE_* flag resolves to "true" from any source
// (.env files or process.env / Netlify dashboard vars). Replaces the old CI
// `.env.example` grep, which never saw the prod build's env. See src/lib/safeFlags.ts.
function safeFlagsPlugin(): PluginOption {
  return {
    name: 'memba-safe-flags',
    config(_config, { command, mode }) {
      if (command === 'build') {
        assertSafeFlags({ ...process.env, ...loadEnv(mode, '..', 'VITE_') })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  envDir: '..', // Load .env from repo root (where all VITE_* vars live)
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: true, // Required for Sentry source map uploads
    rollupOptions: {
      output: {
        manualChunks: {
          // Long-lived vendor chunks — cached across deploys
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['@phosphor-icons/react'],
          'vendor-sentry': ['@sentry/react'],
          // ConnectRPC + protobuf client stack — app-wide, long-lived; split out of the
          // eager index chunk to keep it under the 600KB budget (cached across deploys).
          'vendor-rpc': ['@connectrpc/connect', '@connectrpc/connect-web', '@bufbuild/protobuf'],
        },
      },
    },
  },
  plugins: [
    react(),
    safeFlagsPlugin(),
    // Sentry source map upload — only in production builds with auth token
    ...(process.env.SENTRY_AUTH_TOKEN
      ? [
        sentryVitePlugin({
          org: "samourai-coop",
          project: "memba",
          url: "https://sentry.samourai.pro",
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release: {
            name: `memba@${pkg.version}`,
          },
          sourcemaps: {
            filesToDeleteAfterUpload: ["./dist/**/*.map"],
          },
          telemetry: false,
        }),
      ]
      : []),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.netlify/**'],
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
