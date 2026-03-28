# Mainnet Preparation Tasks

This document tracks items to be addressed before the mainnet release.

## ✅ Frontend Observability — Sentry (DONE)

> **Shipped:** v2.0-ζ (PR #69, 2026-03-07). Self-hosted at `sentry.samourai.pro` with PII scrubbing.

## 🔮 GnoSwap Slippage Tolerance (DEFERRED)

> Spec exists in [`GNOSWAP_SLIPPAGE.md`](planning/GNOSWAP_SLIPPAGE.md). UI partially implemented. Deferred to post-betanet.

## 🟡 Staging Environment (Medium Priority)

### Recommended Setup:
- **Frontend**: Use Netlify branch deploys for the `staging` branch.
- **Backend**: Deploy a separate Fly.io app instance (e.g., `memba-backend-staging`) with its own SQLite database.
- **Environment Variables**: Set `VITE_API_URL` to point to the staging backend for the staging branch.

## 🟡 Remaining Blockers

| Blocker | Status | Notes |
|---------|--------|-------|
| **Betanet network config** | Pending upstream ([gno#5250](https://github.com/gnolang/gno/pull/5250)) | Chain IDs, RPC URLs, trusted domains |
| **CSP tightening** | Blocked | Remove `unsafe-eval` when Adena drops wasm-eval |
| **ADR-036 signature verification** | Blocked | Re-enable when Adena supports it |
| **boards2 safe functions** | Monitor ([gno#5037](https://github.com/gnolang/gno/pull/5037)) | May change Render format |
| **govdao T1 multisig** | Monitor ([gno#5222](https://github.com/gnolang/gno/pull/5222)) | May rename voting functions |

## ✅ Completed

| Item | Version | Notes |
|------|---------|-------|
| Frontend Observability (Sentry) | v2.0-ζ | Self-hosted at `sentry.samourai.pro` with PII scrubbing |
| Gnolove Consolidation | v2.19.0 | gnolove.world data available at `/gnolove` |

---
*Updated 2026-03-28 during v2.20 docs sweep.*
