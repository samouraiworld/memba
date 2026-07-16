import { defineConfig } from 'vitest/config'
import { loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { assertSafeFlags, shouldEnforceFlagGate } from './src/lib/safeFlags'
import { buildSitemapXml, SITE_ORIGIN, SITEMAP_NETWORK } from './src/lib/sitemap'
import { readdirSync } from 'node:fs'
import { parseBlogArticles, buildRssXml } from './src/lib/blogParser'

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

// W6.3 PR2: emit dist/sitemap.xml at build (static public routes; see
// src/lib/sitemap.ts for the deliberate static-only scope decision).
// robots.txt is a static file in public/ and needs no plugin.
function sitemapPlugin(): PluginOption {
  return {
    name: 'memba-sitemap',
    apply: 'build',
    closeBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      mkdirSync('dist', { recursive: true })
      // W6.4: blog articles from content/blog feed BOTH the RSS feed and the
      // sitemap's per-article entries (article date = truthful lastmod).
      const blogDir = 'content/blog'
      const files: Record<string, string> = {}
      try {
        for (const f of readdirSync(blogDir)) {
          if (f.endsWith('.md')) files[f] = readFileSync(`${blogDir}/${f}`, 'utf-8')
        }
      } catch { /* no blog dir → empty feed */ }
      const articles = parseBlogArticles(files)
      writeFileSync('dist/sitemap.xml', buildSitemapXml(undefined, undefined, undefined, lastmod,
        articles.map(a => ({ path: `/blog/${a.slug}`, lastmod: a.date }))))
      writeFileSync('dist/blog.rss', buildRssXml(SITE_ORIGIN, SITEMAP_NETWORK, articles))
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
          // NOTE (BARRICADE 3D): the three/R3F/postprocessing stack is deliberately
          // NOT grouped here. This is the OBJECT form, where each listed module is a
          // ROOT that Rollup force-bundles even if unimported — which would drag the
          // ~180KB three stack into the EAGER graph while it has no importer. The
          // dedicated `vendor-three` async chunk is created in the renderer PR
          // (function-form rule) at the point three is lazily imported, so isolation
          // is verified end-to-end. The Workbox exclusion + bundle CI gate below are
          // wired ahead of it.
        },
      },
    },
  },
  plugins: [
    react(),
    safeFlagsPlugin(),
    sitemapPlugin(),
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
        // The BARRICADE 3D renderer chunk is precache-EXCLUDED: globPatterns above
        // precaches **/*.js ≤4MB, so without this every user — including 2D-mode
        // users who never load three — would download the ~300-360KB three stack on
        // SW install. It is fetched on demand and cached at runtime (below) instead.
        // Wired ahead of the renderer: the vendor-three chunk itself is created when
        // the 3D renderer lands and lazily imports three.
        globIgnores: ['**/vendor-three-*.js'],
        // recharts/jspdf chunks are large; allow them into the precache.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          { urlPattern: /\/fonts\//, handler: 'CacheFirst', options: { cacheName: 'fonts' } },
          // The precache-excluded 3D chunk: cache-on-first-use so repeat 3D sessions
          // stay offline-capable without burdening the install-time precache.
          { urlPattern: /vendor-three-.*\.js$/, handler: 'StaleWhileRevalidate', options: { cacheName: 'barricade-3d' } },
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
