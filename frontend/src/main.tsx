import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CHUNK_RELOAD_KEY } from './lib/staleChunk'
import { TxConfirmationProvider } from './components/ui/TxConfirmation'
import { initTheme } from './lib/themeStore'
import { queryClient } from './lib/queryClient'
// Vendored woff2 fonts — latin subset, no OFL npm dep
import './fonts.css'
import './tokens.css'
import './index.css'
import './mobile-tokens.css'
import './components/mobile/mobile-primitives.css'
import App from './App.tsx'

// Apply theme before first paint (avoids flash)
initTheme()

// ── Stale-chunk auto-recovery (vite:preloadError) ─────────────
// After every deploy, the autoUpdate service worker takes over live tabs and
// purges the previous build's precached chunks; the page's NEXT lazy route
// load then gets the SPA-fallback index.html for a .js URL and the import
// fails ("'text/html' is not a valid JavaScript MIME type" on iOS Safari).
// Vite surfaces preload failures through this event BEFORE they become
// throws — reload once so the tab re-enters on the fresh build. Shares the
// ErrorBoundary's session guard (cleared on successful mount) so a genuinely
// broken deploy shows the error card instead of reload-looping.
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return // budget spent — let it throw
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  event.preventDefault() // suppress the throw; we recover instead
  console.warn('[main] Stale chunk preload detected — auto-reloading onto the new build')
  window.location.reload()
})

// ── Sentry initialization ─────────────────────────────────────
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false, // Privacy: do NOT send IP/cookies
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    tracePropagationTargets: [
      "localhost",
      /^https:\/\/memba\.samourai\.app/,
      /^https:\/\/.*memba-multisig\.netlify\.app/,
    ],
    environment: import.meta.env.PROD ? "production" : "development",
    release: `memba@${__APP_VERSION__}`,
    // PII scrubbing: strip wallet addresses from error messages
    beforeSend(event) {
      if (event.message) {
        event.message = event.message.replace(/g1[a-z0-9]{38}/gi, "[REDACTED_ADDRESS]")
        // F10: Scrub Clerk JWT tokens from error messages
        event.message = event.message.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
      }
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) {
            ex.value = ex.value.replace(/g1[a-z0-9]{38}/gi, "[REDACTED_ADDRESS]")
            // W6.5 review note: captureException events surface via
            // exception.values, not message — scrub JWTs here too.
            ex.value = ex.value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
          }
        }
      }
      return event
    },
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TxConfirmationProvider>
          <App />
        </TxConfirmationProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
