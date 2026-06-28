# UX Improvement: Untransacted Wallet Onboarding

> **Priority:** HIGH — directly impacts first-time user conversion
> **Status:** BRIEF — tracked for next sprint
> **Filed:** 2026-06-25 by zôÖma (founded during A3 validation)

---

## Problem

A wallet that has **received** tokens but never **sent** a transaction has `public_key: null` on-chain. Adena's `SignMultisigTransaction` silently fails for these wallets, causing:

1. Login falls back to address-only mode (degraded, yellow banner)
2. The user doesn't understand WHY or what to do
3. Self-send workaround is non-obvious and poor UX

This affects **every new user** who receives GNOT from a faucet or another wallet.

## Current Flow (broken UX)

```
User gets GNOT from faucet → opens Memba → Connect Wallet →
  Adena can't sign (no pubkey) → address-only login (degraded) →
  User sees yellow banner, doesn't understand →
  Must self-send 1 ugnot → then reconnect → NOW signed login works
```

## Proposed Solutions (CTO Expert Council)

### Option A — Guided In-App Activation (Recommended, M effort)

Replace the passive yellow banner with an **active activation flow**:

1. Detect `public_key: null` at connect time (query chain)
2. Show a modal: "Your wallet needs activation — one free transaction"
3. Trigger a **self-send** from within Memba (1 ugnot to self, auto-filled)
4. Wait for confirmation → auto-retry signed login
5. Banner disappears, user is fully authenticated

**Pros:** No external steps, guided, feels premium
**Cons:** Requires Adena to broadcast (it can, just need the UX wrapper)

### Option B — Faucet-Integrated Activation (S effort)

Detect the null-pubkey at connect time and:

1. Show: "Activate your wallet to unlock all features"
2. Auto-open a link to `faucet.gno.land` pre-filled with their address
3. After they claim, show a "Retry" button that re-checks and re-authenticates
4. If they already have GNOT, suggest the self-send within Adena

**Pros:** Simple, works today
**Cons:** Still requires leaving the app

### Option C — Server-Side Pubkey Recovery (L effort, upstream dependency)

If Adena exposes the local pubkey (even without on-chain registration), the backend could accept it as a first-party proof. This would require:

1. Adena API change: expose `getPublicKey()` for unregistered accounts
2. Backend accepts pubkey-in-request when chain has `null` (trust-on-first-use)
3. Once the user transacts, the chain pubkey overwrites

**Pros:** Invisible to user, zero friction
**Cons:** Depends on Adena upstream, trust-on-first-use has security implications

### Option D — ADR-036 `signArbitrary` (L effort, upstream dependency)

If Adena implements ADR-036 `signArbitrary`, we could sign the login challenge without needing the multisig-shaped workaround. This would work for any wallet, transacted or not.

**Pros:** Clean, standard, works everywhere
**Cons:** Depends entirely on Adena implementing ADR-036

---

## Recommendation

**Option A** for immediate UX relief (can ship this sprint), with **Option D** as the long-term clean solution when Adena ships ADR-036.

## Files That Would Change (Option A)

- `frontend/src/components/layout/Layout.tsx` — activation modal trigger
- `frontend/src/hooks/useAdena.ts` — self-send helper
- `frontend/src/components/WalletActivationModal.tsx` — [NEW] guided flow
- `frontend/src/lib/chainQuery.ts` — pubkey null check via ABCI query
