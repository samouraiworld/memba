import { defineConfig } from 'vitest/config'
import { loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'node:fs'
import { assertSafeFlags, shouldEnforceFlagGate } from './src/lib/safeFlags'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Build-time fund-flag safety gate — fails `vite build` (CI AND the Netlify
// build) if a safety-gated VITE_ENABLE_* flag resolves to "true" from any source
// (.env files or process.env / Netlify dashboard vars). Replaces the old CI
// `.env.example` grep, which never saw the prod build's env. See src/lib/safeFlags.ts.
function safeFlagsPlugin(): PluginOption {
  return {
    name: 'memba-safe-flags',
    config(_config, { command, mode }) {
      // Netlify sets CONTEXT (production / deploy-preview / branch-deploy); CI/local
      // leave it unset. Enforce on CI + the production build, skip ephemeral previews.
      if (shouldEnforceFlagGate(command, process.env.CONTEXT)) {
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
    // PWA: installable manifest + Workbox service worker. SW is OFF in dev
    // (devOptions.enabled:false) so it never affects dev / Playwright / tests.
    // Colors track the real app canvas (--color-k-bg dark = #000000), not a
    // separate brand value, to stay aligned with the §13 design system.
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Memba',
        short_name: 'Memba',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        description: 'Gno-native multisig wallet and DAO governance.',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,woff2}'],
        // recharts/jspdf chunks are large; allow them into the precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/fonts\//, handler: 'CacheFirst', options: { cacheName: 'fonts' } },
          // NEVER cache auth/tx / RPC writes — always hit the network.
          { urlPattern: ({ url }) => url.pathname.startsWith('/memba.v1.'), handler: 'NetworkOnly' },
        ],
      },
    }),
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
