# Changelog

All notable changes to Memba are documented here.

## v2.15.0 (2026-03-19) — Gnoland1 Support & Smooth Network Switching 🌐

> Branch: `feat/gnoland1-smooth-switching`

### Added

- **🌐 Gnoland1 (Betanet) Network** — added to NETWORKS config with Samourai sentry RPC (`rpc.gnoland1.samourai.live`)
  - Explorer URL: `https://betanet.gno.land`
  - User registry: `gno.land/r/sys/users`
  - GnoSwap paths: empty (not deployed on gnoland1)
  - Added to `getExplorerBaseUrl()`, `GNOSWAP_PATHS`, and trusted domain tests

- **🔄 Adena Smooth Network Switching** — `useAdena.ts` now exposes `addNetwork()` and `switchWalletNetwork()`
  - `addNetwork({ chainId, chainName, rpcUrl })` — programmatically adds a chain to Adena (opens confirmation popup)
  - `switchWalletNetwork(chainId, chainName?, rpcUrl?)` — switches wallet to target chain, auto-adds if `UNADDED_NETWORK`
  - `ChainMismatchBanner` component extracted from TopBar — smart resolution:
    - Known chain → "Switch Memba to {chain}" button
    - Unknown chain + Adena available → "Add & Switch Wallet to {chain}" button (with spinner + disabled state)
    - Fallback → manual instructions

- **🔔 Network Switch Success Toast** — teal toast in Layout for successful wallet switches (3s auto-dismiss)
- **📣 WhatsNewToast updated** — Betanet entry now reads "Betanet (gnoland1) — Now available"

### Changed

- `ARCHITECTURE.md` — replaced test11 references with multi-network
- `README.md` — chain table updated to 6 networks (test12 default, gnoland1 added)
- `.env.example` — added gnoland1 sentry RPC example
- `Changelogs.tsx` — added v2.15.0 entry

### Tests

- `config.test.ts` — 4 new assertions: gnoland1 in NETWORKS, correct config, trusted domain, r/sys/users registry
- All 776+ tests passing (35 files)

---

## v2.14.0-alpha (2026-03-17) — Hacker View & Validator Detail Pages 🕵️‍♂️

> Branch: `feat/validators-hacker-mode` — in progress, targeting testnet12

### Added

- **🕵️ Dedicated Hacker View** — new route `/validators/hacker`, fully decoupled from the standard validators page
  - `HackerStatusBar.tsx` — persistent status bar: block height, sync status, peer count, last updated time
  - `ConnectSection.tsx` — Gnockpit-style CONNECT card with click-to-copy seed address and app hash
  - `NodeStatePanel.tsx` — full node identity from `/status` (moniker, version, node-id, validator addr, pubkey, app hash, catching-up, node time)
  - `DoctorPanel.tsx` — diagnostic alerts derived from existing data: low peer count (<4 peers), unknown/closed peer RPCs, stuck consensus (round>1)
  - `ValidatorsHacker.tsx` — orchestrator page with 4 independent polling loops (consensus 2s, peers 15s, heatmap 30s, node status 60s), all via AbortController
  - `validators-hacker.css` — Hacker View page layout and overrides
  - "🕵️ Hacker view" link button added to standard `/validators` header (replaces old localStorage toggle)

- **🔍 Validator Detail Page** — new route `/validators/:address` (bech32 format)
  - Header card: rank badge (top-3 highlighted), moniker, `Active`/`Inactive`/`⚡ Proposer` badges
  - `⚡ Proposer` badge: live 2s consensus poll — pulses when validator is current block proposer
  - Stats grid: Voting Power, Network Share (with power bar), Proposer Priority, Start Time
  - Identity panel: bech32 address (copy), pubkey, pubkey type, Gnoweb profile link
  - Performance section: Signed/Missed/Uptime from per-validator block signatures (last 20 blocks)
  - 100-block network signing heatmap (25-column Gnockpit-style)
  - Graceful 404 card when address not in active validator set
  - External links: Gnoweb valopers → Hacker View → All Validators
  - `ValidatorDetail.tsx` + `validator-detail.css`

- **BlockHeatmap** refactored to Gnockpit style:
  - 25-column grid layout (was 20×5)
  - Signer count displayed inside each cell
  - Compact cell sizing

- **⚙️ validators.ts additions**
  - `NodeStatus` interface + `getNodeStatus()` fetcher — full node identity from `/status`
  - `getNetworkStats()` — added optional `signal?: AbortSignal` third parameter (all internal rpcCalls now threaded with signal)
  - `MAX_HACKER_BLOCKS = 100` constant

### Changed

- `Validators.tsx` (standard page): removed `HackerModeToggle` and all hacker-mode state/polling; replaced with `<Link className="val-hacker-btn">🕵️ Hacker view</Link>`
- Validator rows now clickable → navigate to `/validators/:address` with keyboard support (`tabIndex`, `role="button"`, `onKeyDown` Enter/Space)
- `validators.css` — added `.val-hacker-btn` and `.val-row` hover styles
- `App.tsx` — routes added: `/validators/hacker` (before `/:address` — order critical!)

### Architecture

- Two dedicated lazy-loaded pages (`ValidatorsHacker`, `ValidatorDetail`) — complete lifecycle isolation
- CSS namespaces: `hk-` (hacker cards), `hm-` (heatmap), `vd-` (validator detail), `val-` (standard) — zero collision
- All telemetry fetchers return `null` on failure — no crashes on restricted public RPCs
- `latestHeightRef` pattern used in heatmap interval (avoids nested-setState anti-pattern)
- Dual-RPC strategy: `getTelemetryRpcUrl()` prefers `VITE_SAMOURAI_SENTRY_RPC_URL`, falls back to `VITE_GNO_RPC_URL`
- Node identity panel correctly labels `/status` fields: `app hash` (not genesis sha256), `unknown` fallback for empty fields

### New Files

- `frontend/src/components/validators/ConnectSection.tsx`
- `frontend/src/components/validators/DoctorPanel.tsx`
- `frontend/src/components/validators/HackerStatusBar.tsx`
- `frontend/src/components/validators/NodeStatePanel.tsx`
- `frontend/src/pages/ValidatorsHacker.tsx`
- `frontend/src/pages/ValidatorDetail.tsx`
- `frontend/src/pages/validators-hacker.css`
- `frontend/src/pages/validator-detail.css`

### Security & Hardening

- `fetchBlockHeatmap` refactored to **chunked batching** (10 concurrent per round-trip) — prevents public RPC rate limiting
- `getTelemetryRpcUrl()` validates sentry URL against `TRUSTED_RPC_DOMAINS` before use — untrusted URLs fall back with `console.warn`
- `TRUSTED_RPC_DOMAINS` expanded: `samourai.live` (convention: `rpc.{chain}.samourai.live`), `p2p.team`, `gnoland1.io`, `localhost`
- CSP `connect-src` updated: `https://*.samourai.live` added to both `index.html` and `netlify.toml`
- `roundAge` computed from `rs.start_time` — enables DoctorPanel stuck-consensus detection (>30s)
- Dead code removed: `HackerModeToggle.tsx` + 48 lines orphaned CSS
- `.env.example` (root + frontend): `VITE_SAMOURAI_SENTRY_RPC_URL` documented with samourai.live convention
- `docker-compose.yml`: `VITE_SAMOURAI_SENTRY_RPC_URL` forwarded as frontend build arg

### Deleted Files

- `frontend/src/components/validators/HackerModeToggle.tsx` (replaced by Link button)

### Tests

- **771 unit tests** (35 files, +15 new: formatRelativeTime, BlockSample, samourai.live domain trust, getTelemetryRpcUrl fallback)
- `tsc --noEmit` 0 errors

---

## v2.13.1 (2026-03-17)

### Bug Fixes & Performance

