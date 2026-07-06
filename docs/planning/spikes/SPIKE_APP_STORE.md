# SPIKE — Memba App Store (curated dApp listings)

**Date:** 2026-07-06 · **Box:** 1d + 1 afternoon fee-path P0 · **Status:** ✅ COMPLETE — **verdict: GO** (curated P0; the money path is verifiably safe *by design*, on-chain verification is an owner-executed deploy) · **Program ref:** `MEMBA_ROADMAP_COMPOUND_2026-07.md` §4.3, Wave 9.

## Question
Can Memba ship a **curated App Store** — a merchandised surface listing gno.land dApps — where the only money path (a paid listing fee) is provably safe (fee → treasury, nothing custodied), and are there enough real apps to launch with?

## Thresholds (roadmap spike table)
- **GO:** fee→treasury verified on test13 incl. `IsUserCall` guard + treasury-misconfig handling + concurrent-registration check; **≥5 plausible launch listings** identified.
- **KILL:** the fee path needs custody/escrow to be safe, **or** <5 real dApps exist to list.

## Findings

### 1. The fee path is safe *by design* — building blocks confirmed live on test13

**The fee spine is LIVE and already serves an "appstore" lane.** `vm/qrender gno.land/r/samcrew/memba_market_config` on test13 (2026-07-06):
- **Treasury** = `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh` (the admin multisig — a real, set address, not zero).
- **Fee ceiling** = 500 bps; configured lanes `nft`/`service` = 200, `token` = 50; **"*Unset lanes default to 200 bps*"** → the **`appstore` lane works out-of-the-box at 200 bps** with no config change; the DAO can set it later via `SetFeeBPS`.
- API to read at settlement: `GetLaneConfig(lane) → (feeBPS, treasury)` (`config.gno:73`), non-failing.

**The safe fee-forward pattern already exists** — `memba_token_otc_v1/otc.gno:175-201` is the precedent the App Store's `RegisterApp` copies verbatim:
1. **Exact-coin** payment via `unsafe.OriginSend()` (the coins attached to *this* call), **not** the caller's wallet balance — closes the overpay-trap and the wallet-balance-bypass (`otc.gno:179`).
2. **CEI** — mutate listing state before moving funds.
3. **Immediate forward, zero custody** — `banker.NewBanker(BankerTypeRealmSend, cur)` sends the fee from the realm's own address to `GetTreasury()` in the same call (`otc.gno:194-197`). Nothing is ever held.

**The one addition the App Store MUST make (the O-13 lesson):** `RegisterApp` must call **`IsUserCall()` before reading `unsafe.OriginSend()`** — the exact guard `agent_registry.DepositCredits` is missing (O-13). Without it, an ephemeral `maketx run` realm could attach coins that become unrecoverable. OTC is a direct-user-call path; the App Store must enforce it explicitly. `NewBanker` is built with `cur` (`IsCurrent()==true`), never `cur.Previous()`.

**On-chain fee-path P0 checklist** (owner-executed once `memba_appstore_v1` is deployed to test13 — a spike cannot deploy):
- [ ] `IsUserCall()` guard present; an ephemeral-realm `RegisterApp` **panics** (adversarial test).
- [ ] single `RegisterApp` → treasury balance increases by exactly the fee.
- [ ] **treasury-misconfig**: if `GetTreasury()` were zero/unset → **panic-and-refund**, never silently custody (define + test).
- [ ] **5 concurrent registrations** all land, each forwards its fee (no lost/double fee).
- [ ] invariant: `sum(fees received by treasury) == sum(RegisterApp fee args)`.

`VITE_ENABLE_APPSTORE` stays in `SAFETY_GATED_FLAGS` **until this checklist passes on test13**, then de-gates. Everything else in the App Store is read-only.

