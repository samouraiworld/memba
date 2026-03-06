# Mainnet Preparation Tasks

This document tracks items to be addressed before the mainnet release.

## 🟡 Frontend Observability — Sentry (High Priority)
To ensure production stability, we need to implement error tracking.

### Implementation Steps:
1. **Option A: Sentry (Recommended)**
   - Install dependency: `npm install @sentry/react`
   - Initialize in `main.tsx` with a DSN from environment variables.
   - Wrap the root component `<App />` with `Sentry.ErrorBoundary`.
   - Configure Vite plugin to upload source maps during the build process.
2. **Option B: Lightweight Self-hosted**
   - Utilize the existing `errorLog.ts` ring buffer.
   - Create a `/errors` API endpoint on the backend.
   - Send `getRecentErrors()` to the backend upon unhandled exceptions.

## 🟡 GnoSwap Slippage Tolerance (Medium Priority)
Enable transactional slippage protection for the GnoSwap integration.

### Implementation Steps:
1. **State Management**: Add `slippageTolerance` state in `SwapView.tsx` (default 0.5–1%).
2. **Calculation**: In `builders.ts`, calculate `minAmountOut = expectedOut * (1 - slippage)`.
3. **Router Integration**: Pass `minAmountOut` to the GnoSwap router's `SwapRoute()` call.
4. **UI/UX**: Add a slippage control (0.1%, 0.5%, 1%, or custom) in the `SwapView` interface.

## 🟡 Staging Environment (Medium Priority)
Establish a dedicated staging environment for final verification.

### Recommended Setup:
- **Frontend**: Use Netlify branch deploys for the `staging` branch.
- **Backend**: Deploy a separate Fly.io app instance (e.g., `memba-backend-staging`) with its own SQLite database.
- **Environment Variables**: Set `VITE_API_URL` to point to the staging backend for the staging branch.

---
*Created by subagent during pre-mainnet audit.*