- **fix(frontend): correct vote participation metrics for non-connected users** — PR [#119](https://github.com/samouraiworld/memba/pull/119)
  - Extracted `getDAOConfig()` into wallet-independent `useEffect` in `ProposalView.tsx`
  - Fixed "13 of 0 voted / 0%" bug for non-connected users
- **perf(frontend): prevent token refetch on wallet connect** — PR [#120](https://github.com/samouraiworld/memba/pull/120)
  - Split `fetchData` → `fetchTokenInfo` + balance effect in `TokenView.tsx`
  - Split `fetchTokens` → `fetchTokenList` + balance effect in `TokenDashboard.tsx`
  - Eliminates O(N) redundant ABCI queries and loading flashes on wallet connect

### Chain Compatibility

- **feat(frontend): add gnoland1 and testnet12 chain support** — PR [#121](https://github.com/samouraiworld/memba/pull/121) (open, deferred)
  - Added `gnoland1` (experimental pre-betanet) and `test12` to `NETWORKS`, `TRUSTED_RPC_DOMAINS`, `getExplorerBaseUrl()`, `GNOSWAP_PATHS`
  - Updated config tests for 6 networks

### Dependency Updates

- `golang.org/x/net` 0.51.0 → 0.52.0 (security) — PR [#107](https://github.com/samouraiworld/memba/pull/107)
- `modernc.org/sqlite` 1.46.1 → 1.46.2 (patch) — PR [#122](https://github.com/samouraiworld/memba/pull/122)
- `typescript-eslint` 8.57.0 → 8.57.1 (patch) — PR [#118](https://github.com/samouraiworld/memba/pull/118)
- `@types/node` 25.4.0 → 25.5.0 (types) — PR [#109](https://github.com/samouraiworld/memba/pull/109)
- `vitest` 4.0.18 → 4.1.0 (minor) — PR [#117](https://github.com/samouraiworld/memba/pull/117)
- `@sentry/react` 10.42.0 → 10.43.0 (minor) — PR [#116](https://github.com/samouraiworld/memba/pull/116)

### Maintenance

- Closed 6 Dependabot PRs (Vite 8 major, jsdom 29 major, plugin-react 6 major, 3× Remotion split PRs)
- Pruned 6 stale local branches + 15 stale remote tracking refs
- Updated README chain table (6 networks), network selector description
- Wallet-gated data pattern audit: 12 pages reviewed, 2 bugs found and fixed, 14-perspective deep audits (3x)

---

## v2.13.0 (2026-03-10)

### v2.13 Deep Audit (2026-03-10) — PR #100

- **🎙️ Jitsi PiP** — single-iframe architecture, fixes black screen on navigate
  - `JitsiPiPOverlay.tsx` rewritten: `appendTo` → `insertBefore` for correct DOM position
  - Fixed drag handle scope to header only (was capturing entire overlay)
  - Expand button now replaces PiP with full modal (previously opened duplicate)
- **⚡ Inline EXECUTE Badges** — replaced standalone "Awaiting Execution" section with inline `⚡ EXECUTE` badge on passed ProposalCards
- **🔔 Notification Events** — `proposal_passed` and `proposal_failed` status tracking in `useNotifications`
  - RPC throttle guard (`MIN_POLL_MS = 5000ms`) prevents excessive ABCI queries
- **🏷️ Validator Monikers** — on-chain `valopers` Render parsing replaces blocked gnomonitoring CORS
  - `getValidatorMonikers()` via ABCI `vm/qrender` on `r/gnoland/valopers`
- **🔗 Directory URLs** — fixed testnet URLs (was pointing to non-existent paths)
- **🎨 ConnectingLoader** — consistent usage across Validators and DAOHome
- **📦 Proposal Action Metadata** — new card on ProposalView showing `actionType`, `actionBody`, `executorRealm`
  - Parses both GovDAO v3 and basedao on-chain formats
- **🏷️ Category Badge** — proposal category displayed in header (was parsed but not rendered)
- **🧪 E2E Fix** — updated `dao.spec.ts` for inline EXECUTE badge + Playwright strict mode `.first()`
- **12 files changed, 396 insertions, 143 deletions**

### v2.12 Hardening (2026-03-10) — PRs #96, #98, #99

- **🧪 E2E Expansion** — 142 E2E tests, proposal export plugin, RPC session cache — PR #96
- **🔗 Slug Canonicalization** — `encodedSlug` consistency in Room components + proposal status mapping verification — PR #98
- **🔒 Tier 1 Security Audit** — quality, maintenance fixes + critical Jitsi modal CSS regression fix — PR #99

### v2.12 DAO Rooms, Proposals & Health Score (2026-03-10) — PR #94

- **🔊 DAO Rooms Visibility** — restored Audio/Video rooms in DAO header card
  - Two-column layout: stats + donut (left), Discord-style channel sidebar (right)
  - Direct-access voice/text channels with live session indicator
- **📜 Proposal Pagination** — GovDAO `Render("")` is paginated (5/page); now fetches ALL pages
  - `detectMaxPage()` parses footer links, parallel fetch, dedup, sort
  - GovDAO: 5 → 13 proposals now visible
- **🏥 DAO Health Score** — composite grade (A/B/C/D) based on:
  - Voter participation (0–40 pts), execution backlog (0–30 pts), activity (0–30 pts)
  - Colored badge in stat grid with detailed tooltip
- **🔗 Slug Encoding Hardening** — fixed raw `slug` in `navigate()` across 6 DAO pages
  - Prevents 404 when user enters via `%2F`-encoded URLs
  - Affected: DAOHome, ProposalView, DAOMembers, Treasury, TreasuryProposal, ProposeDAO
- **🪄 Other Fixes:**
  - Vote enrichment broadened to `open` + `passed` proposals
  - Clipboard catch no longer shows false "Copied!" on failure
  - Voice room session comparison uses `encodedSlug` consistently
  - Non-voters metric corrected (was 100%, now 24% for GovDAO)
  - Proposals tooltip includes passed count

### v2.11 Live ABCI Stats (2026-03-09)

- **📊 Live Network Stats** — real-time on-chain data on landing page for non-connected visitors
  - Block height, avg block time, active validators, chain ID
  - 30s polling with Page Visibility API (pauses when tab hidden)
  - Graceful fallback — hides section if RPC unreachable
  - Reuses existing `getNetworkStats()` from `validators.ts`

### v2.10.1 Creative Landing (2026-03-09) — PR #86

- **🎬 Remotion Feature Previews** — 6 animated compositions on landing page
  - `TokenFactory` — CreateToken form + DeploymentPipeline 4-step flow
  - `DAOGovernance` — ProposalCard + SingleVoteBar with real vote split
  - `MultisigFlow` — signer list, SIGNED badges, threshold + broadcast
  - `CommandPalette` — Cmd+K with real command section grouping
  - `ValidatorDash` — stat grid + power bar + validator table
  - `VoiceChannel` — DAORooms channel sidebar + Jitsi participant grid
- **Hero styling** — white title on two lines, gno.land hyperlink
- **Dedicated `landing.css`** — extracted from inline, uses Kodera tokens
- **Dependencies** — `remotion`, `@remotion/player`, `@remotion/cli`

### v2.10 Portal PiP — Persistent Jitsi Sessions (2026-03-09) — PR #84

- **🎙️ Portal-based PiP** — Jitsi voice/video sessions survive route navigation
  - `JitsiContext.tsx` — session state lifted above `<Outlet>` in Layout
  - `JitsiPiPOverlay.tsx` — expanded modal + draggable PiP mini-player (320×180)
  - Pointer-based drag (touch + mouse), `touch-action: none` for mobile
  - Single active session — joining new room replaces old
- **DAORooms rewrite** — delegates to JitsiContext, active room indicators (green dot + "In call" hint)
- **JitsiMeet simplified** — join gate only + "In Call" status with expand/leave controls
- **13 unit tests rewritten** for context-based API

### v2.10 Audit Bug Fixes (2026-03-09) — PR #83

- **BUG-02** Channels uint64 parse error — removed `initialChannel="OpenDiscussions"`, defensive guard in `BoardView`
- **BUG-03** Feedback page 404 — created `FeedbackPage.tsx` with GitHub Issues integration + betanet preview
- **BUG-04** Notification routing — fixed `encodeSlug()` for multi-segment realm paths + unread red-dot on DAO cards
- **BUG-05** Modal auto-scroll — `useScrollToTop` hook applied to DAORooms, DeploymentPipeline
- **BUG-06** Loading animation — unified `ConnectingLoader` (72→94px), `message` + `minHeight` props
- **BUG-07** Page scroll reset — `ScrollToTop.tsx` component with hash link exception
- **BUG-08** GRC20 amounts — verified correct on-chain (NOT A BUG)
- **BUG-09** DAO overview — compact "Live Coordination" area with inline room join buttons
- **BUG-10** Validator monikers — ops-only (CORS + PR merge), no code needed
- **BUG-11** Leaderboard — wired to DAO members via `getDAOMembers()`, rank badges (🥇🥈🥉), gnolove link

### v2.9.3 Directory Expansion (2026-03-09) — PR #82

- **📦 Packages Tab** — 15 well-known gno.land packages (GRC20, GRC721, AVL Tree, DAO, Ownable, ufmt…)
  - Search by name/path/description, responsive grid, external gno.land links
- **🌐 Realms Tab** — 11 well-known deployed realms + user's saved DAOs (deduplicated)
  - Category filter pills (standard / defi / social / utility), colored badges
- **Data Layer** — `DirectoryPackage`, `DirectoryRealm` types, `fetchPackages()`, `fetchRealms()`
- **14 new unit tests** — field types, deduplication, paths, data integrity
- **Total tests: 754** (was 740)

### v2.9.2 Production Bug Fixes (2026-03-09) — PR #81

- **B6 🔴 DAO Creation** — `gnomod.toml` uses `module` instead of `pkgpath` (3 template files)
- **B7 🔴 Username Registration** — added `200000ugnot` fee, fixed regex to `^[a-z][a-z0-9_]{5,16}$`, updated placeholder/hint
- **B1 🔴 Hidden Account Overlay** — wrapped `MobileTabBar` in `k-mobile-only` container (hidden on desktop)
- **B5 🟡 Home/Dashboard Dedup** — `/` redirects to `/dashboard` when connected, Home link hidden in sidebar
- **B3 🟡 Awaiting Execution** — new "⚡ Awaiting Execution" section in DAOHome for `status === "passed"` proposals
- **B4 🟡 Jitsi PiP + Fullscreen** — minimize to floating 320×180 window, native fullscreen API, 3-button toolbar
- **CI Fix** — Go version `stable`, ESLint react-hooks/rules-of-hooks fix

#### Phase 1: Critical UX
- **Footer Socials Restored** — 7-icon social array (X, Instagram, YouTube, GitHub, LinkedIn, Telegram, Email)
  - Map-based rendering with hover color transitions (`#00d4aa`)
  - Removed unused `Envelope` import from `@phosphor-icons/react`
- **DeploymentPipeline Modal Overlay** — converted from inline card to full-screen modal
  - Dark backdrop (`rgba(0,0,0,0.7)`) with `backdrop-filter: blur(4px)`
  - ESC key to close, click-outside to dismiss (only when complete/error)
  - Body scroll lock when active, `z-index: 1000`
  - CSS animations: `overlayFadeIn` + `modalSlideIn`
  - 4 new unit tests (overlay, scroll lock, click-outside, non-dismissible guard)

#### Phase 2b: Default Audio/Video Rooms
- **DAORooms Component** — instant-access voice/video rooms for ALL DAOs (no channel realm required)
  - `🔊 Public Room` — visible to everyone (guests + members), open to join
  - `🔒 Members Room` — visible only to DAO members in the UI ("kind of private")
  - Modal overlay with Jitsi embed, ESC/click-outside close, body scroll lock
  - "Manage channels →" link appears when full Channels feature is deployed
  - `dao-rooms.css` — glassmorphism buttons, hover glow, responsive (mobile column layout)
- **JaaS Integration** — lobby-free rooms via 8x8.vc (free tier, 25 concurrent users)
  - `VITE_JAAS_APP_ID` env var configures JaaS; fallback to `meet.jit.si` when empty
  - CSP `frame-src` updated for both `meet.jit.si` and `8x8.vc`
- **Deterministic Room Hash** — 5-char djb2 hash suffix appended to room names
  - Format: `memba-{slug}-{channel}-{hash}` — unpredictable but reproducible per DAO
  - Prevents room name guessing from slug alone
- **JitsiMeet Enhanced** — `label`, `description` props + `jitsiIframeSrc()` URL builder

#### Phase 3: Tech Debt
- **BoardView Decomposition** — 676 LOC → 5 sub-components + orchestrator (~260 LOC)
  - `BoardHeader.tsx` (~50 LOC) — channel navigation header
  - `ThreadList.tsx` (~80 LOC) — thread listing with unread indicators
  - `ThreadView.tsx` (~130 LOC) — thread detail + replies + reply form
  - `ComposeThread.tsx` (~90 LOC) — new thread creation form
  - `boardHelpers.tsx` (~115 LOC) — renderMarkdown, visit tracking, shared styles
- **CSP Dual-Config Sync** — `index.html` + `netlify.toml` now have matching `connect-src` domains
  - Added sync documentation comments in both files
  - Aligned missing domains: `memba-backend.fly.dev`, `api.github.com`, `gnolove.world`, `*.testnets.gno.land`
- **3 New E2E Specs** — `extensions.spec.ts`, `cmd-k.spec.ts`, `channels.spec.ts`

#### Scope Notes
- **JitsiMeet**: Already wired into BoardView (L397-418) — no work needed
- **MultisigHub**: Already fully implemented (189 LOC) — no work needed
- **validators.spec.ts** (131 LOC) + **directory.spec.ts** (170 LOC): Already existed

#### New Files
- `components/dao/DAORooms.tsx` (145 LOC) — default public + private rooms
- `components/dao/dao-rooms.css` (130 LOC) — room card + modal styles
- `components/dao/DAORooms.test.tsx` (100 LOC) — 11 unit tests
- `plugins/board/boardHelpers.tsx` (115 LOC)
- `plugins/board/BoardHeader.tsx` (50 LOC)
- `plugins/board/ThreadList.tsx` (80 LOC)
- `plugins/board/ThreadView.tsx` (130 LOC)
- `plugins/board/ComposeThread.tsx` (90 LOC)
- `e2e/extensions.spec.ts` (82 LOC)
- `e2e/cmd-k.spec.ts` (82 LOC)
- `e2e/channels.spec.ts` (72 LOC)

#### Tests
- **738 unit tests** (35 files, +20), tsc 0, lint 0, build 457KB (131KB gzip)

### Monitoring API Integration & GovDAO Polish (2026-03-08)

> Branch: `dev/v2` — Session: monitoring API deep dive + UI polish

#### Added
- **Monitoring API Integration** — validator monikers, participation rate, uptime from gnomonitoring
  - `gnomonitoring.ts` (197 LOC) — API client with 30s session cache, 5s timeout, graceful degradation
  - `hexToBech32()` in `realmAddress.ts` — converts Tendermint hex addresses to `g1...` bech32
  - Enriched `Validators.tsx` with Moniker, Participation, Uptime columns + search by moniker/address
  - CSP updated for `monitoring.gnolove.world`
  - `.env.example` updated with `VITE_GNO_MONITORING_API_URL`
- **MultisigHub Page** — new `/multisig` route for multisig management hub
  - `MultisigHub.tsx` + `multisig-hub.css` — sidebar nav + Cmd+K integration
- **GovDAO UI Polish** — realm address badge (purple → grey + CSS hover), `.k-stat-card` / `.k-stat-grid` CSS classes, shortened description

#### Fixed
- **Critical: Address matching bug** — `mergeWithMonitoringData()` tried hex vs bech32 comparison (never matched). Now derives bech32 from hex via `hexToBech32()` + direct map lookup
- **Active Validators card showing 0** — `getNetworkStats()` made redundant RPC call instead of using `prefetchedValidators.length`

#### External
- **gnomonitoring PR [#60](https://github.com/samouraiworld/gnomonitoring/pull/60)** — multi-origin CORS support (comma-separated `allow_origin`). Blocked on merge + VPS config update by Lours.

#### New Files
- `gnomonitoring.ts` (197 LOC) — monitoring API client
- `MultisigHub.tsx` + `multisig-hub.css` — multisig hub page

---

### v2.6 Hardening & OSS Prep (2026-03-08)

> Branch: `dev/v2` — 12 commits

#### Fixed
- **Critical: Board deploy failure on test11** — `import "std"` → `import "chain/runtime"` in all 4 realm templates
  - `boardTemplate.ts`, `channelTemplate.ts`, `candidatureTemplate.ts`: `std.Address` → `address`, `std.GetOrigCaller()` → `runtime.PreviousRealm().Address()`
  - `daoTemplate.ts`: `gnomod.toml` field from `module` → `pkgpath`
- **Hardcoded gas values** — `CreateDAO.tsx`, `DeployPluginModal.tsx`, `grc20.ts` now use shared `getGasConfig()` from user settings

#### Added
- **Cmd+K Command Palette** — 14 navigation commands, fuzzy search, keyboard navigation (arrow keys + enter + esc)
  - `CommandPalette.tsx` + `commands.ts` + `command-palette.css` (dark glassmorphism)
  - Wired into `Layout.tsx` — available on all pages
  - Includes Extensions, Feedback, and all core pages
- **User-Friendly Error Messages** — `errorMessages.ts` with 20+ patterns
  - Translates ABCI, Adena, and network errors into readable messages
  - `friendlyError()`, `extractMessage()`, `isUserCancellation()` exports
- **Shared Gas Configuration** — `gasConfig.ts` reads user settings from localStorage
  - `getGasConfig()` returns `{ fee, wanted, deployWanted }` with safe defaults
  - Deploy multiplier: 5× regular gas for realm deployment transactions
- **Transaction Retry** — `doContractBroadcast()` retries transient failures up to 2×
  - Exponential backoff (1s, 2s)
  - Smart skip: never retries user cancellations or deterministic chain errors

#### Security
- **Content-Security-Policy** meta tag in `index.html`
  - Restricts script, style, connect, and frame origins

#### New Files
- `errorMessages.ts` (168 LOC) + `errorMessages.test.ts` (120 LOC) — 26 tests
- `CommandPalette.tsx` (130 LOC) + `commands.ts` (43 LOC) + `command-palette.css` (140 LOC)
- `gasConfig.ts` (52 LOC) + `gasConfig.test.ts` (60 LOC) — 5 tests
- `v2.6-hardening/BRIEF.md` + `v2.6-hardening/IMPLEMENTATION.md`

#### Tests
- **718 unit tests** (34 files, +31), **238 E2E**, tsc 0, lint 0, build 450KB

#### User Testing Fixes (same session)
- **Faucet Card Redesign** — renamed "Get started with 3 GNOT" → "Get Free Test Tokens"
  - Added TESTNET ONLY badge, dismiss × button (localStorage), updated copy
- **Extensions Hub** — new `/extensions` page with 4 extension cards (2 Active, 2 Coming Soon)
  - Replaces 4 individual plugin sidebar links → single "Extensions" link
- **Dashboard Graceful Degradation** — suppress "Connection failed" toast when backend API is unreachable
  - Network errors silently logged, on-chain features still work
- **E2E Test Fix** — updated sidebar test after Plugins → Extensions rename

---

### v2.5c Audio/Video Channels (2026-03-08)

> Branch: `feat/v2.5a/channel-pages` (continued)

#### Added
- **Voice & Video Channel Types** — `ChannelType` extended with `"voice"` and `"video"`
  - Channel icons: 🔊 voice, 🎥 video (shared `channelIcon()` helper)
  - Parser recognises 🔊/🎥 type indicators from on-chain Render output
- **Jitsi Meet Integration** — `JitsiMeet` component embeds Jitsi iframe
  - "Join Room" gate — click to connect (no auto-join)
  - Deterministic room names: `memba-{slug}-{channel}` (scoped, URL-safe)
  - Voice mode: camera off by default; Video mode: camera on
  - Sandbox + referrerPolicy hardening on iframe
  - "Leave Room" button with red overlay
- **BoardView Voice/Video Rendering** — voice/video channels render Jitsi instead of threads
  - No "New Thread" button for voice/video channels

#### New Files
- `components/ui/JitsiMeet.tsx` (150 LOC) — Jitsi iframe + join gate
- `components/ui/jitsiHelpers.ts` (18 LOC) — `jitsiRoomName()` + domain constant
- `components/ui/JitsiMeet.test.ts` (32 LOC) — 5 unit tests
- `docs/planning/milestones/v2.5c-audiovideo/BRIEF.md`

#### Tests
- **684 unit tests** (32 files, +7), 119 E2E, tsc 0, lint 0, build 450KB

---

### v2.5b Real-time UX (2026-03-08)

> Branch: `feat/v2.5a/channel-pages` (continued)

#### Added
- **Channel Polling** — `useChannelPolling` hook with 10s interval for thread/reply updates
  - Page Visibility API: pauses when tab is hidden (saves bandwidth)
  - Typing guard: pauses when user is composing (avoids content jump)
  - In-flight dedup: no concurrent ABCI queries
  - New content detection: compares thread/reply counts between polls
- **"New Messages" Toast** — `NewMessagesToast` component (teal-themed, auto-dismiss 8s)
  - Rendered in both channel list and thread detail views
  - Click to dismiss, slide-up animation
- **BoardView Refactor** — replaced manual `loadChannel`/`loadThread` with polling hook
  - `formError` state split for post validation (isolated from poll state)
  - `refresh()` called after post/reply for immediate content update

#### New Files
- `hooks/useChannelPolling.ts` (160 LOC) — polling hook
- `hooks/useChannelPolling.test.ts` (24 LOC) — 3 unit tests
- `components/ui/NewMessagesToast.tsx` (80 LOC) — toast component

#### Tests
- **677 unit tests** (31 files, +3), 119 E2E, tsc 0, lint 0, build 450KB

---

### v2.5a Channel Pages (2026-03-08)

> Branch: `feat/v2.5a/channel-pages`

#### Added
- **Standalone Channel Page** — `/dao/:slug/channels` route with full-page layout
  - Left sidebar (220px) with channel list, type icons (💬/📢/🔒), active highlight, archived badges
  - Breadcrumb navigation (DAOs › DaoName › Channels) with clickable links
  - Deep-link support: `/dao/:slug/channels/:channel` opens specific channel
  - Mobile responsive: sidebar collapses below 768px with toggle button
- **BoardView Headless Mode** — 3 new optional props (`initialChannel`, `onChannelChange`, `hideChannelList`) for external control
- **DAOHome Channels Card** — 💬 icon + "Open →" entry point, positioned before Treasury

#### New Files
- `pages/ChannelsPage.tsx` (223 LOC) — channel page with sidebar + BoardView integration
- `pages/channelHelpers.ts` (24 LOC) — `channelIcon()` + `defaultChannel()` helpers
- `pages/channels.css` (200 LOC) — responsive layout, empty/loading states
- `pages/channels.test.ts` (75 LOC) — 9 unit tests for helpers

#### Tests
- **674 unit tests** (30 files, +9), 119 E2E, tsc 0, lint 0, build 450KB

---

### v2.2c Quick Wins (2026-03-08)

> Branch: `feat/v2.2c-quick-wins` — PR #78

#### Added
- **Sidebar Notification Badges** — `notifUnreadCount` prop on Sidebar, DAOs nav badge shows combined (unvoted + unread)
- **IPFS Avatars in Directory** — `batchFetchUserAvatars()` via gnolove API, sessionStorage cache, `resolveAvatarUrl()` rendering
- **Typed BankMsgSend** — `BankMsgSend` interface replaces untyped `object` return on `buildFaucetMsgSend()`
- **DirectoryUser avatarUrl** — optional `avatarUrl` field on `DirectoryUser` interface

#### Tests
- **665+ unit tests**, tsc 0, lint 0, build 449KB

---

### v2.2b Directory Enrichment (2026-03-08)

> Branch: `feat/v2.2b-enrichment` — 4 commits

#### Added
- **DAO Category Tags** — `getDAOCategory()` heuristic (6 categories: governance, community, treasury, defi, infrastructure, unknown), colored badges with `dir-inline-badge` shared CSS
- **User Avatar Enhancement** — gradient CSS avatars with first-letter placeholder, `img` support for future IPFS
- **Contribution Scores** — `calculateContributionScores()` cross-references DAO membership, activity badges (⭐ active / 🔹 moderate / 🔸 newcomer)
- **DAO Auto-Discovery** — `discoverDAOs()` ABCI probe, `addDiscoveryProbe()` extensible API, sessionStorage cache
- **Per-DAO Notification View** — `getNotificationsForDAO()`, `getUnreadCountForDAO()`, `getDAOUnreadCount` hook callback

#### Fixed (Deep Review)
- I1: O(n×m) → Set-indexed O(1) scoring lookup
- I2: Hardcoded discovery probes → `addDiscoveryProbe()` + `getDiscoveryProbes()` API
- I3: Category false positives → word-boundary regex (`wordMatch()` helper)
- M1-M4: CSS dedup, hook cache, naming, E2E assertions

#### Tests
- 29 new tests (unit + E2E category badge assertions)
- **665+ unit tests**, tsc 0, lint 0, build 449KB

---

### v2.2a Intelligence & Directory — Phase 1 (2026-03-08)

> Branch: `feat/v2.2a-directory` — PR #76

#### Added
- **Organization Directory** — transformed basic list into premium Organization Hub
  - `lib/directory.ts` — centralized data layer with sessionStorage cache (5-min TTL)
  - `lib/daoMetadata.ts` — DAO Render parser (member count, proposal count, description) with `Promise.allSettled` batch fetch (max 10 concurrent)
  - `components/directory/DAOCard.tsx` — rich card with metadata, save-to-Memba button, status badges
  - `components/directory/FeaturedDAOs.tsx` — curated carousel with Render metadata
  - `pages/directory.css` — premium glassmorphism (330 LOC), responsive grid
  - Refactored `Directory.tsx` — all inline styles → CSS classes, data layer, `useMemo` filtering, ARIA tabs (`role=tab`, `aria-selected`)

#### Tests
- 24 new unit tests (`daoMetadata.test.ts`, `directory.test.ts`)
- 13 E2E tests (`e2e/directory.spec.ts` — tabs, search, cards, mobile)
- **636+ unit tests**, tsc 0, lint 0, build clean

---

### v2.1b Validators & Notifications (2026-03-08)

> Branch: `feat/v2.1b-validators-notifications` — 8 commits, 84+ new tests

#### Phase 2 Audit Hardening (7 findings)
- **C1**: Stale eligibility memo → `claimVersion` counter forces `useMemo` recalculation
- **C2**: `daoPaths` callback instability → `useRef` for stable references
- **I1**: Hardcoded faucet URL → `faucetUrl` in `NETWORKS` config (multi-chain)
- **I2**: Duplicated cooldown reason → separated description and timer text
- **I3**: Filter/sort recomputed every render → `useMemo` with proper deps
- **I4**: Pagination not keyboard-accessible → `aria-label` + `aria-live` region
- **M1**: Sequential DAO polling → `Promise.allSettled` parallel (max 5/cycle)
- **Bundle**: `manualChunks` — vendor-react (41KB), vendor-ui (99KB), vendor-sentry (18KB)
  - index.js: 568KB → 449KB (**-21%**)
- **E2E**: `e2e/validators.spec.ts` (10 tests)


#### Added
- **Notification Center** — bell icon in header with unread badge, dropdown panel grouped by date (Today/Yesterday/This Week/Older), 30s ABCI polling for new proposals, Page Visibility API (pauses when tab hidden), per-wallet localStorage isolation, XSS sanitization
  - `lib/notifications.ts` — data layer (CRUD, sanitization, grouping, dedup with monotonic counter)
  - `hooks/useNotifications.ts` — polling hook with optional daoPath (null = sync-only)
  - `components/layout/NotificationBell.tsx` — ARIA-accessible dropdown (aria-expanded, role=menu, focus return)
- **Validator Dashboard** — `/validators` page with premium dark UI
  - Network stats cards (block height, avg block time, validator count, total voting power) with 30s auto-refresh
  - Voting power distribution bar and sortable table (rank/power/share) with rank badges for top 3
  - `lib/validators.ts` — Tendermint RPC data layer with AbortSignal support and prefetched validator optimization
  - Page Visibility API, "Refreshing…" pulse indicator, `document.title` update
- **Gasless Onboarding (Phase 1)** — faucet eligibility data layer
  - 7-day cooldown with per-address localStorage keys
  - `MsgSend` builder for treasury transfer (signing is deployment concern)
- **Sidebar nav** — Validators link with chain icon
- **Faucet Claim UI** — Dashboard card with eligibility check, cooldown timer, external faucet link (Phase 2)
  - `FaucetCard.tsx` — premium glassmorphism card, mobile responsive
  - Shown when wallet connected + eligible (hides after claim or during cooldown)
- **Multi-DAO Notification Polling** — refactored `useNotifications` from `daoPath: string | null` to `daoPaths: string[]`
  - Layout polls all saved DAOs (max 5/cycle), per-DAO tracking via `lastKnownCounts` Map
  - Bell icon aggregates notifications from all saved DAOs
- **Validator Pagination** — auto-paginate `getValidators()` for >100 validators (parallel page fetch)
  - Client-side page controls: page size selector (25/50/100), prev/next buttons, "Showing X-Y of Z"

#### Fixed (Dual-Round Audit — 15 items)
- **C2**: Validator polling 5s→30s + Page Visibility API (was 48 RPCs/min)
- **C3**: Notifications no longer hardcode single DAO (daoPath optional)
- **I6**: Notification dedup race fixed with monotonic `_idCounter`
- **I7**: Eliminated redundant `getValidators()` call in `getNetworkStats()`
- **I8**: ARIA accessibility — `aria-expanded`, `role=menu`, focus return to bell
- **I9**: Faucet per-address storage (prevents FIFO cooldown bypass)
- **M10**: `useMemo` for `groupNotifications` (only when panel open)

#### Tests
- 415 unit tests (21 files), all quality gates pass (tsc 0, lint 0)

### v2.1a — Community Foundation (2026-03-07)

#### Added
- **Channel Realm v2** (`channelTemplate.ts`) — Discord-like DAO channels with role-based ACL, token-gated writes, threads/replies, rate limiting, admin actions (create/archive/reorder channels, edit/delete messages), @mention support
  - Backward compatible: `detectChannelRealm()` supports both `_channels` (v2) and `_board` (v1) suffixes
  - `BoardView.tsx` upgraded with inline Markdown renderer, channel sidebar, type indicators (📢/🔒/💬)
- **$MEMBA GRC20 Token** (`config.ts`, `grc20.ts`) — `$MEMBATEST` (dev) / `$MEMBA` (prod) token with 10M supply, 40/30/20/10% allocation
  - Platform fee reduced from 5% → 2.5%
  - `buildCreateMembaTokenMsgs()`, `getMembaBalance()`, `formatTokenAmount()` helpers
- **MembaDAO Candidature Flow** (`candidatureTemplate.ts`) — Gno realm for membership applications
  - Public submission (name, philosophy, skills), two-member approval, admin rejection
  - Increasing re-candidature cost: 10 GNOT × past rejections (anti-spam)
  - Self-approval guard: applicants cannot approve their own candidature
  - Render path filtering: `Render("pending")`, `Render("approved")`, `Render("rejected")`
  - `getCandidatureSendAmount()`, `RECANDIDATURE_COST_UGNOT` helpers
- **IPFS Avatars** (`ipfs.ts`, `AvatarUploader.tsx`) — Lighthouse REST API upload with preprocessing
  - Auto-resize to 256×256 WebP (≤512KB), MIME validation, CID validation
  - Saves canonical `ipfs://` URI (gateway-agnostic) via `resolveAvatarUrl()`
- **MembaDAO Bootstrap** (`membaDAO.ts`) — DAO config, deployment orchestrator, status checker
  - ABCI-based deployment verification (DAO, channels, candidature, token realms)
  - `isMembaDAOMember()`, `getDeploymentSteps()`, `buildAddMemberMsg()`

#### Changed
- **`FEE_RECIPIENT`** corrected to Samouraï Coop multisig (`g1pavqfezrge9kgkrkrahqm982yhw5j45v0zw27v`)
- **`GRC20_FACTORY_PATH`** re-export in `grc20.ts` marked `@deprecated` (import from `config.ts`)
- **`MEMBA_CHANNELS`** renamed to `MEMBA_CHANNEL_DEFS` in `channelTemplate.ts` (resolves naming collision with `membaDAO.ts`)
- **`toAdenaMessages()`** now validates msg type, throws on non-MsgCall messages

#### Security
- Skills length validation added to generated Gno candidature code (on-chain enforcement)
- Self-approval guard prevents applicants from being their own approvers
- Re-candidature cost deters spam re-applications after rejection
- `toAdenaMessages()` type guard prevents silent MsgAddPackage corruption

#### Tests
- 529 unit tests (22 files, +169 from 360 baseline), all quality gates pass (tsc 0, lint 0, build clean)
- 5-round deep audit: 23 findings total, 15 fixed, 5 deferred (low priority), 3 notes

### v2.0-θ UX Polish & Layout Fixes (2026-03-07)

#### Fixed
- **Sidebar scroll** — switched from `position: sticky` to `position: fixed`; sidebar is now viewport-locked and never scrolls with page content
- **Logo alignment** — added `margin: 0 8px` to sidebar header to match nav link offset (was 8px misaligned); logo increased from 24px to 30px
- **Footer visibility** — bottom padding increased from 32px to 80px to prevent Netlify deploy preview toolbar from obscuring content
- **ConnectingLoader** — removed dashed border container and green background; logo increased from 32px to 72px for clean brand presence

#### Changed
- **Phosphor icon migration** — migrated 30+ remaining emojis to `@phosphor-icons/react` SVGs across 10 page files (Dashboard, DAOList, DAOHome, ProposalView, ProposeDAO, CreateDAO, TokenView, ImportMultisig, TransactionView, UserRedirect)
- **Layout architecture** — app layout changed from CSS Grid to Flexbox with `margin-left` compensation for fixed sidebar
- **MobileTabBar** — `TABS` array refactored to data-only `TAB_DEFS` with Icon component references
- **LayoutContext** — added `syncTimedOut` boolean to context + Outlet
- **Disabled plugins** — BottomSheet closes on tap + shows inline "Select a DAO" hint
- **JSDoc** — added to `WizardStepPreset` component

#### Tests
- 360 unit tests (18 files), 93 E2E tests, all quality gates pass (tsc 0, lint 0, build clean)
- E2E: updated 8 emoji-based selectors in `dao.spec.ts` and `smoke.spec.ts`

### v2.0-η UX Audit Sprint (2026-03-07)

#### Fixed
- **P0: ConnectingLoader gate** — `Layout.tsx` no longer blocks all page content during wallet sync; `<Outlet>` always renders
  - `isLoggingIn` passed via `LayoutContext` → page-level guards in `Dashboard.tsx` + `ProfilePage.tsx`
  - 10s syncing timeout with "Sync timeout — Retry" recovery UI in `TopBar.tsx`
- **Plugin sidebar routes** — links now route to `/dao/{lastVisitedDAO}/plugin/{id}` instead of dead `/plugins/{id}`
  - Disabled state with "Select a DAO first" tooltip when no DAO visited
  - `memba_last_dao_slug` persisted to localStorage on DAO visit
- **Footer bugs** — text contrast `#333`→`#666` / `#444`→`#555`, `&amp;` entity → `&`, `z-index: 1` prevents overlay bleed

#### Changed
- **Phosphor Icons** — all navigation emoji icons replaced with `@phosphor-icons/react` SVGs
  - `Sidebar.tsx` — House, ChartBar, Buildings, Coins, FolderOpen, Briefcase, User, Gear, Megaphone, PuzzlePiece
  - `MobileTabBar.tsx` — matching Phosphor icons + DotsThree for "More" tab
  - `Settings.tsx` — Globe, FolderOpen, GasPump, User, Wrench, Gear section icons
  - `Layout.tsx` footer — Envelope icon
  - `WizardStepPreset.tsx` — House, UsersThree, Vault, Buildings for DAO presets
- **`<main>` inline styles** moved to `.k-main` CSS class (`index.css`)

#### Accessibility
- `ConnectingLoader` — added `role="status"` + `aria-live="polite"` for screen reader announcements
- DAO tier badge — added `title` tooltip with role and voting power context
- Disabled sidebar links — `aria-disabled="true"` + `cursor: not-allowed`

#### Tests
- 360 unit tests (18 files), all quality gates pass (tsc 0, lint 0, build clean)

### v2.0-ζ Sidebar Navigation + Sentry (2026-03-07)

#### Added
- **Sidebar Navigation** — Vercel-inspired 3-section sidebar (Navigation, Plugins, User)
  - `Sidebar.tsx` — Home/Dashboard/DAOs/Tokens/Directory/Multisig links, plugin list, Profile/Settings/Feedback pinned at bottom
  - `TopBar.tsx` — Alpha/v2 badges, network selector, wallet status, security banners (auth error, chain mismatch, untrusted RPC)
  - `MobileTabBar.tsx` — 5-tab bottom navigation (Home, DAOs, Tokens, Directory, More)
  - `BottomSheet.tsx` — Slide-up modal with focus trap, Escape to close, body scroll lock
  - Skip-to-content accessibility link (focus-only)
  - Sidebar collapse toggle with localStorage persistence
- **Sentry Integration** — Error monitoring for self-hosted Sentry (`sentry.samourai.pro`)
  - `Sentry.init` in `main.tsx` with PII scrubbing (wallet addresses redacted via `beforeSend`)
  - Browser tracing (20% sample rate in production, 100% in dev)
  - Error forwarding from `errorLog.ts` → `Sentry.captureException` (critical/error only)
  - Vite plugin for source map upload (`sentryVitePlugin` in `vite.config.ts`)
  - Source maps deleted from `dist/` after upload
- **Betanet Network Config** — `betanet` added to `NETWORKS` with `gno.land/r/sys/users` registry
- **`getUserRegistryPath()`** — Abstracted user registry path (H1 audit fix for upstream migration)

#### Changed
- **Layout.tsx** — Refactored from 419 → 205 LOC, now composes Sidebar + TopBar + MobileTabBar
- **Footer** — Stripped to GitHub SVG + support email + disclaimer (social links moved to sidebar/future dedicated page)
- **index.css** — +400 LOC for layout tokens, sidebar, topbar, mobile tabbar, bottom sheet, skip-to-content, responsive breakpoints (1024px/768px/375px)

#### Tests
- 360 unit tests (18 files), all quality gates pass (tsc 0, lint 0, build 496KB)
- **E2E navigation.spec.ts** — Rewritten header→sidebar selectors (104→180 LOC, 9→17 test cases)
  - Covers: sidebar desktop, topbar badges, mobile tabbar, bottom sheet More, footer
- **E2E smoke.spec.ts** — Updated header→sidebar selector

#### Security
- PII scrubbing: Gno bech32 addresses (`g1...`) redacted in Sentry events
- Source maps not shipped to production (deleted after Sentry upload)

### v2.0-ε UX & Consistency

#### Added
- **Dashboard Redesign** — `DashboardDAOList` shows all saved DAOs with name, realm path, MEMBER badge
  - My DAOs + My Multisigs always visible, even when empty
  - Layout: Identity → Actions → Quick Vote → My DAOs → My Multisigs → Feature Cards → TXs
- **Wallet Connect Loader** — `ConnectingLoader` with Memba logo pulse + progress bar
  - Eliminates black screen during wallet authentication flow
- **Proposal Vote Bar Consistency** — ProposalView now uses SingleVoteBar (same as ProposalCard)
  - Single-line: filled width = participation %, green YES / red NO split
  - TierPieChart SVG donut wired into ProposalView for tier vote distribution
  - ARIA `role="progressbar"` + `aria-valuenow` for accessibility
- **Deploy Plugin Modal** — `DeployPluginModal` wired into DAOHome Extensions section
  - ⚡ Deploy Board button on Board plugin card for existing DAOs
  - Channel configuration + Adena DoContract deployment flow
- **Version Sync** — `APP_VERSION` now reads from `package.json` via Vite `define`
  - No more manual sync between `config.ts` and `package.json`
  - `vite-env.d.ts` TypeScript declaration for `__APP_VERSION__` global
- **DAOHome V3 Redesign** — single-card layout with merged identity + stats
  - Ghost "Members" text fix (parser filter for `## Members` residuals)
  - Source `</>` symbol restored with hover effect
  - DAO address right-aligned with click-to-copy
  - Full stat labels: Members, Active, Proposals, Turnout, Power (9px)
  - Description section with GovDAO fallback
  - `TierPieChart` prefix-sum refactor (react-hooks/immutability fix)

#### Changed
- **Multisig Placeholder** — Default name changed from "samourai-crew" → "our-super-cool-dao"
- **CSP Tightened** — `connect-src` narrowed from `*.netlify.app` to `memba-multisig.netlify.app`
- **Go 1.25 → 1.26** in CI workflow (fixes govulncheck stdlib vulnerabilities)

#### Tests
- 360 unit tests (18 files), all quality gates pass (tsc 0, lint 0, build 478KB)
- **10 E2E spec files** (Playwright) — +4 new: multisig, settings, create-dao, treasury
  - 168 E2E tests across Chrome, Firefox, Webkit + mobile 375px
  - Covers: navigation, smoke, plugins, dao, profile, token, multisig, settings, create-dao, treasury
  - Mobile overflow tests at 375px for all major pages

#### Fixed
- `Dashboard.tsx` — eliminated brittle type assertion `(auth as {}).address` → `auth.address`
- **E2E CI Fix** — 3 specs rewritten for cross-browser robustness:
  - `settings.spec.ts` — accordion expand before asserting collapsed content
  - `plugins.spec.ts` — tilde-encoded slug (`~`) instead of double-hyphens (`--`)
  - `create-dao.spec.ts` — text-based assertions instead of CSS attribute selectors
- **6 lint errors** — unused imports (`StatCard`, `TierBar`, `VoteStat`), unused vars, immutability violation
- **E2E regression** — breadcrumb `Back to DAOs` → `DAOs` (V3 compact breadcrumb)
- **UX regression** — removed `textTransform: uppercase` from stat pill labels

#### Security
- **Dependabot: `minimatch` ReDoS** — bumped via `npm audit fix` (dev dependency, 0 runtime impact)
- Backend: `govulncheck` — 0 vulnerabilities
- CodeQL: 0 alerts (JS/TS + Go)

#### Documentation
- `docs/planning/SENTRY_INTEGRATION.md` — frontend observability implementation guide
- `docs/planning/GNOSWAP_SLIPPAGE.md` — slippage tolerance implementation guide

### v2.0.0-alpha.1 — Sprint A+B+C (2026-03-06)

#### Added
- **Branding overhaul** — Open Graph / Twitter Card meta tags, `apple-touch-icon.png`, `og-image.png`, `<img>` logo replaces CSS-generated `M`
- **GnoSwap Option C** — Token metadata discovery via `gns` realm (pool realm lacks `Render()`)
- **Dashboard accordion** — Collapsible proposal summary (active/passed/rejected counts + quick links) per DAO card
- **TierPieChart upgrade** — 48px default, center label with total votes, optional inline legend, exported `TierVote` interface
- **Realm address derivation** — `derivePkgBech32Addr` via Web Crypto API (`SHA256("pkgPath:" + path)` → bech32)
- **RealmAddressBadge** — Copyable truncated bech32 address on DAOHome
- **Settings nav link** — ⚙️ Settings in header navigation
- **Proposal Explorer** — Full proposal management plugin (replaces 45-line stub):
  - Search by title or ID, status filter tabs (All/Active/Passed/Rejected with counts)
  - Sort selector (Newest/Oldest/Most Votes), pagination (10/page)
  - Status badges with color coding, inline vote counts, stats footer
- **Profile DAO Memberships** — `DAOMembershipsCard` showing saved DAOs with MEMBER badge
- **Directory Page** — `/directory` route with 3 tabs:
  - DAOs: seed list + saved DAOs, search, "Create DAO" CTA
  - Tokens: On-chain `grc20reg` registry query with pagination + 5-min cache
  - Users: On-chain `demo/users` registry query with pagination + 5-min cache
- **Avatar Upload** — Dual-mode `AvatarUploader` (🔗 URL / 📁 File), 2MB limit, type validation, live preview
- **`.nvmrc`** — Node.js 22 LTS enforced locally

#### Changed
- **GnoSwap paths** — Corrected testnet11 paths (removed `/v1/`), added `gns` field
- **Proposals plugin** — `name: "Proposals"` → `"Proposal Explorer"`, version 1.0.0 → 2.0.0
- **ProfilePage** — Avatar URL text field replaced with `AvatarUploader` component
- **Version** — `package.json` bumped to `2.0.0-alpha.1`

#### Tests
- **360 unit tests** (18 files, +7 from v2.0-ε), all quality gates pass (tsc 0, build 477KB / 138KB gzip)
- npm audit: **0 vulnerabilities**

### v2.0-δ Polish

#### Added
- **Extensions Step in CreateDAO Wizard** — Step 4: toggle Board on/off, configure channels
  - 5-step wizard flow: Name → Members → Governance → Extensions → Review
  - Chained board realm deploy: DAO + companion board in one flow
  - Draft persistence for extension choices
- **Plugin Route** — `/dao/:slug/plugin/:pluginId` with lazy PluginPage
  - PluginLoader renders each plugin or "not found" fallback
  - Back-to-DAO navigation from all plugin pages
- **Leaderboard Plugin** — 4th plugin: gnolove-powered member ranking
  - `calculateScore()`: packages×10 + proposals×5 + votes×2 + contributions×1
  - Sortable table with click-to-sort column headers
- **Settings Page** — `/settings` route (lazy-loaded)
  - Network selector, gas defaults, profile link, dev mode, clear cache
- **Feedback Feed** — `FeedbackFeed` component using board parser for `r/samcrew/memba_feedback`

#### Tests
- 334 unit tests (16 files, +10 from v2.0-γ), all quality gates pass

### v2.0-γ Swap

#### Added
- **GnoSwap Config** — `GNOSWAP_PATHS` per-chain realm paths (pool, router, position) in `config.ts`
- **GnoSwap ABCI Queries** — `plugins/gnoswap/queries.ts`: pool list/detail parser
- **MsgCall Builders** — `SwapRoute` + `AddLiquidity (Mint)` with slippage validation
  - Default 0.5%, warn >2%, block >5%, BigInt-safe `calculateMinOutput`
- **Swap UI** — `SwapView.tsx`: pool list + swap form with slippage presets
- **GnoSwap Plugin** — registered as 3rd built-in plugin in registry (lazy-loaded)

#### Tests
- 324 unit tests (15 files, +25 from v2.0-β), all quality gates pass

### v2.0-β Board

#### Added
- **Board Realm Template** — `boardTemplate.ts`: Gno code generator for `{daoname}_board` realms
  - Channels (`#general` auto-created), threads (title + Markdown body), replies
  - Rate limiting (`MIN_POST_INTERVAL` blocks between posts per member)
  - Public read via `Render()` with path routing (home/channel/thread)
  - Token-gated writes with `crossing` syntax (`runtime.PreviousRealm().Address()`)
- **Board ABCI Parser** — `plugins/board/parser.ts`: typed parser for board `Render()` output
  - `getBoardInfo`, `getBoardThreads`, `getBoardThread`, `boardExists`
- **Board UI** — `plugins/board/BoardView.tsx`: 4-view discussion forum
  - Channel list, thread list, thread detail with replies, new thread form
  - Authenticated write actions via `doContractBroadcast`
- **Board Plugin** — registered as 2nd built-in plugin in `registry.ts` (lazy-loaded)
- **MsgCall builders**: `buildCreateThreadMsg`, `buildReplyToThreadMsg`, `buildCreateChannelMsg`, `buildDeployBoardMsg`

#### Tests
- 299 unit tests (14 files, +38 from v2.0-α), all quality gates pass

### v2.0-α Foundation

### Added
- **Plugin Architecture Skeleton** — `PluginManifest` type, frozen registry with validation, `PluginLoader` lazy component with error boundary, DAOHome extensions section
- **Deployment Pipeline** — `<DeploymentPipeline>` reusable 4-step animated timeline (Building → Signing → Broadcasting → Deployed), integrated into CreateDAO, CreateMultisig, CreateToken
- **Member Proposals** — enabled "👥 Add Member" proposal type in ProposeDAO with target address + roles + auto-generated title/description
- **Admin Role Management** — DAOMembers page: admin detection, assign/remove role per member row (inline `×` button on role badges + expandable `+` panel for unassigned roles)
- **Executable Member Proposals** — `daoTemplate.ts` generated Gno code now supports:
  - `ProposeAddMember(addr, power, roles)` — governance proposal that adds member when voted + executed
  - `ProposeRemoveMember(addr)` — governance proposal to remove member
  - `ProposeAssignRole(addr, role)` — governance proposal to assign role
  - `ExecuteProposal` action dispatch (add_member, remove_member, assign_role)
  - Safety checks: duplicate member prevention, last admin protection
- **MsgCall builders**: `buildProposeAddMemberMsg`, `buildProposeRemoveMemberMsg`, `buildProposeAssignRoleMsg`, `buildAssignRoleMsg`, `buildRemoveRoleMsg`
- **CI on dev/v2** — full pipeline (backend, frontend tsc/lint/build/unit/E2E, proto, docker) triggers on dev/v2 push/PR

### Changed
- `Proposal` struct gains `ActionType` + `ActionData` fields for embedded action dispatch
- ProposeDAO member type now calls on-chain `ProposeAddMember` instead of generic `Propose`
- `ci.yml` triggers include `dev/v2` alongside `main`

### Tests
- 261 unit tests (12 files, +31 from v1.7.1), E2E updated for v2 behavior
- All quality gates pass: tsc, lint, build (470KB), backend

## [1.7.1] — 2026-03-05 — UX Polish 🎨

### Changed
- **Dashboard nav** hidden when wallet disconnected (matches Profile pattern)
- **`/dashboard` route** redirects to `/` when disconnected (no more empty page)

### Added
- **Quorum progress bar** on ProposalView detail page — 50% threshold marker, amber/teal color based on participation
- **E2E test**: Dashboard nav hidden when disconnected
- **E2E test**: `/dashboard` → `/` redirect for disconnected users

### Tests
- 55 E2E tests (+1), 230 unit tests, build/lint/tsc clean

## [1.7.0] — 2026-03-05 — Governance UX & Testing 🗳️🧪

### Added
- **Dual VoteBar** on proposal cards — 3-color vote split (YES/NO/ABSTAIN) + quorum progress bar with 50% threshold marker
- **Quorum visualization** — participation % bar below vote split, amber <50% / teal ≥50%
- **ABSTAIN vote visibility** — grey segment in vote split bar (previously invisible)
- **Voter turnout** text on proposal cards ("8 of 17 members voted (47%)")
- **33 new E2E tests** across 4 new spec files: `navigation`, `profile`, `token`, `dao` (54 total)
- **Firefox** project in Playwright config for cross-browser testing
- **Screenshot-on-failure** + **video-on-retry** in Playwright config
- **CI concurrency groups** to cancel in-progress runs on same PR
- **Node 22** added to CI matrix (Node 20 EOL April 2026)
- **CI timeout-minutes** on all jobs to prevent stuck workflows
- **E2E failure artifact upload** — screenshots + traces on failure

### Changed
- **Adena reconnect polling** reduced from 10s (50×200ms) to 5s (25×200ms) — extension injects in 1–3s
- **GetNetwork() cached** in `sessionStorage` for faster reconnect on page navigation
- **Reconnect label** — "Syncing..." (teal) during auto-reconnect vs "Authenticating..." (amber) during fresh login

### Fixed
- **VoteBar bug** — old bar calculated `YES/(YES+NO)`, completely ignoring ABSTAIN votes. Now shows all 3 vote types
- **100% false positive** — proposals with ABSTAIN-only votes no longer show "100% YES"

### Infrastructure
- Repository cleaned: 3 stale local + 7 stale remote tracking refs pruned (all squash-merged via PRs)

### Tests
- 284 total tests (230 unit + 54 E2E), up from 251 (230 + 21)
- Build, lint, TypeScript, and backend tests verified

## [1.6.0] — 2026-03-04 — UX Testing Fixes 🧪

### Added
- **Pubkey validation hint** on CreateMultisig — explains why submit is disabled when member keys are missing
- **Unlink GitHub** button on profile page (when GitHub is already linked)
- **Back navigation** buttons on Dashboard (← Home) and DAOList (← Back to Dashboard)
- **Adena lock tooltip** hint for users experiencing re-authentication after page reload
- 11 new unit tests: 7 for GitHub URL normalization + CTA guard, 4 for DAO heading strip

### Changed
- **Header nav** label renamed from "Multisig" to "Dashboard" (matches actual destination)
- **ErrorToast** repositioned from bottom-right to top-right (below header), blur reduced to 4px
- **Landing page** auto-redirects connected users to Dashboard
- **Feature cards** trigger wallet connect when not connected (instead of navigating to empty pages)
- **Avatar priority** inverted: user-set `avatarUrl` now wins over `githubAvatar`

### Fixed
- **P0: GitHub link → Memba URL** — social link now normalizes username to full `https://github.com/` URL
- **P0: "Link GitHub" CTA persists** — guard now checks both `githubLogin` AND `socialLinks.github`
- **P0: GitHub OAuth redirect → `/`** — uses `sessionStorage` fallback when Adena disconnects during OAuth
- **P0: Backend stores raw username** — `GithubCallback` now saves full GitHub URL in backend profile
- **DAO card `## Members` raw markdown** — heading markers stripped from DAO config description/name
- **Success message not visible** — `CreateToken` scrolls to top after successful creation

### Tests
- 230/230 tests passing (+11 from v1.5.0)
- Build, lint, and backend tests verified at each batch gate

## [1.5.0] — 2026-03-04 — Hardening & GovDAO UX 🛡️🏛️

### Added
- **Collapsible Proposal History** — past proposals section collapsed by default with `▶` toggle on DAOHome
- **Red dot on DAO cards** — per-card pulsing amber indicator + vote count when unvoted proposals exist
- **Source transparency links** — discreet `</>` icon on DAOHome, DAOCard, and ProposalView linking to gno.land explorer
- **Voter Turnout stat** — replaces Acceptance Rate with average voter participation percentage (more actionable)
- **ABSTAIN voter data model** — `abstainVoters` field added to `VoteRecord` type across all voter checks
- **Event-based unvoted refresh** — `useUnvotedCount` now reacts to `memba:voteCacheCleared` custom DOM event
- 10 new component files: `components/profile/`, `components/dao/`, `components/proposal/` with barrel exports

### Changed
- **ProfilePage.tsx** decomposed (814 → 464 LOC): `ProfileUIAtoms`, `RegisterUsernameForm`, `MyVotesSection`
- **DAOHome.tsx** decomposed (704 → 450 LOC): `DAOCards`, `ProposalCard`, `MemberCard`
- **ProposalView.tsx** decomposed (604 → 512 LOC): `VoteBreakdown` (enhanced with ABSTAIN rendering)
- **"Total Power"** stat renamed to **"Voting Power"** for clarity
- Unified CSP: `netlify.toml` is now single canonical source (removed duplicate `index.html` meta tag)

### Fixed
- **P0: CSP blocking wallet connection** — dual CSP sources (meta tag + HTTP header) were out of sync; meta tag missing `*.fly.dev` blocked backend gRPC calls
- **BUG: DAOHome stale data on back-nav** — `enrichedIds`/`votedIds` now reset at start of `loadData()`
- **BUG: Dashboard quick-vote race condition** — removed 2s `setTimeout`; vote cache clearing now event-driven
- **BUG: ABSTAIN votes not counted** — voter matching and unvoted scanning now include ABSTAIN voters
- 7 lint issues fixed (4 errors + 3 warnings → 0/0): unused imports, stale eslint-disables, missing deps

### Security
- CSP unified to single source in `netlify.toml` — eliminates dual-policy sync risk
- CSP `connect-src` hardened: `*.fly.dev` wildcard pinned to exact `memba-backend.fly.dev` (least-privilege)
- Added `adena.reconnecting` to Layout effect dependency array (correctness fix)

## [1.4.0] — 2026-03-03 — UX Optimization ✨

### Added
- **Landing page redesign** — feature showcase with 3 capability cards (Multisig, DAO, Token Factory) for logged-out users, replacing the empty "connect wallet" dead-end
- **Activity Hub** — cross-feature "Action Required" strip on Dashboard showing unvoted proposal count + unsigned TX count with navigation shortcuts
- **Quick Vote widget** — inline YES/NO voting for top 3 unvoted DAO proposals directly from Dashboard, eliminating 3-click friction
- **Feature Cards grid** — always-visible cards showing multisig/DAO/token counts with contextual CTAs (Manage/Get Started/Create)
- **DAO page Action Required banner** — amber notification showing proposals needing votes with "Vote now →" shortcut
- **DAO summary line** — compact stats: "N DAOs · N pending votes · N members total"
- **Multisig Action Required banner** — shows unsigned pending transaction count on MultisigView page
- **Proposal type selector** — visual indicator of current (Text) and future (Add Member, Treasury Spend, Code Upgrade) proposal types on ProposeDAO
- **MsgCall source code preview** — expandable "📋 View Source Code" section on ProposeDAO showing the exact MsgCall being built
- **Vote scanner extension** — `scanUnvotedProposalDetails()` returns proposal metadata (not just count) for Quick Vote widget
- **`useUnvotedProposals` hook** — new React hook with `refresh()` callback for post-vote re-scan
- CSS utility classes: `.k-action-banner`, `.k-feature-grid` with responsive breakpoints

### Changed
- **DAO page hierarchy** — DAO grid moved to primary position; "Connect to DAO" form collapsed by default with toggle button
- **Dashboard layout** — stat cards (Multisigs: 0, Pending: 0, Balance) replaced with Feature Cards + Activity Hub for better first-impression UX
- **CreateToken placeholders** — "Samourai Token" / "SAM" → "Your Token Name" / "$YTK"

## [1.3.1] — 2026-03-03 — RPC Domain Security Fix v2 🛡️

### Security
- **CRITICAL FIX**: v1.2.0 RPC domain validation was a self-check (always passed) — it only validated Memba's hardcoded config, never the wallet's actual RPC URL
- **Adena GetNetwork() integration** — reads wallet's active RPC URL and validates against `*.gno.land` allowlist
- **Transaction blocking** — all `DoContract` writes blocked when wallet RPC is untrusted or unverifiable
- **Real-time re-validation** — `changedNetwork` event listener detects mid-session network switches
- **Prominent security banner** with malicious URL display and step-by-step fix instructions

### Added
- 3 new security tests (200 total): tester's exact malicious URL, write guard validation

### Fixed
- **`/profile/` blank page** after GitHub OAuth callback — wallet disconnects during redirect leaving empty address; now redirects to dashboard + added `/profile` catch-all route

## [1.3.0] — 2026-03-03 — Notification & Vote History 🗳️

### Added
- **Unvoted proposal notification dot** — pulsing red badge on 🏛️ DAO nav link when saved DAOs have open proposals the user hasn't voted on
- **Enhanced "My Votes" section** on own profile — cross-DAO vote history with DAO names, clickable proposal links, and vote filter tabs (All/YES/NO)
- **Vote cache invalidation** — notification dot updates immediately after voting
- **Shared vote scanner** (`lib/dao/voteScanner.ts`) — max 5 DAOs × 5 proposals, 100ms delay, sessionStorage caching

### Fixed
- **Adena wallet disconnect on refresh** — wallet now auto-reconnects using `sessionStorage` persistence; Layout auth guard waits for reconnect before clearing token

## [1.2.0] — 2026-03-03 — RPC Domain Validation 🛡️

### Added
- **RPC domain allowlist** — only `*.gno.land` domains are trusted
- **🛡️ SECURITY WARNING** banner shown if untrusted RPC domain detected
- **8 new unit tests** — malicious domains, subdomain spoofing, lookalikes, NETWORKS validation

### Security
- **Fixed**: malicious RPC URLs like `https://test11.malicious.land:443` with valid chain ID would silently bypass checks

## [1.1.0] — 2026-03-03 — Proposal Categories & Polish

### Added
- **Proposal category picker** — governance, treasury, membership, operations (hidden for GovDAO which doesn't support categories)
- **Live demo link** in README → [memba.samourai.app](https://memba.samourai.app)

### Changed
- **`isGovDAO`** — exported from `builders.ts` for category visibility logic
- **Summary card** in ProposeDAO shows `Propose(title, description, category)` for Memba DAOs

## [1.0.0] — 2026-03-03 — First Public Release 🎉

> Version reset from v10.0.0 → v1.0.0 for clean open-source versioning. All previous development versions (v0.1.0–v10.0.0) are consolidated into this first public release.

### Highlights
- 🔑 Multisig wallets (create, import, sign, broadcast)
- 🏛️ DAO governance (proposals, voting, execution, member management)
- 🏗️ DAO Factory (4 presets: Basic, Team, Treasury, Enterprise)
- 🪙 GRC20 Token Launchpad (create, mint, burn, transfer, faucet)
- 👤 User profiles (bio, socials, GitHub link, gnolove stats)
- 📊 Vote intelligence (turnout %, progress bars, filter tabs, VOTED badges)
- 🔐 Challenge-response auth (ed25519, persistent keys, rate-limited)
- 🧪 189 unit tests (Vitest)
- 🐳 Docker Compose self-hosting
- 🚀 CI/CD: GitHub Actions + Netlify + Fly.io

## [10.0.0] — 2026-03-03 — Governance Intelligence & Docs Polish

### Added
- **Voter turnout** — proposal cards + detail page show "12 of 17 members voted (71%)" instead of just "12 voted"
- **"⚡ Awaiting execution"** subtitle on proposals with PASSED status

### Changed
- **Status label clarity** — "ACCEPTED" → "PASSED" to distinguish from "EXECUTED"
- **README.md** — updated from v7.0.0 → v9.0.0, test count 167 → 189, added 5 missing features

### Fixed
- **ROADMAP ordering** — v8.0.0 now correctly appears before v9.0.0
- **Vote % bars** — fallback computation from voter counts when on-chain render parsing returns 0 (GovDAO format)

## [9.0.0] — 2026-03-03 — DAO Governance UX & Vote Intelligence

### Added
- **Lazy vote enrichment** — proposal cards progressively fetch vote percentages and voter counts for active proposals (Option A: progressive loading)
- **VOTED / NEEDS VOTE badges** — proposal cards show ✓ VOTED (green) or ⏳ VOTE (yellow) badges for DAO members
- **Filter tabs** — DAO home shows "All / Needs My Vote / Voted" filter tabs above active proposals (members only)
- **Vote summary bar** — proposal detail page shows YES/NO/ABSTAIN percentages with visual bar + voter participation count
- **hasVoted detection** — cross-references user @username (resolved from on-chain registry) against voter lists, with address fallback
- **Dashboard avatar** — fetches avatar from backend profile API and displays in the Identity Card

### Fixed
- **Vote buttons visible after voting** — buttons now hide completely when user has already voted, showing "✓ You voted YES/NO" confirmation instead
- **hasVoted never worked** — old code matched `profileUrl.includes(address)` which fails for GovDAO; replaced with username + address matching via `useMemo`
- **APP_VERSION badge** — updated from v7.0.0 → v9.0.0

### Changed
- **`resolveOnChainUsername`** — exported from `profile.ts` for reuse in DAOHome hasVoted matching
- **`fetchBackendProfile`** — exported from `profile.ts` for Dashboard avatar

## [8.0.0] — 2026-03-03 — Bug Fixes, UX Polish & Dashboard Hub

### Fixed
- **Username placeholder** — replaced hardcoded "zooma1337" with neutral "anonymous-user" (grey) + valid format hint "myname123"
- **Faucet link** — added persistent "Need test tokens? → faucet.gno.land" link on registration + smart error detection for insufficient GNOT
- **Avatar instant display** — optimistic UI update: avatar shows immediately after save instead of waiting for gnolove re-fetch
- **GitHub OAuth** — fixed Adena wallet disconnect during OAuth redirect: deferred profile save via localStorage (10min expiry), auto-applies on wallet reconnect
- **GNOT balance** — rewrote `useBalance.ts` from HTTP GET to JSON-RPC POST (same pattern as `dao/shared.ts`), added ResponseBase.Data fallback, shows "? GNOT" on error
- **Token creation "Token not found"** — replaced auto-redirect with full success view (animated checkmark, TX hash link, manual "View Token" button); added retry logic in `TokenView.tsx` (3 retries × 2s)
- **Proposal infinite loading** — wrapped `getProposalDetail` in try-catch with 3 render path formats (id, proposal/id, :id) and console.warn logging
- **Execute button for non-members** — added `isMember` guard; non-members see "Only DAO members can execute" warning instead

### Added
- **`GnoCodeBlock.tsx`** — lightweight Gno/Go syntax highlighter (~115 LOC, no dependencies): keywords (cyan), types (purple), strings (amber), comments (grey), numbers (green)
- **Unit tests: `gnoCodeBlock.test.ts`** — 15 tests covering keyword identification, string/backtick parsing, comment priority, type detection, number literals, full snippet tokenization, and text preservation
- **Unit tests: `balance.test.ts`** — 7 tests covering zero/whole/fractional/sub-GNOT/trailing-zero/large balance formatting
- **Dashboard User Identity Card** — avatar, @username, GNOT balance, address, "Edit Profile" link at top of dashboard
- **Enhanced Quick Actions** — added "Explore DAOs", "Create DAO", "Browse Tokens" buttons alongside existing multisig actions

### Changed
- **Test count**: 167 → 189 (+22 tests, +13% increase)
- **Dashboard subtitle** — "Manage your multisig wallets" → "Your hub for multisig wallets, DAOs, and tokens"
- **Code preview** — `WizardStepReview.tsx` plain `<pre>` replaced with `<GnoCodeBlock>` syntax highlighter
- **`GithubCallback.tsx`** — new "deferred" step state for when wallet disconnects during OAuth

## [7.0.0] — 2026-03-03 — ✅ SHIPPED

### Added
- **Unit tests: `dao.test.ts`** — 40 tests covering `normalizeStatus`, `sanitize`, `parseProposalList`, `parseMemberstoreTiers`, `parseMembersFromRender`, and all message builders (vote, execute, propose, archive)
- **Unit tests: `grc20.test.ts`** — 25 tests covering `calculateFee`, `feeDisclosure`, all MsgCall builders (create, mint, transfer, burn, approve, faucet), and `toAdenaMessages` Adena conversion
- **Unit tests: `daoTemplate.test.ts`** — 53 tests covering code generation (crossing syntax, `chain/runtime`, presets), injection prevention (address validation, role/category filtering), `buildDeployDAOMsg`, `validateRealmPath`, `isValidGnoAddress`, and DAO presets
- **Unit tests: `profile.test.ts`** — 15 tests covering type verification, love power score calculation, profile merge logic (backend overrides gnolove), and social links
- **Test exports** — internal pure functions (`_normalizeStatus`, `_parseProposalList`, `_sanitize`, `_parseMemberstoreTiers`, `_parseMembersFromRender`) exported with `_` prefix for unit testing
- **11-perspective cross-audit** — CTO, CSO, Red Team, Blue Team, Black Hat, UX/UI, Gno Core, DevRel, Fullstack, DeFi User, DAO User (43 findings: 2 High, 28 Medium, 13 Low)
- **`isValidGnoAddress`** — strict bech32 address validation (g1 + 38 lowercase alphanum)
- **Stale chunk auto-recovery** — `ErrorBoundary` detects Vite lazy-load failures after deploy and auto-reloads (sessionStorage loop guard), shows "New version available" on second failure
- **Error mapping layer** — centralised `errorMap.ts` with 10 error patterns: network failures, timeouts, auth errors, blockchain queries, insufficient funds, wallet errors → user-friendly title + message + suggested action
- **Progressive loading: DAOHome** — config renders header immediately (~200ms), members and proposals sections load independently with per-section skeleton states
- **Progressive loading: DAOList** — placeholder cards show instantly (name + path from localStorage), config data fills in progressively per-card
- **Rich dashboard onboarding** — feature cards (Multisig, DAO, Tokens) with icons, descriptions, hover animations, and contextual CTAs replace generic empty state
- **CreateDAO wizard split** — 757 LOC monolith refactored into ~200 LOC orchestrator + 5 components (`wizardShared.tsx`, `WizardStepPreset.tsx`, `WizardStepMembers.tsx`, `WizardStepConfig.tsx`, `WizardStepReview.tsx`)
- **DAO draft persistence** — localStorage auto-save (debounced 500ms) with "Resume draft?" banner, 24h TTL auto-expiry, cleared on deploy

### Changed
- **Test count**: 34 → 167 (+133 tests, +391% increase)
- **`dao.ts` → `dao/`** — split monolithic 778 LOC file into 5 sub-modules: `shared.ts` (types, ABCI, username resolution), `config.ts` (getDAOConfig), `members.ts` (getDAOMembers), `proposals.ts` (getDAOProposals, getProposalDetail, getProposalVotes), `builders.ts` (message builders) + barrel `index.ts`
- **`daoTemplate.ts`** — hardened code generation with strict input sanitization: bech32 address validation, alphanumeric-only role/category validation, power value floor + non-negative clamp
- **Zero breaking changes** — barrel re-export maintains all existing import paths
- **`ErrorToast`** — enhanced with `mapError()` integration: title + message + action hint + optional retry button, `useMemo` for mapped state
- **`CreateDAO.tsx`** — 757 LOC → ~200 LOC orchestrator (state management + step navigation); rendering delegated to 4 extracted components

### Fixed
- **README.md**: "Tailwind CSS v4" → "Vanilla CSS" (architecture diagram)
- **ARCHITECTURE.md**: "Tailwind CSS v4" → "Vanilla CSS" (components table)
- **ROADMAP.md**: fixed version ordering (v5.6.0, v5.0.4 now before v6.0.0), added v7.0.0 section
- **Error map case sensitivity** — all pattern tests now lowercase to match `.toLowerCase()` call on input (fixes `[unknown] Failed to fetch` not being caught)

### Infrastructure (Step 6)
- **Enhanced `/health` endpoint** — returns version, uptime, DB status (ping + file sizes), memory usage; HTTP 503 on degraded
- **SQLite automated backup** — daily `VACUUM INTO` (WAL-safe, no lock), 7-day retention, configurable via `BACKUP_INTERVAL` env
- **Bech32 prefix parameterisation** — `BECH32_PREFIX` constant in `config.ts`, replaces 8 hardcoded `"g1"` references across 4 files
- **APP_VERSION** bumped to `7.0.0`

### TX Export (Step 7)
- **TX history CSV export** — client-side, 10 columns (ID, Date, Type, Status, Multisig, Creator, Memo, Signatures, TX Hash, Messages), CSV injection prevention, Blob download

## [6.0.0] — 2026-03-02

### Added
- **OAuth CSRF protection** — state tokens (256-bit, one-time-use, 10min TTL)
- **CI security scanning** — `govulncheck` + `npm audit` + golangci-lint v2
- **Community files** — CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
- **Dependabot** — weekly Go + npm dependency updates
- **CODEOWNERS** — @zxxma owns all files
- **Issue templates** — bug report + feature request
- **ErrorBoundary** — React error boundary with Kodera fallback UI
- **Go test coverage** — `-cover` flag in CI
- **Vitest unit tests** — 34 tests for parseMsgs, daoSlug, config (PR #37)
- **Playwright E2E** — 5 smoke tests for core routes (PR #37)
- **Backend OAuth tests** — 5 tests for state store (PR #37)
- **gosec SAST** — Go security scanner in CI on push/PR/weekly (PR #39)
- **Security badge** — README status badge for security workflow

### Security
- Fixed GO-2026-4559 (`golang.org/x/net` v0.50.0 → v0.51.0)
- All `Close()`/`Fprintf()` errors checked (10 errcheck fixes)
- Rate limiting on OAuth endpoints
- Bounded `io.ReadAll` with `io.LimitReader` (1 MB cap) in GitHub OAuth
- `npm audit` now fails CI on real production dependency vulnerabilities
- `#nosec` annotations with documented justifications (G115, G704)

### Changed
- Go 1.24 → 1.25 (all configs: go.mod, ci.yml, deploy-backend.yml, Dockerfile)
- golangci-lint: action replaced with `go install` v2 (Go 1.25 compat)
- Branch protection on `main` (require PR + review + CI + no force push)

## [5.7.0] — 2026-02-28

### Fixed
- **Username registration** — `Register` takes 1 arg (`username`) not 3; regex updated to `^[a-z]{3,}[a-z_]*[0-9]{3,}$` (min 3 letters + min 3 digits per realm spec)
- **GitHub verification** — `ghverify` realm 404 on test11; GithubCallback now saves login to backend profile instead of on-chain MsgCall
- **Avatar display** — added `referrerPolicy="no-referrer"` to bypass Referer-based CORS blocks (Twitter CDN etc.)
- **`/u/username` black screen** — added `/u/:username` route with `UserRedirect` component that resolves username → address via ABCI qrender
- **Members list UX** — reordered to show username first (prominent), then truncated address (`g1abc...xyz`); internal `/u/` links instead of external gno.land
- **Vote status** — `ProposalView` now detects if user already voted via voteRecords; shows "✓ You voted YES/NO" badge + disables buttons

## [5.6.0] — 2026-02-28

### Added
- **Native GitHub verification** — OAuth flow directly in Memba (no gnolove.world redirect). Backend proxy for code exchange, frontend `GithubCallback` page with multi-step UX (exchange → verify on-chain → success), and MsgCall to `ghverify.RequestVerification`
- **In-app username registration** — inline form on profile page sends MsgCall to `gno.land/r/gnoland/users/v1:Register` via Adena. Input validation (3-20 chars, lowercase), auto-refresh on success

### Fixed
- **GovDAO membership bug** — ProposalView now passes `memberstorePath` to `getDAOMembers()`, fixing tier-based DAOs (GovDAO T1/T2/T3) showing "not a member" incorrectly
- **Avatar rendering** — replaced CSS `background: url()` with `<img>` tag + `onError` fallback; fixes CORS-blocked external avatar URLs (e.g. Twitter)
- **GitHub icon** — proper Invertocat SVG replacing 🐙 emoji in social links + CTA card

## [5.5.0] — 2026-02-28

### Added
- **"Link GitHub" CTA** — on own profile when GitHub not linked, card redirects to gnolove.world for OAuth + on-chain verification

## [5.4.0] — 2026-02-28

### Added
- **Backend: GetProfile RPC** — public read from SQLite `profiles` table, returns empty profile for new addresses
- **Backend: UpdateProfile RPC** — authenticated write with input sanitization (HTML stripping, length limits, URL validation)
- **SQLite migration** `002_profiles.sql` — `profiles` table with address (PK), bio, company, title, avatar_url, twitter, github, website, updated_at
- **Profile edit mode** — "✏️ Edit" button on own profile, inline form (7 fields with character counters), Save/Cancel, ✓ Saved feedback
- **Backend profile integration** — `profile.ts` fetches from Memba backend in parallel with gno.land + gnolove, backend data overrides gnolove defaults

### Security
- Server-side HTML tag stripping (`stripHTML`)
- Input length validation: bio≤512, company/title≤128, URLs≤256
- URL scheme validation (http/https only)
- Auth token must match profile address for UpdateProfile
- Parameterized SQL queries only

## [5.3.0] — 2026-02-28

### Added
- **User Profile pages** — `/profile/:address` with hybrid data from gno.land (username), gnolove REST API (GitHub stats, contribution score, deployed packages, governance votes), and Memba backend (editable bio/company/title — Phase 2)
- **Gnolove integration** — `GNOLOVE_API_URL` config, `profile.ts` data layer fetches from 4 endpoints in parallel with 5s timeouts and graceful degradation
- **👤 Profile nav link** in header (shown when wallet connected)
- **👤 Clickable member addresses** in DAOHome + DAOMembers navigate to `/profile/{address}`
- **Archive DAO UI** — full integration across 4 pages:
  - `DAOHome`: `📦 ARCHIVED` badge + amber warning banner + disabled New Proposal
  - `DAOList`: `📦 Archived` badge + dimmed card opacity
  - `ProposalView`: vote/execute buttons hidden + archive info banner
  - `ProposeDAO`: warning banner + disabled submit button
- **"Create your username" CTA** on DAOHome (card) + DAOMembers (inline link) for authenticated users without `@username`
- **Username resolution** for custom Memba DAOs (JSON-parsed + Render-fallback code paths)

### Fixed
- **Threshold display encoding** (em dash mojibake) — replaced `atob()` with `TextDecoder` pipeline in `abciQuery()` for proper UTF-8 decoding
- **Render separator** — `—` → `|` in generated DAO Render output for threshold/quorum/power (prevents future encoding issues)
- **Member parsing regex** backward-compatible with both `—` and `|` separators

### Changed
- `config.ts`: added `GNOLOVE_API_URL` constant
- `App.tsx`: added lazy `ProfilePage` route
- `Layout.tsx`: added conditional 👤 Profile nav link

## [5.2.1] — 2026-02-28

### Fixed
- **Proposal creation fails** — generated DAO code used wrong crossing syntax (`crossing()` builtin doesn't exist in Gno). Fixed to use correct `cur realm` first parameter + `runtime.PreviousRealm().Address()`, matching live GovDAO on gno.land
- **Role badges truncated** — added `whiteSpace: nowrap` + `flexWrap: wrap` to DAOHome member cards
- **Role badge colors** — admin=gold, dev=cyan, finance=purple, ops=blue (consistent across DAOHome + DAOMembers)

### Added
- **Archive DAO** — admin-only `Archive(cur realm)` function in generated DAOs to mark obsolete DAOs as read-only (blocks new proposals and votes)
- `IsArchived()` query function for checking archive status

### Changed
- `daoTemplate.ts`: all 5 public functions use `func Name(cur realm, ...)` crossing syntax (verified against live GovDAO source on gno.land)
- `daoTemplate.ts`: `runtime.OriginCaller()` → `runtime.PreviousRealm().Address()` for proper crossing context
- `dao.ts`: correct function names for Memba DAOs (`VoteOnProposal`, `ExecuteProposal`)
- `ROADMAP.md`: added v5.2.1 fixes section, expanded Future Vision

## [5.2.0] — 2026-02-28

### Added
- **DAO Presets**: 4 configurable DAO templates: Basic, Team, Treasury, Enterprise — each with pre-configured roles, threshold, quorum, and proposal categories
- **Role System**: DAO members can now have roles (admin, dev, finance, ops, member) — assigned during creation, manageable by admins post-deploy via `AssignRole`/`RemoveRole`
- **Quorum**: configurable minimum participation % (0-100) before any proposal can pass
- **Proposal Categories**: configurable allowed categories (governance, treasury, membership, operations) — validated on-chain
- **DAO Factory wizard enhanced**:
  - Step 1: preset cards with icon, description, auto-fill on select
  - Step 2: per-member role tag toggles with color-coded badges
  - Step 3: quorum slider + proposal categories multi-select + role permissions summary
  - Step 4: roles distribution, preset type, quorum, categories in review summary
- **Role filter tabs**: DAOMembers page shows role-based filter buttons alongside tier filters (when roles present)
- **Role-aware ABCI parsing**: member parser supports `(roles: admin, dev) — power: 3` format from v5.2.0 DAOs
- **Category in proposals**: proposal parsers extract `Category:` field from DAO Render output
- **`buildProposeMsg` category**: MsgCall now passes category as 3rd argument (backward-compatible default: "governance")

### Fixed
- **Footer email**: `contact@samourai.coop` → `support@samourai.coop` in Layout footer

### Changed
- `daoTemplate.ts`: complete rewrite with role-aware Gno realm code generator (~470 lines), `DAO_PRESETS` export, `DAOPreset` interface
- `CreateDAO.tsx`: 4-step wizard with preset selection, role assignment, quorum slider, category selector
- `dao.ts`: `DAOProposal` gains `category` field, member parser enhanced for `roles:` prefix, author parser handles raw `g1` addresses
- `DAOMembers.tsx`: role badges use proper colors (admin=gold, dev=cyan, finance=purple, ops=blue), role filter tabs
- Generated realm code includes: `AssignRole`, `RemoveRole`, `assertAdmin`, `hasRole`, `assertCategory`, `assertRole`, quorum check in `VoteOnProposal`, last-admin protection

## [5.0.4] — 2026-02-27

### Fixed
- **🔥 DAO deployment**: Migrated from deprecated `std` stdlib to `chain/runtime` (gno PR #4040)
  - `import "std"` → `import "chain/runtime"`
  - `std.Address` → `address` (builtin type in gno 0.9)
  - `std.OrigCaller()` → `runtime.OriginCaller()`
  - Verified on test11 via `gnokey maketx addpkg` (TX height 401999)
- **gnomod.toml**: Added required `gno = "0.9"` version field
- **File sorting**: Files sorted alphabetically in MsgAddPackage (gno `ValidateBasic` requirement)
- **Gas fee**: Bumped from 1 ugnot to 10 GNOT for package deployment
- **Storage deposit**: Set to 10 GNOT (was 0)

### Added
- **2 GNOT dev fee**: Sent to samourai-crew multisig on every DAO deployment (atomic with addpkg)

## [5.0.3] — 2026-02-27

### Added
- **Auto-refresh**: 30s silent polling for active (open) proposals — votes update live
- **LIVE badge**: pulsing green indicator next to ACTIVE status during auto-refresh
- **Network-aware explorer URLs**: `getExplorerBaseUrl()` maps each chainId to correct explorer domain
- **DAO membership pre-check**: verifies wallet is DAO member before allowing vote
- **Non-member warning**: amber banner with truncated address when wallet is not a DAO member
- **Vote button disable**: vote buttons disabled for non-members

### Changed
- **Code splitting**: 17 static page imports → 16 lazy chunks via `React.lazy` + `Suspense`
  - Main bundle: 517KB → 424KB (-18%)
  - DAO pages: lazy chunk (~73KB)
  - Token pages: lazy chunk (~21KB)
  - Shimmer `PageLoader` fallback during chunk load

### Fixed
- **🏗️ Responsive overhaul**: comprehensive mobile UX fixes
  - `overflow-x: hidden` on html/body prevents horizontal scroll
  - `word-break: break-word` + `overflow-wrap: anywhere` on all cards
  - Header: version badge hidden ≤480px, nav labels collapse to emoji-only ≤375px
  - Proposal description: long URLs now wrap correctly on mobile
  - Stats grid: 2-column layout on mobile via `k-stat-grid` class
  - Tightened padding/sizing at 375px for iPhone SE
- **Hardcoded URLs**: user profile links now use `getExplorerBaseUrl()` instead of hardcoded `test11.testnets.gno.land` (broken on staging/portal-loop)

## [5.0.2] — 2026-02-27

### Added
- **Staging network**: added to network selector (chainId: `staging`, RPC: `rpc.gno.land:443`)
- **Chain mismatch detection**: amber warning banner when Adena wallet chainId ≠ Memba's selected network
  - Shows both chain IDs with 1-click "Switch Memba to X" button
  - Fallback text when wallet is on unsupported network

## [5.0.1] — 2026-02-27

### Fixed
- **DAO Factory**: member address validation requires 39+ chars (bech32 minimum)
- **DAO Factory**: invalid address count shown in error message

### Added
- **Treasury**: GNOT balance via `bank/balances` ABCI query for DAO realm address
- **Treasury**: native GNOT displayed with micro-unit conversion alongside GRC20 tokens
- **Treasury**: independent error handling for GNOT and GRC20 balance fetches

## [5.0.0] — 2026-02-27

### Added
- **DAO Factory**: create and deploy new governance DAOs on gno.land
  - 4-step wizard: name/path → members + power → voting threshold → review + deploy
  - `daoTemplate.ts`: generates self-contained Gno realm code (~227 lines)
  - `MsgAddPackage` deployment via Adena wallet
  - Generated DAO includes: member management, proposals, voting (YES/NO/ABSTAIN), execution
  - Configurable voting threshold (1-100%)
  - Auto-save deployed DAO to saved DAOs list
  - Code preview with expandable section before deployment
  - Realm path validation (gno.land/r/username/daoname format)

### Changed
- `ARCHITECTURE.md`: documented hybrid RPC vs backend architecture with data flow diagrams

## [4.4.0] — 2026-02-27

### Added
- **Username cache**: localStorage cache for resolved @usernames with 1-hour TTL
  - First visit: resolve 17 addresses via ABCI (~200ms)
  - Repeat visits: instant username display from cache (0 ABCI calls)
  - Stale cache entries auto-refreshed in background
  - `UsernameCache` interface with `readUsernameCache()` / `writeUsernameCache()`

## [4.3.1] — 2026-02-27

### Added
- **Member @usernames**: resolve g1 addresses to `@usernames` via `gno.land/r/gnoland/users/v1` registry
  - Parallel batch resolution (17 members in ~200ms)
  - Clickable links to gno.land user profiles
  - Displayed on both DAO Home and Members pages

### Fixed
- **GovDAO data sync**: rewrite all ABCI parsers to match actual on-chain output formats
  - Member parsing: ABCI table format `| T1 | g1address |` (was `[g1address]` link format)
  - Memberstore link: handle full testnet URLs (was expecting `gno.land/` prefix)
  - Pagination: fetch all pages via `?page=N`, detect `[2](?page=2)` links
  - Tier extraction: inline from table rows (removed separate filtered fetch)
  - Description: filter out memberstore link lines
  - Sanitize: allow `?=&` chars for pagination/filter query params
  - Removed unused `assignMemberTiers` function
- **React hooks violation**: removed duplicate `useEffect` block in `DAOHome.tsx`

## [4.3.0] — 2026-02-27

### Added
- **GovDAO v3 data layer**: full support for tier-based governance (T1/T2/T3), memberstore parsing, vote power distribution
- **Tier distribution chart**: power bars with T1/T2/T3 color coding on DAO home and members pages
- **User status banner**: shows connected user's membership tier and voting power
- **Author cards**: proposal authors displayed with @username, avatar, and gno.land profile links
- **Tier-grouped vote breakdown**: vote results organized by T1/T2/T3 with VPPM weights and clickable voter @usernames
- **Tier filter tabs**: filter members by T1/T2/T3 on the members page
- **Power distribution badges**: tier badges on DAOList cards displaying member count and power
- **Vote percentage bars**: visual YES/NO gradient bars on proposal cards and detail views
- **Acceptance rate stat**: governance health metric on DAO home
- **Memberstore integration**: fetches tier data from GovDAO v3 memberstore realm

### Changed
- `lib/dao.ts`: complete rewrite with GovDAO v3 + basedao dual support (562 lines)
- `DAOProposal` type now includes `author`, `authorProfile`, `tiers`, `yesPercent`, `noPercent`
- `DAOMember` type now includes `tier`, `votingPower`, `username`
- `DAOConfig` type now includes `memberstorePath`, `tierDistribution`
- `buildVoteMsg` now targets GovDAO v3 `MustVoteOnProposalSimple` function

## [4.2.0] — 2026-02-27

### Added
- **DAO Hub** (`/dao`): multi-DAO browser with featured GovDAO card, "Connect to DAO" form, and localStorage persistence
- **Create DAO** (`/dao/create`): v5.0.0 placeholder with planned feature overview and docs links
- **Parameterized DAO routes**: all DAO sub-pages now use `/dao/:slug/*` URL params — supports multiple DAOs simultaneously
- **Dashboard DAO quick-action**: "🏛️ Explore DAOs" button in empty state and quick-actions
- **`lib/daoSlug.ts`**: URL slug encoding (`/` ↔ `~`), realm path validation, localStorage CRUD with schema validation

### Security
- **Slug traversal protection**: decoded slugs reject `..`, control chars, and non-`gno.land/r/` prefixes (C1)
- **localStorage schema validation**: each SavedDAO entry validated for string types and non-empty fields (H3)
- **Input validation**: realm path input limited to 100 chars with regex validation (M1)

### Fixed
- **Navigate-in-render fix**: `DAOHome.tsx` redirect wrapped in `useEffect` to avoid React state warnings (C2)

### Improved
- **Accessibility**: `aria-label` on all back navigation buttons across 7 pages (M2)
- **E2E test readiness**: `id` attributes on all interactive elements (`dao-connect-input`, `dao-connect-btn`, etc.) (M3)

## [4.1.0] — 2026-02-27

### Added
- **Treasury Management**: DAO treasury overview page
  - **Treasury overview** (`/dao/treasury`): asset grid with GRC20 token balances
  - **Propose Spend** (`/dao/treasury/propose`): submit spending proposals for DAO vote
  - **Asset table**: sortable list with per-token balance display
  - **Cross-navigation**: links to token views from treasury assets

## [4.0.0] — 2026-02-27

### Added
- **DAO Governance**: Full on-chain DAO management feature
  - **DAO Home** (`/dao`): stat cards, active/completed proposals, member preview grid
  - **Proposal Detail** (`/dao/proposal/:id`): vote tally visualization, Vote/Execute actions
  - **Members** (`/dao/members`): full member list with role badges, "YOU" indicator
  - **New Proposal** (`/dao/propose`): proposal creation form with character limits
  - **ABCI query helpers** (`lib/dao.ts`): getDAOConfig, getDAOMembers, getDAOProposals with JSON + markdown fallback
  - **MsgCall builders**: Vote(YES/NO/ABSTAIN), Execute, Propose via Adena DoContract
  - **🏛️ DAO nav link**: persistent navigation in Layout header
  - **DAO_REALM_PATH**: configurable via `VITE_DAO_REALM_PATH` env var

### Changed
- **Shared account helper** (`lib/account.ts`): extracted `fetchAccountInfo` from `CreateToken.tsx` and `ProposeTransaction.tsx`, upgraded to hardened JSON-RPC POST with address validation
- **ARCHITECTURE.md**: fixed "Tailwind v4" → "Vanilla CSS + Kodera design system"
- **README.md**: updated features to v3.0.0, added GRC20 Launchpad features
- **package.json**: bumped version from 2.0.3 → 3.0.0
- **ROADMAP.md**: updated v2.0.2 deferred items with current status

## [3.0.0] — 2026-02-26

### Added
- **GRC20 Launchpad**: Full token creation + management feature
  - **Create Token page** (`/create-token`): form with name, symbol, decimals, initial mint, faucet amount
  - **Admin selector**: create as personal wallet or assign multisig as admin
  - **Token Dashboard** (`/tokens`): lists all grc20factory tokens with user balances, admin badges, stat cards
  - **Token Detail** (`/tokens/:symbol`): metadata card, user balance, action tabs (Transfer, Mint, Burn, Faucet)
  - **Multisig GRC20 tabs**: Transfer/Mint/Burn/Approve tabs in ProposeTransaction for multisig governance
  - **5% platform fee**: automatic fee transfer on every mint, sent to samourai-crew multisig
  - **Fee disclosure banner**: transparent fee amount shown before transaction signing
  - **ABCI query helpers** (`grc20.ts`): listFactoryTokens, getTokenInfo, getTokenBalance via vm/qrender + vm/qeval
  - **Multi-msg TX builders**: atomic create + fee transfer in single transaction
  - **🪙 Tokens nav link**: persistent navigation in Layout header
  - **Dashboard quick action**: 🪙 Create a Token button (empty state + quick actions bar)

### Technical
- JSON-RPC POST for ABCI queries (more reliable than HTTP GET)
- `ResponseBase.Data` (not Value) for VM query responses
- Colon separator for vm/qrender, dot separator for vm/qeval (per Gno source)
- Input sanitization for ABCI query injection prevention
- `grc20factory` realm: `NewWithAdmin()` enables multisig admin governance

### Fixed
- **CORS preflight** (#13): Use wildcard `AllowedHeaders` to fix Fly.io proxy header canonicalization breaking `rs/cors` strict matching — origin restrictions still enforced
- **Proto format** (#14): Fix `buf format` whitespace in `TokenRequestInfo` (pre-existing CI lint failure)
- **CreateToken auth** (#15): Pass `authToken` in protobuf message body (was HTTP `Authorization` header — caused 401)
- **Adena DoContract** (#16): Replace broken `SignTx` (doesn't exist on `window.adena`) with `DoContract` for sign + broadcast — fixes CreateToken and TokenView
- **Token list regex** (#17): Handle escaped parentheses `\($SYMBOL\)` in `grc20factory` Render output — tokens now appear on `/tokens` page

## [2.0.3] — 2026-02-26

### Added
- **Network selector**: Switch between test11 (default) and portal-loop from header dropdown, persisted in localStorage
- **Shareable import links**: "Share Import Link" button generates `?pubkey=<base64>&name=<name>` URL for 1-click multisig onboarding
- **Auto-detect membership**: Dashboard discovers multisigs where user is a member but hasn't joined — with 1-click join button
- **CopyableAddress component**: Full address display with 📋 icon, 1-click copy to clipboard with ✓ feedback — used across all views
- **Inline multisig rename**: Click multisig name → edit → save (uses existing `CreateOrJoinMultisig` RPC, per-user naming)
- **Your Multisigs section**: Dashboard shows clickable card grid for joined multisigs
- **Discovered Multisigs section**: Amber-themed cards for not-yet-joined multisigs with join button
- **Local CI Checklist**: Added to git-policy workflow — `npm run build` + `lint` + `go test` before every push

### Fixed
- **Auth stale data (root cause)**: Layout now calls `auth.logout()` when wallet disconnects, clearing persisted localStorage token — prevents Dashboard from showing stale data on hard refresh without wallet
- **Broken import paths**: Fixed `../lib/txStatus` → `../components/ui/txStatus` and `../components/ui/Skeleton` → `../components/ui/LoadingSkeleton` in Dashboard (caused CI build failures)
- **Stat card count**: Shows joined multisig count only (was showing total including not-joined)

### Changed
- **Addresses everywhere**: All `truncateAddr` helpers removed (zero remaining) — replaced with `CopyableAddress`
- **DetailRow**: Accepts `ReactNode` for value prop (was `string` only)
- **Clickable logo**: "Memba" header text + logo link to home page
- **Social footer**: 7 Samourai Coop social icons (𝕏, IG, YT, GH, LI, TG, ✉)

## [2.0.2] — 2026-02-25

### Fixed
- **Adena connection**: Full end-to-end fix for wallet connect flow on live deployment
  - CSP: Added `wasm-unsafe-eval` + `unsafe-eval` to `script-src` for Adena's WebAssembly and crypto
  - Detection: Extended polling from 3s to 10s with `visibilitychange` + `load` event fallbacks
  - `ALREADY_CONNECTED`: Adena returns this as a failure status — now handled as success
  - `signArbitrary`: Rewrote to use `adena.Sign()` (the correct Adena API method from `inject.ts`)
- **ADR-036 incompatibility**: Adena returns `UNSUPPORTED_TYPE` for `sign/MsgSignData` — auth now skips client-side signing, relies on server challenge validation
- **Null publicKey crash**: Adena `GetAccount()` returns null pubkey for accounts without on-chain transactions — now gracefully falls back to address-only auth
- **API URL**: Added production fallback to `config.ts` when `VITE_API_URL` is unset
- **CORS**: Set `CORS_ORIGINS` on Fly.io to include `memba.samourai.app`

### Added
- **Address-only auth**: New `user_address` field in `TokenRequestInfo` proto — enables auth for wallets that don't expose public keys (Gno test11 + `RestrictedTransferError`)
- **`adena.Sign()` for TX signing**: `signArbitrary` now parses Amino sign docs and calls `adena.Sign()` with proper `messages`/`fee`/`memo` structure

### Changed
- **Auth flow**: Signature verification is now optional in `MakeToken` — when empty, server validates challenge + derives address from pubkey or trusts direct address
- **Debug cleanup**: Removed 22 diagnostic `console.log` statements from `useAdena.ts` and `Layout.tsx`

## [2.0.1] — 2026-02-25

### Added
- **`GetTransaction` RPC**: Direct single-TX lookup by ID — replaces O(n) list-and-find pattern
- **Cursor pagination**: `start_after` cursor for `Transactions` RPC (`t.id DESC`)
- **Centralized `APP_VERSION`**: Single source of truth in `config.ts` for header/footer badges

### Fixed
- **CI lint errors**: Removed unused `adena` (Dashboard), `SkeletonRow` (MultisigView), fixed `useCallback` deps (Layout)
- **Nonce tracker goroutine leak**: Replaced `init()` goroutine with context-aware `StartNonceTracker(ctx)` for clean shutdown
- **Docker frontend env vars**: Moved `VITE_*` from runtime `environment:` to build-time `args:` (Vite bakes env at build)
- **Broadcast TX structure**: Include multisig pubkey in `pub_key` field (was `null`), single combined signature entry
- **Version badges**: Updated from stale `v0.2.2` → `v2.0.1` in Layout header/footer, README, package.json
- **ROADMAP alignment**: v0.2.2 → ✅ COMPLETE, v1.0.0 DAO Governance → ⏳ DEFERRED to v3.0.0
- **E2E test doc**: Fixed health endpoint `/healthz` → `/health`, post-test tag version

### Removed
- Unused `useSearchParams` import from TransactionView (no longer needed with `GetTransaction`)

## [2.0.0] — 2026-02-24

### Added
- **Docker Self-Hosting**: `docker compose up` — backend (Go + SQLite) + frontend (Nginx) with health checks
- **Frontend Dockerfile**: Node 20 build → Nginx static serve with SPA fallback + 1y cache
- **CI/CD**: TypeScript type check (`tsc --noEmit`), Docker build verification job (4 CI jobs total)
- **Backend .env.example**: Documents all 4 required env vars

### Fixed (Final Audit)
- **MultisigView**: Fixed TS18048 `address` possibly undefined in config export download

## [1.2.0] — 2026-02-24

### Added
- **Activity Feed**: Tabbed Pending/Completed transaction views with counts on MultisigView
- **Shareable TX Links**: 'Share' button on TransactionView + 'Copy Shareable Link' on MultisigView
- **Completed TXs**: Fetches executed transactions in parallel alongside pending ones

## [1.1.0] — 2026-02-24

### Added
- **Generic TX Builder**: Tabbed ProposeTransaction with 'Send GNOT' (MsgSend) and 'Contract Call' (MsgCall) modes
- **MsgCall Support**: Package path, function name, comma-separated args, optional GNOT send amount
- **Config Export**: MultisigView 'Export Config' button downloads multisig config JSON for backup/sharing
- **Higher gas for calls**: Contract calls use 2M gas vs 100K for sends

## [0.4.0] — 2026-02-24

### Added
- **Export Unsigned TX**: Download sign doc as JSON for offline signing with gnokey
- **Manual Sig Paste**: Paste base64 gnokey signatures for air-gapped signers → SignTransaction RPC
- **Import via Pubkey JSON**: New tabbed import with 'By Pubkey JSON' mode — paste full Amino multisig pubkey to import/join

### Fixed (Audit)
- **TransactionView**: DRY refactored sign doc construction into `buildSignDoc()` helper (3 call sites → 1 function)
- **ImportMultisig**: Added per-pubkey item validation (type + value fields) in JSON import mode
- **ImportMultisig**: Migrated hardcoded bech32 prefix to `GNO_BECH32_PREFIX` config constant

## [0.3.0] — 2026-02-24

### Added
- **MultisigView**: Fetches real data from MultisigInfo + Transactions RPCs (threshold, balance, members, pending TXs)
- **ProposeTransaction**: Builds MsgSend JSON, fetches account info from chain, validates inputs, calls CreateTransaction RPC
- **Sign Transaction**: Builds Amino sign doc, calls Adena SignAmino, submits via SignTransaction RPC
- **Broadcast**: Sends signed TX to chain via RPC, records hash via CompleteTransaction RPC
- **CreateMultisig**: Fetches member secp256k1 pubkeys from chain via ABCI, builds Amino LegacyAminoPubKey JSON, creates via CreateOrJoinMultisig RPC
- **Manual pubkey paste**: Fallback for members without on-chain pubkeys (accounts that haven't sent a TX yet)

### Fixed (Audit Round 1)
- **CreateMultisig**: Fixed `fetchPubkey` stale closure — switched to functional `setState` pattern
- **TransactionView**: Reset `actionLoading` on signature rejection (early return bug)
- **TransactionView**: Error state now checks `auth.isAuthenticated` (was `adena.connected`)
- **ProposeTransaction**: Reduced default fee from 1 GNOT to 0.01 GNOT for testnet

### Changed (Audit Round 2)
- **Config centralization**: Created `lib/config.ts` — all env vars (×12 duplicates) now imported from single source
- Migrated 7 files from local `import.meta.env` reads to centralized config imports

## [0.2.2] — 2026-02-24

### Fixed
- **F1**: Auth bridge — wallet connect now auto-triggers challenge-response token flow
- **F4**: Import Multisig — wired to MultisigInfo → CreateOrJoinMultisig RPCs
- **F1-audit**: Fixed ClientMagic constant mismatch (frontend vs backend)
- **F1-audit**: Fixed challenge nonce/signature serialization (Uint8Array → base64 for protojson)
- **A1-audit**: Dashboard guards aligned to `auth.isAuthenticated` (was `adena.connected`)
- **A2-audit**: Fixed UGNOT conversion for amounts with exactly 6 digits in `parseMsgs`

### Changed
- Layout centralizes auth state via Outlet context (Dashboard + TransactionView migrated)
- LayoutContext extended with `auth.token`, `isAuthenticated`, `address`, `loading`, `error`
- Header shows "Authenticating..." state during challenge-response flow
- Auth error banner displayed on login failures with dismiss button
- Import page shows "Connect wallet" prompt when unauthenticated

### Documentation
- ARCHITECTURE.md: Fixed Tailwind note, service split table, added parseMsgs entry
- ROADMAP.md: Added v0.2.2 section, expanded v0.3.0 scope, updated timeline
- README.md: Updated version badge and architecture line
- Version badges: header + footer updated to v0.2.2

## [0.2.1] — 2026-02-24

### Security
- **P0-B**: `CompleteTransaction` now enforces `signatures >= threshold` before allowing finalization
- **P3-C**: Added `Content-Security-Policy` header to `netlify.toml`

### Fixed
- **P0-A**: `TransactionView` accepts `?ms=&chain=` query params to scope TX fetch
- **P1-A**: Dashboard state updates are atomic (all-or-nothing on `Promise.all`)
- **P1-B**: `SignTransaction` uses `ON CONFLICT UPDATE` instead of `INSERT OR REPLACE` (preserves `created_at`)
- **P1-C**: Removed dead `var _ *sql.DB` in `main.go`
- **P2-A**: Rate limiter GC goroutine stops cleanly on graceful shutdown (context-based)
- **P2-C**: `ErrorToast` deduplicates renders via `lastMessageRef`
- **P2-D**: Documented client-side token validation trade-off in `useAuth.ts`
- **P3-A**: Replaced `alert()` stubs with `console.warn` + `TODO(v0.3.0)` markers
- **P3-B**: Standardized all slog error contexts to `RpcName: operation` format

### Tests
- `TestTransactionLifecycle` updated with threshold-rejection assertion + 2nd signer

## [0.2.0] — 2026-02-24

### Added
- **TX detail page**: `/tx/:id` with parsed transaction content, real signers, fee/metadata
- **Msg parser**: Human-readable display for MsgSend (ugnot→GNOT), MsgCall, MsgAddPackage
- **TX history**: Dashboard shows live multisig count, pending TX count, and real balance
- **Status badges**: 4-state transaction badges (pending → signing → ready → complete)
- **Error toast**: Auto-dismiss error notifications with Kodera styling
- **Loading skeletons**: Shimmer cards and table rows during data fetch
- **Mobile responsive**: 3 breakpoints (768px tablet, 480px mobile, 375px iPhone SE)
- **Integration tests**: 11 service-level tests with in-memory SQLite harness
- **E2E test docs**: 7-section manual test checklist for samourai-crew flow

### Changed
- **Service split**: `service.go` (601 LOC) → 4 files: `service.go`, `auth_rpc.go`, `multisig_rpc.go`, `tx_rpc.go`
- **N+1 fix**: Batch signature loading in Transactions RPC (1 query instead of N)
- **Context wiring**: All SQL operations use `ctx` for cancellation/timeout support
- **Layout**: Version badge updated from MVP to v0.2

### Fixed
- **P0**: 7 bare `tx.QueryRow`/`tx.Exec` calls → context variants inside `sql.Tx`
- **P1**: `GetToken` no longer leaks internal error details to client
- **P3**: Shared `BadgeStatus` type, shared `LayoutContext`, removed unused `icon` field

## [0.1.1] — 2026-02-24

### Security
- **S1**: Persistent ed25519 keypair from `ED25519_SEED` env — tokens survive restarts
- **S2**: `internalError()` helper — 18 error leaks sanitized, no DB details to client
- **S3**: Address regex validation in `useBalance` — prevents ABCI URL injection
- **S4**: IP-based rate limiter (100 req/min) with GC goroutine
- **S5**: Challenge nonce deduplication (in-memory TTL set, 5-min replay window)
- **S6**: Input length limits: pubkey 4KB, msgs 100KB, fee 4KB, memo 256 chars

### Fixed
- **B1**: Removed unused `gcc musl-dev` from Dockerfile (CGO_ENABLED=0)
- **B2**: Added `rows.Err()` checks after all 3 row iteration loops
- **B3**: `splitOrigins` now trims whitespace from CORS origins
- **Adena detection**: Replaced sync `isInstalled()` with reactive polling (200ms × 15)
- **CI/CD**: Fixed Go version (1.23→1.24), committed proto stubs, fixed errcheck lint
- **ESLint**: Added `src/gen` to flat config `globalIgnores`, fixed TS2352 double assertion

### Added
- Auth token persistence via `localStorage` with 60s expiry check
- "Install Adena" fallback link when extension not detected
- Rate limiter middleware on ConnectRPC handler

### Docs
- Updated ARCHITECTURE.md, API.md, DEPLOYMENT.md, ROADMAP.md

## [0.1.0] — 2026-02-24

### Added
- **Auth**: ed25519 challenge-response with ADR-036 signature verification (8 tests)
- **Multisig CRUD**: CreateOrJoinMultisig, MultisigInfo, Multisigs (3 RPCs)
- **Transactions**: CreateTransaction, Transactions, SignTransaction, CompleteTransaction (4 RPCs)
- **Wallet**: Adena browser extension integration (connect, sign, disconnect)
- **Balance**: GNOT balance via ABCI query with 30s auto-refresh
- **Frontend**: Dashboard, CreateMultisig, ImportMultisig, MultisigView, ProposeTransaction, TransactionView
- **UI**: Kodera design system (dark mode, cyan accents, JetBrains Mono, dashed borders)
- **Infra**: Fly.io backend, Netlify frontend, SQLite WAL, CI/CD (7 checks)
