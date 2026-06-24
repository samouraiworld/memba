# Memba test13 — Live Cross-Perspective Audit (2026-06-23)

> **Method:** four independent **read-only** expert passes over the live test13 app (`memba.samourai.app`) and repo — **Desktop UX**, **Mobile/Responsive**, **Fullstack/Data-correctness**, **CTO/Architecture-Security-Ops**. Findings are deduplicated across passes, prioritized, and tagged. Evidence is `file:line`.
>
> **⚠️ Scope caveat — the home was redesigned mid-audit.** The agents ran against the **pre-#455** home. PR **#455 "Home Atlas redesign Phase 0+1 (visitor board-of-doors)"** merged to `main` at 15:12Z the same day. So **`[DESIGN→atlas]` findings are routed to that session** (don't action here) and may already be addressed for the *visitor* home; the *member* home (ActionInbox / YourWorldsPanel / DashboardDAOList) may still apply — verify against #455.
>
> **Tags:** `[BACKEND-OPS]` `[FUNCTIONAL]` (frontend behaviour/UX/a11y) `[SECURITY]` `[DESIGN→atlas]` (hand-off, not actioned here).
> **Status column:** ✅ fix in flight this session · ⬜ open.

---

## 0. TL;DR — what actually matters

| # | Issue | Sev | Tag | Status |
|---|-------|-----|-----|--------|
| 1 | **NFT indexer frozen** — `fetchBlockHash` reads the wrong JSON path; cursor never advances past 259,999 (chain head ~413k) | **CRITICAL** | BACKEND-OPS | ✅ fixing (`fix/nft-tailer-blockhash`) |
| 2 | **Login signatures never verified** (`result=signed_invalid`) — backend emitted `"args":null`; Adena omits it | **HIGH** | BACKEND-OPS/SECURITY | ✅ fixed (`fix/auth-login-signdoc-args`) |
| 3 | **No metrics/observability** — auth-flip signal & indexer lag only visible by hand-grepping Fly logs | **HIGH** | BACKEND-OPS | ⬜ |
| 4 | **Home "DAOs" count overcounts** — counts *all* `r/samcrew` realms (~15+), not DAOs | **HIGH** | FUNCTIONAL | ⬜ |
| 5 | **Mobile bottom-nav unusable on notched iPhones** — no `env(safe-area-inset-bottom)`; missing `viewport-fit=cover` | **HIGH** | FUNCTIONAL | ⬜ |
| 6 | **Auth enforce-flip still open** — Phase-1 leniency accepts unsigned/address-only/invalid sigs (impersonation surface) | HIGH | SECURITY | ⬜ gated (needs #2 deployed + live `signed`) |
| 7 | **Ecosystem stats lie on RPC hiccup** — render confident "0"/fake seed counts, cache stale zeros 5 min | MED | FUNCTIONAL | ⬜ |
| 8 | **`.env`/CI flag divergence** + **live OpenRouter key in `.env`** | MED | SECURITY | ⬜ (rotate key = your action) |

**Net:** the cryptographic/auth core and the responsive system are genuinely solid. Risk is concentrated in **operability** (can't *see* the indexer lag or the auth-flip signal) and a handful of **data-correctness** bugs. Two highest-impact items (#1, #2) are already being fixed this session.

---

## 1. Critical / High — actionable

### 1.1 NFT event-tailer is frozen — JSON struct-path bug `[BACKEND-OPS]` · CRITICAL · ✅ fixing
- **Root cause (fullstack, verified live):** `backend/internal/indexer/tailer.go:330-336` decodes the block hash from `result.block_id.hash`, but test13's `/block?height=N` nests it at **`result.block_meta.block_id.hash`**. The struct field always decodes to `""` → the guard at `tailer.go:348-350` returns `block %d: empty block hash` → `tailOnce` returns at `tailer.go:200-203` *before* advancing the cursor. First-run cursor = `startBlock-1 = 259999`; every 3 s cycle re-fails identically. Permanent livelock, logged + swallowed (never fatal).
- **Confirmed node-independent:** `home_rpc.go:518-527` reads `result.block.header.time` correctly from the same node. **Zero shape-level test coverage** — all `tailer_test.go` cursor tests inject synthetic `"HASH…"` strings, never a real `/block` body.
- **Blast radius:** NFT floor / sales / activity / portfolio / collection volume never update; `IndexerLastBlock` reports 259,999 vs head ~413,700. *Currently low user impact only because NFT UI is flag-gated off.*
- **Fix:** point the struct at `block_meta.block_id.hash` + a real-`/block`-fixture regression test. Cursor **self-heals** on deploy (~15 min to catch up at 500 blocks/3 s). **Prerequisite for the NFT #443 go-live.**

### 1.2 Login signatures never verified — sign-doc mismatch `[BACKEND-OPS/SECURITY]` · HIGH · ✅ fixed
- **Root cause (brute-forced against a real captured signature):** `LoginChallengeSignBytes` emitted `"args":null`; Adena's proto-round-trip (`MsgCall.decode`→`toJSON`) **omits** an empty repeated `args` while keeping empty `send`/`max_deposit`. Every signed login logged `result=signed_invalid` (accepted only by Phase-1 leniency).
- **Fix:** `Args []string` → `json:"args,omitempty"` in `login_challenge.go` + permanent real-vector regression test. Verified: RED→GREEN, full backend green, lint/gosec 0. **Unblocks the enforce-flip.**

### 1.3 No metrics / observability backend `[BACKEND-OPS]` · HIGH
- `main.go:39` is the entire telemetry stack (`slog` JSON). No prometheus/sentry/otel/`/metrics` anywhere. The two production-decision signals (`auth_login` ratio `crypto.go:236`; `multisig_sig_verify` `tx_rpc.go:323`) are **log lines** — the enforce-flip readiness gate ("observe `result=signed` live") is only checkable by hand-grepping Fly logs. `IndexerLastBlock` is exposed but never compared to head → why #1.1 went unnoticed. `/health` (`main.go:404-451`) omits indexer lag & auth ratios.
- **Fix (MVP):** log-drain (Fly→Grafana/Loki/BetterStack) + 2 alerts: (a) `auth_login` signed-ratio, (b) `IndexerLastBlock` vs head delta. This is the **precondition to safely flipping auth enforcement** (item 6).

### 1.4 Home "DAOs" stat overcounts all samcrew realms `[FUNCTIONAL]` · HIGH
- `traction.ts:88-94` → `fetchNamespaceRealms("samcrew").length` (`gnoweb.ts:89-115` returns every `/r/samcrew/*`). The namespace holds tokenfactory_v2, escrow_v2, nft_market_v3, agent_registry, badges, feedback, candidature_v2, channels_v2… Label says "DAOs," value is "total realms," and it climbs as unrelated realms deploy.
- **Fix:** filter to actual DAO realms (registry/pattern) or relabel. *Coordinate with #455 — the new Atlas home may consume this metric differently.*

### 1.5 Mobile bottom-nav collides with iOS home indicator `[FUNCTIONAL]` · HIGH
- `index.css:1352` (`.k-mobile-tabbar`) + `:1419` (`.k-bottom-sheet-content`): `position:fixed; bottom:0; height:56px` with **no `padding-bottom: env(safe-area-inset-bottom)`** (used only in questhub.css, nowhere in core layout). `index.html:6` lacks `viewport-fit=cover`. Primary nav's tap row sits under the gesture bar on iPhone X→16.
- **Fix:** add safe-area padding to tabbar + bottom-sheet; add `viewport-fit=cover`.

### 1.6 Auth enforce-flip still open (Phase-1 leniency) `[SECURITY]` · HIGH · gated
- Intentional + well-built (`crypto.go:208-228`, `417-449`, `373-392`): empty-sig, address-only, **and** present-but-invalid sigs are accepted+logged. A token can be minted for **any address** with no key proof, authorizing all Memba-side ConnectRPC actions. **Backstop:** multisig membership is checked per-op and A3 reconstructs sign-bytes server-side, so an impersonator still can't forge a valid *on-chain* multisig signature — exposure is **Memba-side identity/data**, not direct fund theft.
- **Fix:** after #1.2 deploys + #1.3 confirms `result=signed` live → set `MEMBA_ALLOW_UNSIGNED_AUTH=0` **and** `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY=1` together (24 h token TTL → stragglers re-auth within a day).

---

## 2. Medium

- **Ecosystem stats degrade dishonestly** `[FUNCTIONAL]` — on the live (non-snapshot) path, failed sources render a confident **"0"** not "—" (`useEcosystemCounts.ts:84-87`); `fetchAgents()` returns **fake `SEED_AGENTS`** on hard RPC failure (`agentRegistry.ts:342-348`); `traction.ts` **caches all-zero results for 5 min** and its cache key isn't network-suffixed (`traction.ts:26,107`). A single transient RPC error looks like a real empty ecosystem. *Coordinate with #455.*
- **Banner pile-up** `[FUNCTIONAL]` (desktop + mobile) — up to **7** independent full-width banners stack below the topbar (`Layout.tsx:301-318`, `TopBar.tsx:159-226`), burying content below the fold (worse on mobile). Collapse to one prioritized slot.
- **a11y: non-semantic interactive elements** `[FUNCTIONAL]` (desktop, cross-surface) — clickable `<div>`s with no role/tabindex/keyboard on Dashboard cards & rows (`Dashboard.tsx:323,411,487`), DAO cards (`DAOList.tsx:324`), Validators sortable headers + rows (`Validators.tsx:442-492`), Extensions cards (`Extensions.tsx:116-131`); unlabeled form inputs (`CreateToken.tsx`, `TreasuryProposal.tsx:140-176`); vote confirm dialog has no focus-trap (`ProposalView.tsx:495-508`).
- **Candidature "Go to Quest Hub" navigates to `/profile`** `[FUNCTIONAL]` — `CandidaturePage.tsx:178-184` button mislabeled *and* wrong route (should be `/quests`). Isolated, quick win.
- **Deploy gates weaker than PR CI** `[BACKEND-OPS]` — `deploy-backend.yml:14-36` skips lint + coverage; `deploy-frontend.yml:14-46` skips the feature-flag safety gate, bundle budget, E2E/Playwright that `ci.yml` runs. Make deploy workflows `needs:` the full `ci.yml`.
- **`.env` / CI flag divergence** `[SECURITY/FUNCTIONAL]` — committed `.env:30-32` sets `VITE_ENABLE_NFT/MARKETPLACE/SERVICES=true` vs `.env.example=false`; prod is safe **only by omission** (Netlify/`deploy-frontend.yml` set none → default-off). The CI safety gate (`ci.yml:97`) scans only `.env.example` and covers 4 of 8 flags (misses `MARKETPLACE`, `BADGES`). Align `.env`, extend the gate.
- **Backend single-RPC, no failover** `[BACKEND-OPS]` — indexer/marketplace/home-snapshot/quest-verifier each hit a hardcoded `rpc.test13.testnets.gno.land` literal with **no fallback list** (frontend has one). `render_proxy.go:26` still defaults to **retired testnet12** (masked only because `GNO_RPC_URL` is set). Add a backend fallback list; set `NFT_RPC_URL`/`MARKETPLACE_RPC_URL` explicitly in `fly.toml`.
- **Single Fly machine + volume = SPOF** `[BACKEND-OPS]` — `fly.toml:12-19` one machine, 24 h backup interval (up to 24 h data loss on volume loss), no in-code restore. Acceptable for testnet; shorten `BACKUP_INTERVAL`, run a restore drill, consider Litestream.
- **Validator count: 3 code paths that can drift** `[FUNCTIONAL]` — `useEcosystemCounts.ts:74` vs `useNetworkPulse.ts:48,67` vs `useValidatorHealth.ts`; single-source them.
- **Backend lacks error surfaces** `[FUNCTIONAL]` — Dashboard (`Dashboard.tsx:104-109`) and TokenDashboard (`TokenDashboard.tsx:34-38`) only `console.warn`/`error` on backend failure → outage looks identical to "you have nothing." Add non-blocking "service unreachable" notices.
- **Uncollapsed multi-column grid "tables" on mobile** `[FUNCTIONAL]` — dashboard activity (`dashboard.css:144`) and multisig tx rows (`multisigview.css:216`) are fractional grids with no media query → crush to ~70-100 px columns and truncate ≤360 px.
- **"Back to Dashboard" buttons land on Home** `[FUNCTIONAL]` — `NotFound.tsx:29`, `ComingSoonGate.tsx:54`, `DAOList.tsx:146` navigate to `/dashboard` which 302s to `/:network/` (the home). Relabel or point at a real surface.
- **Network selector offers non-deployed chains** `[FUNCTIONAL]` — `TopBar.tsx:93` uses `VISIBLE_NETWORKS`, `Settings.tsx:158` iterates all `NETWORKS`; some have no realms/faucet → DAO/quests 404. (Note #455 reduced networks to test13+gnoland1 — re-verify.)

---

## 3. Low / polish

- Command-palette input `font-size:15px` → iOS zoom-on-focus (429-600 px) (`command-palette.css:54`).
- DAOMembers role text `#888` on dark = sub-WCAG-AA (`DAOMembers.tsx:175,202,242,269`); pervasive hardcoded hex/rgba instead of theme tokens won't adapt to light mode.
- Empty vote bars hidden for 0-vote proposals (`ProposalCard.tsx:174`); disabled vote buttons show "…" hiding their label (`ProposalView.tsx:511-518`).
- QuestAdmin gated on a single hardcoded address, client-side (`QuestAdmin.tsx:17,32`) — move allowlist server-side.
- Tablet sidebar overlay has no scrim / outside-click close (`index.css:1505-1537`).
- Stale "NOT YET DEPLOYED" comments on live realms (`config.ts:518`, `nftConfig.ts:23-25`); `memba_collections` shipped 2026-06-17.
- Dead code: unreferenced `.board-sidebar` (`board.css:10`); orphaned `NetworkStatsLive.tsx`.
- Public read-proxies (`/api/render`, `/api/balance`) are intentional & well-defended (SSRF guard, allowlist, rate limits) — only note: per-/24 limits won't stop a cross-subnet botnet amplifying toward the single upstream RPC.

---

## 4. `[DESIGN→atlas]` — hand-off to the #455 home-redesign session (not actioned here)

- **"My DAOs / Your worlds" list overflow** — `components/dashboard/DashboardDAOList.tsx:88` maps `savedDAOs` with no `.slice()`/`maxHeight`/`overflow` (reused by `YourWorldsPanel.tsx:49`). Root cause of the screenshot. *#455 redid the visitor home; the **member** home likely still uses this — verify.*
- Home icon-system inconsistency (raw Tabler `<i class="ti …">` vs Phosphor elsewhere).
- Member spine (`ActionInbox`) / dense panels are exactly what the Atlas rework is replacing.

---

## 5. Top priorities (recommended order)

1. **Stand up minimal observability** (item 1.3) — highest leverage; unblocks the auth-flip and would have caught the frozen indexer. Log-drain + 2 alerts.
2. **Ship #1.2 (auth) + #1.1 (tailer)** — both fixes are ready/in-flight this session.
3. **Close the auth Phase-1 window** (item 1.6) once 1.2 deploys + 1.3 confirms `result=signed`.
4. **Fix the home data libs** (1.4 DAO overcount, 2.x ecosystem-stat honesty) — coordinate with #455.
5. **Chores:** rotate the live OpenRouter key (`.env`); align `.env` flags + extend the CI gate; refresh stale comments.

## 6. Verified-correct (negative space — confirmed fine)
Crypto core (challenge binding, nonce replay, chain-id binding, server-side sign-byte reconstruction, two-phase lockout-safe rollouts); SSRF guard on IPFS proxy; `/api/eval` removed; quests/points scoring (server-authoritative, monotonic tiers, deadlock fixed); `fetchNetworkPulse` block-time math; `/block_results` parser; HomeSnapshot proto reads; test12 fully removed from selectable networks (default test13); responsive system (global `overflow-x:hidden` net, 6-tier breakpoints, table `overflow-x:auto` wrappers, ≤428px iOS zoom prevention). The mobile pass self-filtered ~8 false positives.

---
*Sources: 4 read-only agent passes, 2026-06-23. Items 1.1 & 1.2 are being fixed this session; everything else is open and prioritized above.*