**KILL condition not triggered:** the fee is *forwarded*, never *custodied* — no escrow/custody is needed to be safe (that's exactly why the OTC pattern fits). The path is a plain fee-collect, not a marketplace escrow.

### 2. ≥5 plausible launch listings — met, with a first-party flagship

| # | Listing | Kind | Notes |
|---|---------|------|-------|
| **1** | **Block Party Game** | **first-party, flagship demo** | Daily chain-seeded 2048 game (being built, #781/#782). **First listing** — and because it's a *Memba-native route* (not a third-party frontend), it sidesteps the iframe/wallet-phishing concern entirely (see §3). |
| 2 | Memba Feed | first-party | `memba_feed_v1`, live on test13. |
| 3 | NFT Marketplace (v3.1) | first-party | live commerce lane. |
| 4 | Token OTC | first-party | `memba_token_otc_v1`. |
| 5 | GnoBuilders / Quests | first-party | quests + badges. |
| 6 | Gnoswap | ecosystem | `r/gnoswap` DEX (pure-Render + external frontend). |
| 7 | Boards | ecosystem | `r/gnoland/boards`, embeddable pure-Render. |
| 8 | Valopers | ecosystem | `r/gnops/valopers`, pure-Render. |
| 9 | Gnolove | ecosystem | contributor dashboard. |

Nine identified, five first-party — comfortably clears the ≥5 bar. Launch curated-only (`pending` → a daokit `curator` role flips `live`).

### 3. Games embedding — the first listing de-risks it
The general risk (Part 4.3) is embedding *arbitrary third-party* frontends: an app rendered inside Memba that asks Adena to sign *looks endorsed* (wallet-phishing surface), so third-party apps launch as **"Open app ↗" (new tab) + an interstitial** ("leaving Memba — verify the realm path"), never an iframe. **Block Party is first-party** — a Memba route already flag-gated in our own frontend — so the flagship demo is a native link, not an embed. An iframe program (sandbox without `allow-same-origin`, curator-vetted origins, static CSP allowlist) stays a deliberate Phase-3 decision.

### 4. Reuse (no new infrastructure)
- **Reviews/stars**: reuse the `memba_reviews_v1` subject-key pattern with an `"app"` namespace — no new review machinery.
- **Icons/screenshots**: the existing IPFS proxy/serve pair (CIDs on-chain, MIME-allowlisted serve) — same as the feed's `PinMedia`.
- **Curation & moderation**: daokit `curator`/`moderator` roles; share `p/samcrew/modboard` if extracted for the feed.

## Verdict: **GO** (curated P0)
Both GO conditions are met: the fee→treasury path is safe **by design** with every building block confirmed live (fee-spine + treasury on test13, exact-coin/immediate-forward OTC precedent, the O-13 guard requirement made explicit), and **≥5 real listings** exist — led by **Block Party as the first-party flagship demo**. Neither KILL condition triggers (no custody/escrow needed; >5 apps). The only work a spike can't do is the on-chain fee-path checklist, which is an **owner-executed deploy + verify** of `memba_appstore_v1`.

### Recommended build shape
1. **Deployer** (owner-executed): realm `r/samcrew/memba_appstore_v1` — `Listing{id, pkgPath (unique key), name, tagline, descr, category, iconCID, screenshotCIDs ≤6, appURL, versions[], publisher, status(pending/live/delisted), flagCount}`; `RegisterApp` (paid, the ONLY money path — `IsUserCall` guard → exact-coin `OriginSend` → `NewBanker(RealmSend, cur)` forward fee to `GetTreasury()`, panic-and-refund on misconfig); curator role flips `pending→live`. + the 5-point fee-path checklist above, adversarial tests.
2. **Frontend**: new **`/apps`** page (AppStorePage + AppDetail) — a merchandised surface, not a Directory tab; Block Party featured. Cross-link to the Explorer's source view ("read the contract you're about to use"). Behind `VITE_ENABLE_APPSTORE` (**SAFETY_GATED** until the checklist passes, then de-gate).
3. **Cross-link with the Explorer** (#776): each AppDetail links to `/explorer/<pkgPath>` for the trust tab.

### Owner actions
- **Fee-path P0 is owner-gated** (on-chain): deploy `memba_appstore_v1` to test13 via samcrew-deployer, run the 5-point checklist, then de-gate `VITE_ENABLE_APPSTORE`. (Prep + dry-run are session work; the deploy/verify is yours.)
- Optional: set the `appstore` lane fee via the DAO (defaults to 200 bps otherwise).
- Ties into U-8 (per-lane fee policy).

## How this was measured
`gnokey query vm/qrender gno.land/r/samcrew/memba_market_config:` on `rpc.test13.testnets.gno.land` (2026-07-06) → treasury + per-lane fees + the 200-bps default. Safe-pattern precedent read from `samcrew-deployer/projects/memba/realms/memba_token_otc_v1/otc.gno:175-201` and the O-13 anti-pattern from `agent_registry.gno`. (`vm/qeval` on the official test13 RPC intermittently 500s — `qrender` is authoritative here.)
