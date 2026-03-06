# Sentry Frontend Observability — Implementation Guide

> **Status:** Planned (pre-mainnet)  
> **Priority:** Medium  
> **Effort:** ~1 hour  
> **Branch:** `dev/v2`

## Overview

Add frontend error tracking and performance monitoring via [Sentry](https://sentry.io) to detect runtime errors, slow renders, and failed chain interactions before users report them.

## Why

- **Current state:** Errors are logged to `console.error` via `errorLog.ts` (in-memory ring buffer, 50 entries). They vanish on page reload and are invisible to the team.
- **Goal:** Capture unhandled exceptions, promise rejections, and chain-critical errors in a dashboard with alerting.

## Implementation Steps

### 1. Install Dependencies

```bash
cd frontend
npm install @sentry/react
```

### 2. Initialize Sentry in `main.tsx`

```tsx
import * as Sentry from "@sentry/react"

Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN || "",
    environment: import.meta.env.MODE,              // "development" | "production"
    release: `memba@${__APP_VERSION__}`,             // uses build-injected version
    integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({ maskAllText: false }),
    ],
    tracesSampleRate: 0.1,                           // 10% of transactions
    replaysSessionSampleRate: 0,                     // no session replay by default
    replaysOnErrorSampleRate: 1.0,                   // 100% replay on error
    beforeSend(event) {
        // Strip PII: remove wallet addresses from breadcrumbs
        if (event.breadcrumbs) {
            event.breadcrumbs = event.breadcrumbs.map(b => ({
                ...b,
                message: b.message?.replace(/g1[a-z0-9]{38}/g, "g1***"),
            }))
        }
        return event
    },
})
```

### 3. Wrap App with Error Boundary

```tsx
// In main.tsx, wrap <App /> with:
<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <App />
</Sentry.ErrorBoundary>
```

### 4. Report Chain Errors

Update `errorLog.ts` to forward critical errors to Sentry:

```ts
import * as Sentry from "@sentry/react"

export function logChainError(context: string, error: unknown, severity: Severity = "error") {
    // ... existing ring buffer logic ...

    // Forward to Sentry for production monitoring
    if (severity === "critical" || severity === "error") {
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
            tags: { context, severity },
        })
    }
}
```

### 5. Environment Variables

| Variable | Where | Value |
|----------|-------|-------|
| `VITE_SENTRY_DSN` | Netlify env vars | From Sentry project settings |

### 6. Source Maps

Add to `vite.config.ts`:

```ts
import { sentryVitePlugin } from "@sentry/vite-plugin"

export default defineConfig({
    build: { sourcemap: true },
    plugins: [
        sentryVitePlugin({
            org: "samourai-coop",
            project: "memba",
            authToken: process.env.SENTRY_AUTH_TOKEN,
        }),
    ],
})
```

### 7. Verification

- [ ] Trigger a test error in dev → appears in Sentry dashboard
- [ ] Chain error (e.g. failed vote) → captured with context tag
- [ ] Source maps resolve to original TypeScript lines
- [ ] No PII (wallet addresses) leaked to Sentry

## Cost

Sentry free tier: 5,000 errors/month — sufficient for testnet phase.

## Security Notes

- DSN is safe to expose in client-side code (it's a write-only key)
- `beforeSend` strips wallet addresses from breadcrumbs
- Source maps are uploaded at build time, not served to users
