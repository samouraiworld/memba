import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initTheme } from './lib/themeStore'
import './tokens.css'
import './index.css'
import App from './App.tsx'

// Apply theme before first paint (avoids flash)
initTheme()

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
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
