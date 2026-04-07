# Mainnet Preparation Tasks

This document tracks items to be addressed before the mainnet release.

## Chain Status (2026-03-31)

| Chain | Status | Notes |
|-------|--------|-------|
| **testnet12** | ✅ Active | Primary development target. gnoweb: [gnoweb.test12.moul.p2p.team](https://gnoweb.test12.moul.p2p.team/r/samcrew) |
| **gnoland1 (betanet)** | 🔴 HALTED | Consensus bug under investigation by Gno core team. Continue dev on testnet12 independently. |
| **portal-loop** | ✅ Active | Used for validator monitoring. Unstable (frequent resets). |

## ✅ Frontend Observability — Sentry (DONE)

> **Shipped:** v2.0-z (PR #69, 2026-03-07). Self-hosted at `sentry.samourai.pro` with PII scrubbing.

## ✅ CSP Audit (v2.23.0)

### Current State

The Content-Security-Policy is configured in **two locations** (must be kept in sync):

| Location | Scope |
|----------|-------|
| `frontend/index.html` meta tag (L17-28) | Local dev + fallback |
| `netlify.toml` headers (L25) | Production (Netlify edge) |

### script-src Analysis

```
script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://clerk.samourai.app https://*.clerk.accounts.dev blob:;
```

| Directive | Why | Risk | Removable? |
|-----------|-----|------|------------|
| `'self'` | Own scripts | None | No |
| `'unsafe-inline'` | Vite dev HMR + inline event handlers | Low | When migrating to nonce-based CSP |
| `'wasm-unsafe-eval'` | Adena wallet WebAssembly (secp256k1 crypto) | Very low — only allows WASM compilation, NOT arbitrary JS eval | When Adena removes WASM dependency |
| `https://clerk.samourai.app` | Clerk auth SDK | Low | If Clerk removed |
| `https://*.clerk.accounts.dev` | Clerk dev environments | Low | In production-only mode |
| `blob:` | Web Worker creation (Jitsi, crypto) | Low | No |

### Key Clarification

**`wasm-unsafe-eval` is NOT `unsafe-eval`.**

- `unsafe-eval` allows `eval()`, `Function()`, and `setTimeout("string")` — arbitrary JS execution
- `wasm-unsafe-eval` ONLY allows `WebAssembly.compile()` and `WebAssembly.instantiate()` — WebAssembly compilation only

Adena wallet uses WebAssembly for secp256k1 elliptic curve operations. Without `wasm-unsafe-eval`, wallet signing fails. This is a standard requirement for crypto wallets.

### Removal Roadmap

1. **`wasm-unsafe-eval`** — Remove when Adena drops WebAssembly dependency (track Adena releases)
2. **`'unsafe-inline'`** — Replace with nonce-based CSP when build tooling supports it
3. **Clerk dev domains** — Remove `*.clerk.accounts.dev` in production-only builds

## ✅ Error Message Hardening (v2.22.1)

> **Shipped:** v2.22.1. `friendlyError()` fallback no longer leaks internal realm paths,
> panic traces, or hex addresses. 7 new test cases covering path stripping.

## ✅ Token Fee Display Fix (v2.22.1)

> **Shipped:** v2.22.1. CreateToken.tsx label corrected from "5%" to "2.5%" matching `grc20.ts`.

## ✅ Upstream Compatibility Shield (v2.21.0)

> **Shipped:** v2.21.0. Board parser strategy pattern (V1/V2), GovDAO vote function
> configurable constants, 63 integration tests. See [GNO_CORE_COMPAT.md](GNO_CORE_COMPAT.md).

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
| **ADR-036 signature verification** | Blocked | Re-enable when Adena supports it |
| **boards2 safe functions** | Monitor ([gno#5037](https://github.com/gnolang/gno/pull/5037)) | V2 parser skeleton ready (v2.21.0) |
| **govdao T1 multisig** | Monitor ([gno#5222](https://github.com/gnolang/gno/pull/5222)) | Vote function name configurable (v2.21.0) |
| **gnoland1 relaunch** | Blocked (chain halted) | Continue on testnet12, update when chain resumes |

## 🟡 Deferred Security Items

### ED25519_SEED Key Rotation — DEFERRED

**Risk:** MEDIUM (single-key, no rotation mechanism).
The seed is stored as a Fly.io secret and never committed. Challenge expiry is 5 minutes + nonce replay prevention.
**When:** Post-mainnet, when user base grows. Implement `ED25519_SEED_V{N}` key versioning.

### Separate Clerk Applications — DEFERRED

**Risk:** LOW. Single Clerk app used for dev and prod. Dev sessions don't touch production data.
**When:** When team grows beyond 3 developers.

## ✅ Completed

| Item | Version | Notes |
|------|---------|-------|
| Frontend Observability (Sentry) | v2.0-z | Self-hosted at `sentry.samourai.pro` with PII scrubbing |
| Gnolove Consolidation | v2.19.0 | gnolove.world data available at `/gnolove` |
| CSP Audit | v2.23.0 | `wasm-unsafe-eval` documented, NOT `unsafe-eval` |
| Error Message Hardening | v2.22.1 | `friendlyError()` no longer leaks internal paths |
| Token Fee Display | v2.22.1 | Fixed "5%" label to "2.5%" |
| Upstream Compatibility Shield | v2.21.0 | Parser V1/V2, GovDAO constants, 63 tests |

---
*Updated 2026-04-07 during v3.3.0 (AI Council network isolation, prompt enrichment, bug fixes).*
