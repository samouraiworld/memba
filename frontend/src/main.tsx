import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary'
import { tryChunkReload } from './lib/staleChunk'
import { TxConfirmationProvider } from './components/ui/TxConfirmation'
import { initTheme } from './lib/themeStore'
import { queryClient } from './lib/queryClient'
import { redactSentryBreadcrumb, redactSentryEvent } from './lib/sentryPrivacy'
// Vendored woff2 fonts — latin subset, no OFL npm dep
import './fonts.css'
import './tokens.css'
import './index.css'
import './mobile-tokens.css'
import './components/mobile/mobile-primitives.css'
import App from './App.tsx'

// Apply theme before first paint (avoids flash)
const disposeTheme = initTheme()
if (import.meta.hot) import.meta.hot.dispose(disposeTheme)

// Recover a failed lazy import only when a durable reload budget is available.
// Otherwise allow the import to reject into the accessible error boundary.
window.addEventListener('vite:preloadError', (event) => {
  if (tryChunkReload()) event.preventDefault()
})

// ── Sentry initialization ─────────────────────────────────────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
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
    // Scrub before storage, then again for late/event-supplied breadcrumbs.
    beforeBreadcrumb: redactSentryBreadcrumb,
    beforeSend: redactSentryEvent,
    beforeSendTransaction: redactSentryEvent,
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
