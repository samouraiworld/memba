# Changelog

All notable changes to Memba are documented here.

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
