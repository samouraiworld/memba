# Memba — Performance Remediation Plan — 2026-07-08

> **ARCHIVED 2026-07-09 — ALL CODE TIERS MERGED** (#810/#812/#815–#820/#830/#832/#833 + enablers #822/#825/#831). Only W1.5 (indexer → own process) remains — an owner architecture decision, tracked in `BACKLOG_PLAN_2026-07-08.md`.

Investigation trigger: "the app is sometimes laggy." Root causes were confirmed by
four parallel perf-expert **code** audits (frontend-render, network/on-chain,
backend/SQLite, bundle/load) plus inline call-site reads — not a live trace (the
perf classifier was flapping, so we quantified from the code instead). Dist sizes
were measured from the committed prod build; on-chain read counts estimated from
call-sites.

Two headline corrections to the preliminary read:
- ❌ **"remotion is bloating the bundle"** — WRONG. `remotion`/`@remotion/*` are
  dead deps (zero imports, absent from `dist/`). Remove for hygiene only.
- ❌ **"just bump the Fly instance"** — imprecise. The real backend bottleneck was a
  one-line pool cap (`SetMaxOpenConns(1)`), not box size.

---

## Delivery status

**Shipped — merged to `main` (all TDD, all CI-green):**

| PR | Item | Area |
|----|------|------|
| #810 | W1.1 multi-connection SQLite read pool (reads stop serializing behind indexer writes) | backend |
| #818 | W1.2 home-snapshot singleflight + parallel sources | backend |
| #812 | W2.1/2.2 feed render: isolated clock leaf + memoized markdown/unfurl + React.memo | frontend |
| #815 | W2.4/2.5 memoized Outlet context + de-blurred sticky top bar | frontend |
| #820 | W2.3 feed `content-visibility` (windowing deferred — 2 experts advised against a lib pre-launch) | frontend |
| #819 | W3.1 TokenDashboard → React Query caching | frontend |
| #816 | W4.2 lazy-load Clerk (off anonymous visits) | frontend |
| #817 | W4.1 right-size favicon / apple-touch / OG (~1.1 MB) | frontend |

Plus enablers: **#822** (`.gitattributes` `CHANGELOG.md merge=union`) and **#825**
(deterministic treasury E2E).

**In progress / remaining (each larger or consistency-sensitive — one focused PR each):**
- **W3.2 Directory read fan-out** — Directory▸DAOs issued ~2–4× the on-chain reads it
  needed: `useResolvedDirectoryDaos` called the heavy `getDAOConfig` (Render + a
  memberstore/IsArchived follow-up) only to test non-null, then `DAOsTab` ran a
  SECOND per-DAO fan-out (`batchGetDAOMetadata`) that re-rendered the same paths.
  Fix: resolve **and** parse card metadata from a **single React-Query-cached
  `Render("")` per DAO**. Behaviour-preserving (resolution = the same first-read
  truthiness `getDAOConfig` keyed on); no change to the shared `getDAOConfig`.
- **W1.4 `reply_count` denormalization** — `feed_rpc.go:69` correlated per-row
  subquery + double `NOT EXISTS(feed_blocklist)`, and `:272` un-indexable
  `ORDER BY reply_count` filesort in `GetFeedStats`. Consistency-sensitive: the
  denormalized counter must stay correct across reply delete/hide/blocklist/unhide.
- **W1.5 indexer → its own Fly process** — also removes the indexer single-point-of-
  failure the main audit flagged.
- **W3.3/3.4 rpcFallback** — transport-level dedup/coalescing + same-URL retry/backoff
  before failover. Core RPC client; touches every on-chain read.

---

## Root causes (ranked) and the full workstream table

### 1. BACKEND — `SetMaxOpenConns(1)` serialized every read behind every indexer write
`backend/internal/db/db.go` capped the SQLite pool at one connection; three in-process
indexer goroutines shared it with all RPC serving, wasting WAL concurrency. **Fixed by
W1.1 (#810).**

### 2. FRONTEND — feed render hotspot cluster
Unmemoized `PostCard`, a per-card 15s clock, and in-render regex/unfurl parsing kept
N cards churning the main thread. **Fixed by W2.1/2.2/2.3 (#812/#820).**

### 3. BACKEND/FRONTEND — per-request sync work + on-chain read fan-out
Home-snapshot thundering herd (**W1.2 #818**), TokenDashboard uncached reads
(**W3.1 #819**), Directory▸DAOs fan-out (**W3.2, in progress**), `GetFeedStats`
filesort + correlated `reply_count` subquery (**W1.4, pending**).

### 4. FRONTEND — load weight + shell re-render storm
Outlet context recreated every render (**W2.4 #815**), Clerk shipped to anon visitors
(**W4.2 #816**), oversized favicon/apple-touch/OG (**W4.1 #817**), sticky-bar
`backdrop-filter` scroll jank (**W2.5 #815**).

### Workstream reference (S ≤ ~0.5d · M ~1–2d · L > 2d)

| # | Fix | File(s) | Effort | Status |
|---|-----|---------|--------|--------|
| W1.1 | Split a read pool (`?mode=ro`, multi-conn WAL); keep 1 writer | `db.go` | S | ✅ #810 |
| W1.2 | `GetHomeSnapshot` singleflight + parallel sub-reads | `home_rpc.go` | M | ✅ #818 |
| W1.3 | `GetLeaderboard` rank recompute off the request path | `quest_rpc.go` | M | backlog |
| W1.4 | Denormalize `reply_count` (kills filesort + per-row subquery) | `feed_rpc.go` | M | ⏳ pending |
| W1.5 | Indexer → its own Fly machine (also fixes SPOF) | `cmd/memba/main.go` | M→L | ⏳ pending |
| W2.1 | `React.memo(PostCard)` + memoize body/unfurl parse | `PostCard.tsx` | S | ✅ #812 |
| W2.2 | One list-level clock instead of N per-card timers | `PostCard.tsx` | S | ✅ #812 |
| W2.3 | Feed `content-visibility` (true virtualization deferred) | `FeedPage.tsx` | M | ✅ #820 |
| W2.4 | Memoize the Layout Outlet context object | `Layout.tsx` | S | ✅ #815 |
| W2.5 | De-blur sticky bar (opaque token bg) | `index.css` | S | ✅ #815 |
| W3.1 | React Query cache for TokenDashboard reads | `TokenDashboard.tsx` | S | ✅ #819 |
| W3.2 | Directory▸DAOs: single cached render per DAO (resolve + metadata) | `useResolvedDirectoryDaos.ts`, `DAOsTab.tsx`, `daoMetadata.ts` | M | ⏳ in progress |
| W3.3 | Transport-level dedup/coalescing in the RPC client | `rpcFallback.ts` | M | ⏳ pending |
| W3.4 | Same-URL retry/backoff before failover | `rpcFallback.ts` | S | ⏳ pending |
| W4.1 | Resize favicon/apple-touch/og-image | `public/` | S | ✅ #817 |
| W4.2 | Fully lazy `AdminPanelLink`/`useClerkAuth` so Clerk is off anon | `AdminPanelLink.tsx` | S | ✅ #816 |
| W4.3 | Lazy Layout-pinned CommandPalette/OnboardingWizard/Jitsi/toast | `App.tsx`, `Layout.tsx` | M | backlog |
| W4.6 | Remove dead `remotion*` deps | `package.json` | S | backlog |

---

## Verification per PR
- Backend: unit test the change + a concurrency test; before/after p50/p95 on the
  affected RPC; watch Fly CPU-steal + latency.
- Frontend: `npm run build` chunk report for entry-size deltas; React Profiler / read-count
  assertions; the existing TDD + E2E gates; §13 design-token grep for any CSS change.
- All: TDD; branch → PR (never commit `main`); ESLint ratchet `--max-warnings=55`;
  `golangci-lint run` locally before pushing Go (errcheck is enforced, incl. deferred
  `Close()`).

## Separate LIVE P0 (not perf — surfaced by the same audit)
`OriginSend` read without an `IsUserCall` guard on the LIVE fund pools
`candidature_v2.Apply` + `agent_registry.DepositCredits` (drainable on mainnet;
reference fix = `memba_appstore_v1 RegisterApp`). Tracked separately in the deployer
audit — must not ship the unguarded realms to mainnet.
