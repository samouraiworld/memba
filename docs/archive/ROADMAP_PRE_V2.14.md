## v2.0-η — UX Audit Sprint ✅ SHIPPED (2026-03-07)

> 18-issue cross-perspective UX audit — 4 phases (A–D), P0–P3 fixes.

| Phase | Focus | Items |
|-------|-------|-------|
| A (P0) | ConnectingLoader gate fix | `<Outlet>` always renders, page-level guards, `isLoggingIn` context |
| B (P1) | Plugin routes, syncing timeout, footer | DAO-scoped plugin links, 10s timeout + retry, contrast/z-index fixes |
| C (P1) | Phosphor icon migration | `@phosphor-icons/react` replaces emoji across 6 files |
| D (P2) | UX polish | `.k-main` CSS, tier tooltips, `aria-live` on ConnectingLoader |

**Total: 360 tests (18 files). Zero lint/TS/build errors.**

---

## v1.7.0 — Governance UX & Testing ✅ SHIPPED (2026-03-05)

> Dual VoteBar redesign, Adena reconnect optimization, E2E test expansion, CI hardening.

| Category | Change | Tests |
|----------|--------|-------|
| 🐛 VoteBar Bug | Dual-bar: 3-color split (YES/NO/ABSTAIN) + quorum progress | — |
| 📊 Quorum | Participation % bar with 50% threshold marker | — |
| ⚡ Adena | Polling 10s→5s, GetNetwork() cached, "Syncing..." label | — |
| 🧪 E2E | 4 new spec files: navigation, profile, token, dao | +33 |
| 🔧 CI | Concurrency groups, Node 22 matrix, timeouts, failure artifacts | — |
| 🔧 Playwright | Firefox, screenshot-on-failure, video-on-retry | — |
| 🧹 Repo | 3 local + 7 remote stale branches pruned | — |

**Total: 285 tests (230 unit + 55 E2E). Zero lint/TS/build errors.**

---

## Open Source Readiness ✅ SHIPPED (2026-03-05)

> Repository hardened and prepared for public open-source launch.

| Category | Change | PR |
|----------|--------|----|
| 📄 Legal | `DISCLAIMER.md` — alpha status, liability, sponsor links | [#65](https://github.com/samouraiworld/memba/pull/65) |
| 💝 Funding | `.github/FUNDING.yml` — GitHub Sponsors for samouraiworld | #65 |
| 🏷️ UI | Amber "Alpha" badge in header (separate from version badge) | #65 |
| 🐙 UI | GitHub Octocat SVG icon in footer → links to repo | #65 |
| ⚠️ UI | Footer disclaimer with sponsor link | #65 |
| 📋 Docs | README alpha admonition + Disclaimer link | #65 |
| 📦 Repo | Package name `"frontend"` → `"memba"` | #65 |
| 🛡️ Security | Secret scanning + push protection enabled | Settings |
| 🛡️ Security | Tag protection ruleset (`v*` — restrict create/delete) | Settings |
| 🛡️ Security | Branch protection verified (5 CI checks, no bypass) | Settings |

**Total: 285 tests (230 unit + 55 E2E). Zero breaking changes.**

---

## v1.7.1 — UX Polish ✅ SHIPPED (2026-03-05)

> Dashboard guard, ProposalView quorum bar, docs refresh.

| Category | Change | Tests |
|----------|--------|-------|
| 🏠 Dashboard | Nav hidden when disconnected, `/dashboard` → `/` redirect | +1 E2E |
| 📊 Quorum | Quorum progress bar on ProposalView detail page (50% threshold) | — |
| 📋 Docs | README refresh (v1.7.1, badges, categorized features), ROADMAP, E2E_TEST updated | — |

**Total: 285 tests (230 unit + 55 E2E). Zero lint/TS/build errors.**

## v1.6.0 — UX Testing Fixes ✅ SHIPPED (2026-03-04)

> Based on Dadidou's UX testing report — 16 findings addressed across 5 batches.

| Category | Fixed | Tests |
|----------|-------|-------|
| P0 Critical Bugs | 4 (GitHub link, CTA guard, OAuth redirect, backend URL) | +7 |
| Navigation | 5 (Landing redirect, feature gates, back buttons, header label) | — |
| Rendering | 3 (heading strip, toast position, scroll-to-top) | +4 |
| UX Polish | 2 (pubkey hint, unlink GitHub) | — |
| Docs & Cleanup | Version bump, CHANGELOG, README, ROADMAP | — |

**Total: 230/230 tests, 0 lint errors, clean build. Zero breaking changes.**

---

## v0.1.0 — MVP: Multisig Wallet ✅ IMPLEMENTED

> First usable version for samourai-crew 3-of-7 on test11.

### Implementation Status

| Feature | Status | Branch |
|---------|--------|--------|
| Auth (ed25519 challenge-response + ADR-036) | ✅ 8/8 tests | `feat/mvp-auth` |
| Create/Join multisig (pubkey derivation) | ✅ | Branch 2 |
| Import multisig by address | ✅ | Branch 2 |
| Adena wallet connect | ✅ | Branch 3 |
| GNOT balance from test11 RPC | ✅ | Branch 3 |
| Propose send transaction | ✅ | Branch 4 |
| Sign transaction | ✅ | Branch 4 |
| Signature progress bar (K of N) | ✅ | Branch 4 |
| Broadcast + complete flow | ✅ Backend | Branch 4 |
| Pending transaction list | ✅ | Branch 4 |
| Kodera UI design system | ✅ | All branches |

### Remaining (pre-deploy)

- [x] Merge `feat/mvp-auth` → `main` (PR #1)
- [x] Deploy backend to Fly.io + verify health
- [x] Deploy frontend to Netlify + verify routes
- [ ] E2E test with samourai-crew multisig

### Post-release Review (Round 2 Audit)

18 findings — **all P0 and P1 resolved** in v0.1.1:

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 P0 | 4 | ✅ Fixed |
| 🟡 P1 | 7 | ✅ Fixed |
| 🟢 P2 | 5 | Deferred to v0.2.0 |

---

## v0.1.1 — Hardening (Audit Fixes) — ✅ SHIPPED 2026-02-24

> All P0 and P1 findings from the Round 2 audit resolved and deployed.

### Scope

| Fix | Audit ID | Severity |
|-----|----------|----------|
| Persistent ed25519 keypair from env | S1 | 🔴 P0 |
| Remove Dockerfile gcc/musl-dev | B1 | 🔴 P0 |
| Add `rows.Err()` after all iterations | B2 | 🔴 P0 |
| Wrap internal errors (no DB detail leaks) | S2 | 🔴 P0 |
| Validate address format in useBalance | S3 | 🟡 P1 |
| IP-based rate limiter on GetChallenge | S4 | 🟡 P1 |
| Challenge nonce dedup (in-memory TTL set) | S5 | 🟡 P1 |
| Input length limits (pubkey, msgs, memo) | S6 | 🟡 P1 |
| Fix splitOrigins whitespace trim | B3 | 🟡 P1 |
| Auth token persistence (localStorage) | F1 | 🟡 P1 |
| Verify Adena SignAmino format | F2 | 🟡 P1 |

### Acceptance Criteria
| # | Criterion |
|---|----------|
| 1 | Server restart → existing tokens still valid |
| 2 | Oversized payload → rejected with INVALID_ARGUMENT |
| 3 | `CORS_ORIGINS="a, b"` → both origins accepted |
| 4 | 200+ GetChallenge/s from same IP → rate limited |
| 5 | Page refresh → user stays authenticated |

---

## v0.2.0 — Polish & Essentials — ✅ SHIPPED 2026-02-24

### Scope

| Feature | Description |
|---------|-------------|
| TX history | Executed transactions with hash + timestamp + status badges |
| TX details | Human-readable transaction content (amount, recipient, memo) |
| Error handling | Graceful errors, retry logic, loading skeletons |
| Mobile responsive | Functional on mobile browsers (375px+) |
| Service split | `service.go` → `auth_rpc.go` + `multisig_rpc.go` + `tx_rpc.go` |
| Batch queries | Eliminate N+1 signature loading in Transactions |
| Context wiring | Pass `ctx` to all SQL operations |
| Integration tests | In-memory SQLite service tests |

### Acceptance Criteria
| # | Criterion |
|---|----------|
| 1 | Executed tx list shows hash, amount, date |
| 2 | Error toast on failed broadcast with actionable message |
| 3 | Dashboard usable on 375px width (iPhone SE) |
| 4 | `go test ./...` covers service + auth + db packages |

### Post-release Review
- 🔒 Input validation for addresses, threshold bounds
- 👤 Full mobile walkthrough (iPhone + Android Chrome)
- ⚙️ Bundle size audit, unused dependency removal

---

## v0.2.1 — Audit Hardening — ✅ SHIPPED 2026-02-24

Patch release: 12 audit findings resolved (2 P0, 3 P1, 4 P2, 3 P3).

| Fix | Impact |
|-----|--------|
| Threshold check in `CompleteTransaction` | **Critical** — prevents unauthorized finalization |
| CSP header | XSS defense-in-depth |
| Scoped TX fetch | Performance + reliability |
| Atomic Dashboard state | Race condition fix |
| ON CONFLICT preserves `created_at` | Audit log integrity |
| Goroutine shutdown via context | Clean shutdown |

---

## v0.2.2 — Auth Bridge & Import — ✅ COMPLETE

> Fix critical auth gap and wire import multisig.

### Scope

| Feature | Description |
|---------|-------------|
| Auth bridge | Connect Wallet → auto-trigger challenge-response → obtain token |
| Auth context | Centralize auth state in Layout, all pages use context |
| Import multisig | Wire ImportMultisig page to MultisigInfo → CreateOrJoinMultisig |
| Doc alignment | Fix ARCHITECTURE.md, footer version, commit pending edits |

### Deep Audit Findings (8 total)

| # | Finding | Severity | Resolution |
|---|---------|----------|------------|
| F1 | Missing auth bridge | 🔴 P0 | Fixed in v0.2.2 |
| F2 | 4/6 pages are stubs | 🔴 P0 | Import fixed; Create/Propose/View deferred to v0.3.0 |
| F3 | Sign + Broadcast buttons no-op | 🟡 P1 | Deferred to v0.3.0 |
| F4 | Import requires pubkey_json | 🟡 P1 | Path A (registered multisigs) in v0.2.2 |
| F5 | CSS imports Tailwind v4 | 🟢 P2 | Docs corrected |
| F6 | ARCHITECTURE.md stale | 🟢 P2 | Fixed |
| F7 | useMultisig hook unused | 🟢 P3 | Now used by ImportMultisig |
| F8 | Footer says v0.2.0 | 🟢 P3 | Fixed |

### Acceptance Criteria
| # | Criterion |
|---|-----------|
| 1 | Connect Wallet → Adena sign popup → Dashboard shows real data |
| 2 | Page refresh → user stays authenticated |
| 3 | Import registered multisig by address → join + redirect |
| 4 | ARCHITECTURE.md, README, ROADMAP, API docs all accurate |

---

## v0.3.0 — Page Wiring & Sign/Broadcast — ✅ COMPLETE

### Scope

| Feature | Description | Status |
|---------|-------------|--------|
| MultisigView real data | Fetch threshold, balance, members, pending TXs | ✅ |
| ProposeTransaction | Wire page to build MsgSend + CreateTransaction | ✅ |
| Sign transaction | Wire Sign button → Adena SignAmino → backend SignTransaction | ✅ |
| Broadcast | Combine multi-sig → broadcast to chain → CompleteTransaction | ✅ |
| CreateMultisig | Wire page to build multisig pubkey + CreateOrJoinMultisig | ✅ |
| Manual pubkey paste | Fallback for members without on-chain pubkeys | ✅ |

### Deferred to v0.4.0
- GRC20 balances & transfers

### Acceptance Criteria
| # | Criterion |
|---|-----------|
| 1 | Sign button → Adena popup → signature stored | ✅ |
| 2 | Broadcast → TX hash on chain → shown in UI | ✅ |
| 3 | Create new multisig from UI → on-chain + in dashboard | ✅ |
| 4 | Propose TX → TX created, pending in dashboard | ✅ |
| 5 | Multisig detail shows real data (members, balance, TXs) | ✅ |


### Post-release Review
- 🔒 Signature format validation, replay protection
- 👤 Air-gapped workflow test (no internet during signing)
- ⚙️ GRC20 token registry performance, caching strategy

---

## v0.4.0 — Air-Gapped Signing & Import — ✅ COMPLETE

### Scope

| Feature | Description | Status |
|---------|-------------|--------|
| Export unsigned TX | Download sign doc as JSON for gnokey | ✅ |
| Manual gnokey sig paste | Paste base64 signature from offline signer | ✅ |
| Import via pubkey JSON | Tabbed import with Amino pubkey JSON paste | ✅ |

### Deferred to v0.5.0+
- GRC20 balances & transfers (requires ABCI query patterns for realm state)

### Post-release Review
- 🔒 Signature format validation (base64 decode check)
- 👤 Air-gapped workflow end-to-end verified
- ⚙️ DRY refactored sign doc builder

---

## v1.0.0 — DAO Governance — ⏳ DEFERRED → v3.0.0

> Full on-chain DAO management via gnodaokit.

### Scope

| Feature | Description |
|---------|-------------|
| Deploy DAO realm | samourai-crew DAO on test11 via gnodaokit `basedao.New()` |
| Proposals UI | Create proposals (title + description + action) |
| Voting | yes / no / abstain with signal progress |
| Execution | Execute passed proposals |
| Members | List members with roles (admin/dev) |
| Admin: members | Add/remove members via governance proposal |
| Admin: roles | Assign/unassign roles |
| DAO profile | Edit DAO name, description, avatar |

### Acceptance Criteria
| # | Criterion |
|---|-----------|
| 1 | DAO deployed on test11 with 7 members, admin + dev roles |
| 2 | Create proposal → visible to all members |
| 3 | 4/7 vote yes → proposal status = "Passed" (51%) |
| 4 | Execute passed proposal → on-chain state change verified |
| 5 | Non-member cannot propose or vote |
| 6 | Admin proposes add-member → after approval, new member appears |

### Post-release Review
- 🔒 Realm permission audit, caller validation, role escalation prevention
- 👤 Full governance flow with 3 teammates
- ⚙️ Realm query performance, proposal pagination

---

## v1.1.0 — Realm Interactions — ✅ COMPLETE

| Feature | Description | Status |
|---------|-------------|--------|
| TX builder | Generic realm function call UI (any realm, any function) | ✅ |
| Multi-wallet | Manage multiple multisigs from one account | ✅ (Dashboard) |
| Config export/import | Backup multisig configuration | ✅ |

---

## v1.2.0 — Notifications & Collaboration — ✅ COMPLETE (frontend)

| Feature | Description | Status |
|---------|-------------|--------|
| Activity feed | Tabbed Pending/Completed TX views | ✅ |
| Shareable TX links | Direct link to pending tx with copy button | ✅ |
| Email notifications | Signature needed alerts | 🔜 (backend) |
| Webhook notifications | Custom integrations | 🔜 (backend) |

---

## v2.0.0 — On-Chain Coordination — ✅ COMPLETE (infra)

> Docker self-hosting + CI/CD pipeline.

| Feature | Description | Status |
|---------|-------------|--------|
| Docker self-hosting | `docker compose up` | ✅ |
| CI/CD pipeline | Automated lint, test, type check, Docker build | ✅ |
| Coordination realm | On-chain sig collection (no backend for sigs) | 🔜 (realm) |
| Hybrid mode | On-chain + off-chain fallback | 🔜 (realm) |
| E2E test suite | Testnet integration tests | 🔜 |
| PostgreSQL migration | Scale beyond SQLite | 🔜 |

---

## v2.0.2 — Adena Connection & Auth Fixes — ✅ COMPLETE

> Full end-to-end Adena wallet connection fix for live deployment.

| Finding | Root Cause | Fix |
|---------|-----------|-----|
| CSP blocks Adena WebAssembly | Missing `wasm-unsafe-eval`/`unsafe-eval` | Added to `netlify.toml` |
| Extension detection fails | 3s polling too short | Extended to 10s + event listeners |
| `ALREADY_CONNECTED` treated as error | Adena status quirk | Handle as success case |
| Auth signing fails | `sign/MsgSignData` unsupported by Adena | Skip ADR-036, challenge-only auth |
| Null pubkey crash | Account not on-chain yet | Address-only auth path |
| API URL empty on prod | `VITE_API_URL` unset on Netlify | Production fallback in `config.ts` |
| CORS rejection | `memba.samourai.app` not in origins | Set `CORS_ORIGINS` on Fly.io |

### Adena API Reference (from inject.ts source)

| Method | Purpose |
|--------|---------|
| `AddEstablish(name)` | Connect dApp to wallet |
| `GetAccount()` | Get address, pubkey, chainId |
| `Sign(tx)` | Sign without broadcast (auth/signing) |
| `DoContract(tx)` | Sign + broadcast on-chain |
| `SignTx(tx)` | Sign transaction |
| `CreateMultisigAccount(params)` | Create multisig |
| `SignMultisigTransaction(doc)` | Sign multisig TX |
| `BroadcastMultisigTransaction(doc)` | Broadcast multisig TX |

### Next Steps

- [ ] E2E test samourai-crew import (requires member wallet with on-chain pubkey)
- [ ] Re-enable ADR-036 signing when Adena adds support (blocked on Adena)
- [x] Test TX signing flow — verified end-to-end in v3.0.0
- [ ] Tighten CSP: remove `unsafe-eval` when Adena drops WebAssembly eval (blocked on Adena)

---

## v2.0.3 — Friction Reduction & UX — ✅ SHIPPED 2026-02-26

> Reduce multisig onboarding friction, improve address UX, fix auth stale data bug.

### Scope

| Feature | Description | Status |
|---------|-------------|--------|
| Network selector | test11 ↔ portal-loop switch with localStorage persistence | ✅ |
| Shareable import links | `?pubkey=<base64>&name=<name>` URL for 1-click onboarding | ✅ |
| Auto-detect membership | Dashboard discovers not-yet-joined multisigs, 1-click join | ✅ |
| CopyableAddress | Full address + 📋 1-click copy, replaces all truncateAddr | ✅ |
| Inline rename | Click multisig name → edit → save (per-user, backend-persisted) | ✅ |
| Clickable logo | Header Memba logo links to home | ✅ |
| Social footer | 7 Samourai Coop social icons | ✅ |
| Auth stale data fix | Layout clears token on wallet disconnect | ✅ |
| Local CI checklist | git-policy updated with required local checks | ✅ |

### Acceptance Criteria
| # | Criterion |
|---|-----------|
| 1 | Hard refresh without wallet → no multisig/TX data visible |
| 2 | Click any address → copied to clipboard with ✓ feedback |
| 3 | Share import link → recipient sees invite banner + 1-click import |
| 4 | Dashboard shows "Discovered Multisigs" for not-yet-joined memberships |
| 5 | Click multisig name → rename inline → saved in backend |
| 6 | `npm run build` + `lint` + `go test` pass before push |

---

## v2.1.0 — Treasury Management — ⬆ Moved to v4.1.0

> See v4.1.0 below.

---

## v3.0.0 — GRC20 Token Launchpad — ✅ IMPLEMENTED

> Create, manage, and govern GRC20 tokens from Memba — single user or multisig admin.

| Feature | Status |
|---------|--------|
| ABCI query helpers (`grc20.ts`) | ✅ |
| Create Token page (`/create-token`) | ✅ |
| Token Dashboard (`/tokens`) | ✅ |
| Token Detail (`/tokens/:symbol`) | ✅ |
| GRC20 tabs in ProposeTransaction | ✅ |
| 5% platform fee on mints | ✅ |
| Multisig admin governance | ✅ |
| Fee disclosure banner | ✅ |
| Dashboard quick action button | ✅ |
| Tokens nav link in header | ✅ |

---

## v3.1.0 — Multi-chain & Advanced

| Feature | Description |
|---------|-------------|
| IBC transfers | Cross-chain from multisig |
| Ledger support | Hardware wallet signing |
| i18n | Multi-language |

---

## v4.0.0 — DAO Governance — ✅ IMPLEMENTED

> Full on-chain DAO management: proposals, voting, execution, member management.

| Feature | Status |
|---------|--------|
| ABCI query helpers (`lib/dao.ts`) — config, members, proposals | ✅ |
| MsgCall builders — Vote, Execute, Propose | ✅ |
| JSON + markdown fallback parsing | ✅ |
| DAO Home page (`/dao`) — stats, proposals, member grid | ✅ |
| Proposal Detail (`/dao/proposal/:id`) — vote tally, vote/execute actions | ✅ |
| DAO Members page (`/dao/members`) — role badges, membership status | ✅ |
| Propose page (`/dao/propose`) — form with validation | ✅ |
| 🏛️ DAO nav link in header | ✅ |
| `DAO_REALM_PATH` config (env-configurable) | ✅ |
| Housekeeping: shared `lib/account.ts`, docs fixes | ✅ |

---

## v4.1.0 — Treasury Management — ✅ IMPLEMENTED

> DAO treasury overview and spending proposals.

| Feature | Status |
|---------|--------|
| Treasury overview page (`/dao/treasury`) — asset grid, GRC20 balances | ✅ |
| Propose Spend page (`/dao/treasury/propose`) — recipient, amount, token, memo | ✅ |
| Treasury quick-link card on DAO Home | ✅ |
| Cross-navigation to token views from assets | ✅ |

## v4.2.0 — DAO Hub (Multi-DAO Browser) — ✅ SHIPPED 2026-02-27

> Multi-DAO browser with parameterized routes and localStorage persistence.

| Feature | Status |
|---------|--------|
| DAO Hub (`/dao`) — featured GovDAO, connect form, saved DAOs | ✅ |
| Parameterized routes (`/dao/:slug/*`) — multi-DAO support | ✅ |
| `lib/daoSlug.ts` — URL slug encoding, realm path validation, localStorage CRUD | ✅ |
| Slug traversal protection (rejects `..`, control chars) | ✅ |
| Dashboard "🏛️ Explore DAOs" quick action | ✅ |

---

## v4.3.0 — GovDAO v3 Support — ✅ SHIPPED 2026-02-27

> Full GovDAO v3 tier-based governance: memberstore, tier distribution, VPPM-weighted votes.

| Feature | Status |
|---------|--------|
| GovDAO v3 data layer (T1/T2/T3 tiers, memberstore, VPPM weights) | ✅ |
| Tier distribution chart (power bars + percentages) | ✅ |
| Author cards (proposals show @username + profile link) | ✅ |
| Tier-grouped vote breakdown with VPPM per tier | ✅ |
| Tier filter tabs on members page | ✅ |
| Acceptance rate stat (governance health metric) | ✅ |

---

## v4.3.1 — GovDAO Data Sync + Usernames — ✅ SHIPPED 2026-02-27

> Fix all ABCI parser bugs + add address→@username resolution.

| Fix/Feature | Status |
|---------|--------|
| Memberstore link regex (handle full testnet URLs) | ✅ |
| Member parsing (ABCI pipe table format `\| T1 \| g1addr \|`) | ✅ |
| Pagination (fetch all pages via `?page=N`) | ✅ |
| Tier extraction inline from table rows | ✅ |
| `sanitize()` allow `?=&` for query params | ✅ |
| Address→@username resolution via `gno.land/r/gnoland/users/v1` | ✅ |
| Clickable @username links to gno.land profiles | ✅ |
| 17-perspective deep audit (0 critical/high/medium) | ✅ |

---

## v4.4.0 — Username Cache — ✅ SHIPPED 2026-02-27

> Cache resolved @usernames in localStorage with 1-hour TTL.

| Feature | Status |
|---------|--------|
| Username localStorage cache (1h TTL) | ✅ |
| Two-phase resolve (cache first, ABCI for misses) | ✅ |
| `readUsernameCache()` / `writeUsernameCache()` helpers | ✅ |

---

## v4.5.0 / v5.0.1 — Treasury Live Data — ✅ SHIPPED 2026-02-27

> GNOT balance via `bank/balances` ABCI query + GRC20 token balances.

| Feature | Status |
|---------|--------|
| GNOT balance via `bank/balances` | ✅ |
| GRC20 token balances via `grc20factory` | ✅ |
| Independent error handling (GNOT + GRC20) | ✅ |

---

## v5.0.0 — DAO Factory — ✅ SHIPPED 2026-02-27

> Create and deploy governance DAOs from the Memba UI via MsgAddPackage.

| Feature | Status |
|---------|--------|
| 4-step wizard (name → members → threshold → deploy) | ✅ |
| `daoTemplate.ts`: self-contained Gno realm code generator (~227 lines) | ✅ |
| MsgAddPackage deployment via Adena DoContract | ✅ |
| Realm path validation (gno.land/r/username/daoname) | ✅ |
| Auto-save deployed DAO to saved DAOs | ✅ |
| Code preview before deployment | ✅ |
| Address validation (39+ chars bech32, v5.0.1 fix) | ✅ |

---

## v5.2.0 — Advanced DAO Configuration — ✅ SHIPPED 2026-02-28

> Role-based governance, configurable presets, quorum enforcement, and proposal categories for the DAO Factory.

| Feature | Status |
|---------|--------|
| DAO Presets (Basic / Team / Treasury / Enterprise) | ✅ |
| Role system (admin, dev, finance, ops, member) | ✅ |
| Role assignment per member in creation wizard | ✅ |
| Admin-only `AssignRole` / `RemoveRole` functions | ✅ |
| Last-admin protection (cannot remove sole admin) | ✅ |
| Configurable quorum (0-100%) with slider UI | ✅ |
| Proposal categories (governance, treasury, membership, operations) | ✅ |
| Multi-select category UI with validation | ✅ |
| Role-aware Gno realm code generator | ✅ |
| Role badges in DAOMembers (color-coded) | ✅ |
| Role filter tabs in DAOMembers | ✅ |
| Category in ABCI proposal parser | ✅ |
| Backward-compatible with v5.0.x DAOs | ✅ |
| Footer email fix (support@samourai.coop) | ✅ |

---

## v5.2.1 — Crossing Fix + Archive DAO — ✅ SHIPPED 2026-02-28

> Critical fix: generated DAO code used wrong crossing syntax. Verified correct pattern from live GovDAO source on gno.land.

| Fix / Feature | Status | Notes |
|---------------|--------|-------|
| 🐛 **Proposal creation fails** — `crossing()` → `cur realm` | ✅ Fixed | `crossing()` doesn't exist in Gno. Correct: `func Name(cur realm, ...)` + `runtime.PreviousRealm().Address()` |
| 🐛 **Role badges truncated** on DAOHome | ✅ Fixed | `whiteSpace: nowrap` + `flexWrap: wrap` |
| ✨ **Archive DAO** — admin-only archival | ✅ Added | `Archive(cur realm)` + `IsArchived()` — blocks new proposals/votes |
| ✨ **Show member usernames** on DAOHome + DAOMembers | ✅ Done (v5.3.0) | `resolveUsernames()` in JSON + Render paths |
| ✨ **"Create your username" CTA** | ✅ Done (v5.3.0) | DAOHome card + DAOMembers inline link |
| 🐛 **Threshold display encoding** | ✅ Fixed (v5.3.0) | `TextDecoder` pipeline in `abciQuery()` |

---

## v5.3.0 — User Profiles + Archive UI + Polish — ✅ SHIPPED 2026-02-28

> User profiles with gnolove integration, archive DAO UI across all pages, username resolution, and encoding fixes.

| Feature | Status | Notes |
|---------|--------|-------|
| ✨ **User Profile pages** (`/profile/:address`) | ✅ | Hybrid data: gno.land (username), gnolove (GitHub stats, packages, votes) |
| ✨ **Gnolove integration** (`profile.ts`) | ✅ | 4 parallel fetches, 5s timeouts, graceful degradation |
| ✨ **👤 Profile nav link** in header | ✅ | Shown when wallet connected |
| ✨ **Clickable member addresses** → profile | ✅ | DAOHome + DAOMembers |
| ✨ **Archive DAO UI** — 4 pages | ✅ | Badge + warning + disabled actions on DAOHome, DAOList, ProposalView, ProposeDAO |
| ✨ **Username CTA** | ✅ | DAOHome card + DAOMembers inline link |
| ✨ **Username resolution** for custom DAOs | ✅ | JSON + Render-fallback code paths |
| 🐛 **UTF-8 encoding fix** | ✅ | `TextDecoder` replaces `atob()` in `abciQuery()` |
| 🐛 **Render separator** `—` → `\|` | ✅ | Prevents future encoding issues |
| 📄 **Documentation** updated | ✅ | CHANGELOG, ROADMAP, ARCHITECTURE, E2E_TEST |

---

## v5.4.0 — Profile Phase 2 (Editable Profiles) — ✅ SHIPPED 2026-02-28

> Backend-persisted profile editing via ConnectRPC + SQLite. Edit bio, company, title, avatar, socials directly from the profile page.

| Feature | Status | Notes |
|---------|--------|-------|
| ✨ **GetProfile RPC** (public read) | ✅ | Returns empty profile for unknown addresses |
| ✨ **UpdateProfile RPC** (auth write) | ✅ | Token address must match profile, sanitized inputs |
| ✨ **SQLite `profiles` table** | ✅ | Migration `002_profiles.sql`, address PK |
| ✨ **Profile edit UI** | ✅ | 7-field form, character counters, save/cancel |
| 🔒 **Server-side sanitization** | ✅ | HTML strip, length limits, URL validation |
| ✨ **Backend data merge** in `profile.ts` | ✅ | Parallel fetch, backend overrides gnolove defaults |
| 📄 **Documentation** | ✅ | CHANGELOG, ROADMAP, ARCHITECTURE, E2E_TEST |

---

## v5.5.0 — Link GitHub CTA — ✅ SHIPPED 2026-02-28

> "Link your GitHub" CTA on own profile when no GitHub is linked — redirects to gnolove.world for OAuth + on-chain verification.

| Feature | Status | Notes |
|---------|--------|-------|
| ✨ **Link GitHub CTA card** | ✅ | Blue-themed card on own profile, opens gnolove.world |
| 📄 **Documentation** | ✅ | CHANGELOG, E2E_TEST |
| 🔍 **Cross-perspective audit** | ✅ | CTO, Security, UX, Engineering — all pass |

---

## v5.7.0 — Production Bug Fixes — ✅ SHIPPED 2026-02-28

| Fix | Status |
|-----|--------|
| 🐛 Username registration (args + regex) | ✅ |
| 🐛 GitHub verify (ghverify 404 → backend) | ✅ |
| 🐛 Avatar CORS (referrerPolicy) | ✅ |
| 🐛 `/u/username` black screen (route + resolve) | ✅ |
| 🎨 Members list UX (username first, truncated addr) | ✅ |
| 🎨 Vote status badges (voted/pending) | ✅ |

---

## v6.0.0 — Hardening & Public Readiness — ✅ SHIPPED 2026-03-02

> Comprehensive hardening: CI security scanning, OAuth CSRF, Go 1.25, community files, branch protection.

| Feature | Status |
|---------|--------|
| ✨ OAuth CSRF protection (256-bit state tokens, one-time-use, 10min TTL) | ✅ |
| ✨ CI security scanning (`govulncheck` + `npm audit` + golangci-lint v2) | ✅ |
| ✨ Community files (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT) | ✅ |
| ✨ Dependabot (weekly Go + npm dep updates) | ✅ |
| ✨ CODEOWNERS + issue templates | ✅ |
| ✨ ErrorBoundary (React error boundary with fallback UI) | ✅ |
| 🔒 GO-2026-4559 fixed (`golang.org/x/net` v0.51.0) | ✅ |
| 🔒 10 errcheck violations fixed | ✅ |
| 🔒 `io.ReadAll` bounded with `io.LimitReader` (1 MB) | ✅ |
| 🔒 `npm audit` CI now fails on real production vulns | ✅ |
| 🔒 Branch protection on `main` (PR + review + CI + no force push) | ✅ |
| ⬆️ Go 1.24 → 1.25 (go.mod, ci.yml, deploy-backend.yml, Dockerfile) | ✅ |
| ⬆️ golangci-lint v2 via `go install` (Go 1.25 compat) | ✅ |
| 📄 All docs updated (README, CONTRIBUTING, DEPLOYMENT, CHANGELOG) | ✅ |
| 🧪 Vitest unit tests — 34 tests (parseMsgs, daoSlug, config) | ✅ |
| 🧪 Playwright E2E — 5 smoke tests (core routes) | ✅ |
| 🧪 Backend OAuth state store tests (5 tests) | ✅ |
| 🔒 gosec SAST — Go security scanner in CI (push/PR/weekly) | ✅ |
| 📛 Security badge in README | ✅ |

---

## v8.0.0 — Bug Fixes, UX Polish & Dashboard Hub — ✅ SHIPPED 2026-03-03

> 10 critical bug fixes, syntax highlighting, dashboard redesign. Tests: 167→189 (+22).

| Feature | Status |
|---------|--------|
| 🐛 Username placeholder fix (`anonymous-user` grey) | ✅ |
| 🐛 Faucet link for insufficient tokens | ✅ |
| 🐛 Instant avatar display (optimistic UI) | ✅ |
| 🐛 GitHub OAuth fix (deferred save on disconnect) | ✅ |
| 🐛 GNOT balance fix (JSON-RPC POST rewrite) | ✅ |
| 🐛 Token creation success flow (animated view + retry) | ✅ |
| 🐛 Proposal infinite loading (try-catch + 3 render paths) | ✅ |
| 🐛 Execute button guard (`isMember` check) | ✅ |
| ✨ GnoCodeBlock syntax highlighter (no deps) | ✅ |
| ✨ Dashboard Identity Card + enhanced quick actions | ✅ |
| 🧪 `gnoCodeBlock.test.ts` — 15 tokenizer tests | ✅ |
| 🧪 `balance.test.ts` — 7 formatting tests | ✅ |

---

## v9.0.0 — DAO Governance UX & Vote Intelligence — ✅ SHIPPED 2026-03-03

> Lazy vote enrichment, hasVoted detection, filter tabs, vote summary bar, dashboard avatar.

| Feature | Status |
|---------|--------|
| 📊 Lazy vote % on proposal cards (progressive loading) | ✅ |
| ✓ VOTED / ⏳ VOTE badges on proposal cards | ✅ |
| 🔍 Filter tabs: All / Needs My Vote / Voted | ✅ |
| 📈 Enhanced vote summary bar (YES/NO/ABSTAIN %) | ✅ |
| 🐛 hasVoted detection fixed (username + address matching) | ✅ |
| 🐛 Vote buttons hidden after voting | ✅ |
| 🖼️ Dashboard avatar from backend profile | ✅ |
| 🏷️ APP_VERSION → v9.0.0 | ✅ |

---

## v7.0.0 — Testing, Code Quality & Infrastructure — ✅ SHIPPED 2026-03-03

> 11-perspective cross-audit, testing infrastructure, documentation fixes, code organization.

| Feature | Status |
|---------|--------|
| 🔍 11-perspective cross-audit (43 findings) | ✅ |
| 🧪 `dao.test.ts` — 40 unit tests for ABCI parser + message builders | ✅ |
| 🧪 `grc20.test.ts` — 25 unit tests for fee calc + msg builders | ✅ |
| 🧪 `daoTemplate.test.ts` — 40 unit tests for code gen + injection | ✅ |
| 🧪 `profile.test.ts` — 15 unit tests for merge logic + score calc | ✅ |
| 📄 Fix README + ARCHITECTURE "Tailwind" → "Vanilla CSS" | ✅ |
| 📄 Fix ROADMAP version ordering | ✅ |
| ♻️ Extract `parseMembersFromRender`, `parseMemberstoreTiers` (DRY) | ✅ |
| ♻️ Export internal test functions via `_` prefix convention | ✅ |
| ♻️ Split `dao.ts` into sub-modules | ✅ |
| ♻️ Split `CreateDAO.tsx` into wizard steps | ✅ |
| 🔒 DAO template injection audit + sanitization | ✅ |
| 🔒 Parameterize bech32 prefix for mainnet | ✅ |
| 🎨 Onboarding wizard for new users | ✅ |
| ⚡ Progressive loading (DAOHome + DAOList) | ✅ |
| 🗺️ Centralised error mapping layer | ✅ |
| 🔧 Stale chunk auto-recovery (ErrorBoundary) | ✅ |
| 💾 DAO wizard draft persistence (localStorage) | ✅ |
| 🏗️ Health monitoring + SQLite backup | ✅ |
| 📥 TX history CSV export | ✅ |

---

## v10.0.0 — Governance Intelligence & Docs Polish — ✅ SHIPPED 2026-03-03

> Voter turnout, status label clarity, docs polish.

| Feature | Status |
|---------|--------|
| 📊 Voter turnout display ("12 of 17 voted (71%)") | ✅ |
| 🏷️ Status label: ACCEPTED → PASSED + "⚡ Awaiting execution" | ✅ |
| 🐛 Vote % bars fallback from voter counts (GovDAO format fix) | ✅ |
| 📄 README updated v7→v9, 167→189 tests | ✅ |
| 📄 ROADMAP ordering fixed (v8→v9) | ✅ |

---

## v1.0.0 — First Public Release 🎉 — ✅ SHIPPED 2026-03-03

> Version reset from v10.0.0 → v1.0.0 for clean open-source versioning. All development versions consolidated.

| Change | Status |
|--------|--------|
| 🏷️ APP_VERSION → 1.0.0 | ✅ |
| 📦 package.json version → 1.0.0 | ✅ |
| 📄 README "Features (v1.0.0)" | ✅ |
| 📋 CHANGELOG: consolidated release highlights | ✅ |

---

## v1.1.0 — Proposal Categories & Polish — ✅ SHIPPED 2026-03-03

> Category picker on ProposeDAO, GovDAO-aware, demo link in README.

| Feature | Status |
|---------|--------|
| 🏷️ Proposal category picker (governance, treasury, membership, operations) | ✅ |
| 🏛️ GovDAO-aware category hiding | ✅ |
| 🌐 Live demo link in README | ✅ |
| ♻️ `isGovDAO` exported from builders.ts | ✅ |

---

## v1.2.0 — RPC Domain Validation 🛡️ — ✅ SHIPPED 2026-03-03

> Security hardening: trusted domain allowlist prevents spoofed RPC URLs.

| Feature | Status |
|---------|--------|
| 🛡️ `isTrustedRpcDomain()` + `TRUSTED_RPC_DOMAINS` allowlist | ✅ |
| 🛡️ Red SECURITY WARNING banner for untrusted RPC | ✅ |
| 🧪 8 new security tests (197 total) | ✅ |

---

## v1.5.0 — Hardening & GovDAO UX — ✅ SHIPPED 2026-03-04

> Vote freshness fixes, page decomposition, CSP fix, GovDAO UX improvements.

| Feature / Change | Status |
|---------|--------|
| P0: CSP blocking wallet connection (dual-policy fix) | ✅ |
| 5 vote/proposal freshness bugs fixed (ABSTAIN, stale data, race conditions) | ✅ |
| ProfilePage decomposition (814 → 464 LOC, 3 new components) | ✅ |
| DAOHome decomposition (704 → 450 LOC, 3 new components) | ✅ |
| ProposalView decomposition (604 → 512 LOC, 1 new component) | ✅ |
| 7 lint fixes (4 errors + 3 warnings → 0/0) | ✅ |
| Collapsible Proposal History | ✅ |
| Red dot on DAO cards (per-card unvoted indicator) | ✅ |
| Source transparency links (`</>` icon → gno.land explorer) | ✅ |
| Acceptance Rate → Avg Voter Turnout | ✅ |
| Total Power → Voting Power (label rename) | ✅ |

---

## v1.4.0 — UX Optimization — ✅ SHIPPED 2026-03-03

> Redesign logged-out landing, connected dashboard, DAO page hierarchy, and proposal extensibility.

| Feature / Change | Status |
|---------|--------|
| Landing page redesign (3 feature showcase cards for logged-out users) | ✅ |
| Activity Hub (Action Required strip + Quick Vote widget on Dashboard) | ✅ |
| Feature Cards grid (Multisig/DAO/Token with counts + CTAs) | ✅ |
| DAO page hierarchy (DAO grid first, Connect form collapsed) | ✅ |
| DAO Action Required banner + summary line | ✅ |
| Multisig Action Required banner (unsigned TX count) | ✅ |
| Proposal type selector (Text active, 3 future types disabled) | ✅ |
| MsgCall source code preview on ProposeDAO | ✅ |
| Vote scanner extension (`scanUnvotedProposalDetails`) | ✅ |
| `useUnvotedProposals` hook with `refresh()` callback | ✅ |
| CreateToken placeholders neutralized | ✅ |
| CSS utility classes: `.k-action-banner`, `.k-feature-grid` | ✅ |
| Mobile responsive (480px/375px) for new components | ✅ |

---

## v1.3.1 — RPC Domain Security Fix v2 🛡️ — ✅ SHIPPED 2026-03-03

> Critical: v1.2.0 fix was a self-check. Real fix validates Adena's actual RPC via GetNetwork().

| Feature | Status |
|---------|--------|
| 🛡️ `adena.GetNetwork()` → validate wallet RPC URL | ✅ |
| 🚫 Block `DoContract` writes when RPC untrusted | ✅ |
| 📡 `changedNetwork` real-time re-validation | ✅ |
| 🔴 Security banner with CTA + malicious URL display | ✅ |
| 🧪 3 new tests (200 total) | ✅ |

---

## v1.3.0 — Notification & Vote History 🗳️ — ✅ SHIPPED 2026-03-03

> Unvoted proposal notification dot, enhanced My Votes, and Adena auto-reconnect fix.

| Feature | Status |
|---------|--------|
| 🔴 Pulsing notification dot on 🏛️ DAO nav (unvoted proposals) | ✅ |
| 🗳️ Enhanced "My Votes" on own profile (cross-DAO, filter tabs) | ✅ |
| 🔧 Adena auto-reconnect on page refresh (`sessionStorage`) | ✅ |
| ⚡ Shared `voteScanner.ts` utility (5×5 cap, cache, rate limit) | ✅ |
| 🧹 Cache invalidation after voting (`clearVoteCache()`) | ✅ |

---

## v5.6.0 — Profile & UX Polish — ✅ SHIPPED 2026-02-28

> Critical bug fixes: GovDAO membership detection, avatar rendering, GitHub icon.

| Fix | Status | Notes |
|-----|--------|-------|
| 🐛 **GovDAO membership bug** | ✅ | ProposalView now passes `memberstorePath` for tier-based DAOs |
| 🐛 **Avatar rendering** | ✅ | `<img>` tag with `onError` fallback replaces CSS `url()` |
| 🎨 **GitHub SVG icon** | ✅ | Proper Invertocat SVG replaces 🐙 emoji |
| 🔗 **Native GitHub OAuth** | ✅ | Backend proxy + GithubCallback page + ghverify MsgCall |
| 🏷️ **In-app username registration** | ✅ | Inline MsgCall form to `users/v1:Register` |

---

## v5.0.4 — DAO Deploy Fix (std → chain/runtime) — ✅ SHIPPED 2026-02-27

> Fix DAO deployment by migrating from deprecated `std` stdlib to `chain/runtime` (gno PR #4040).

| Fix / Feature | Status |
|---------|--------|
| `std` → `chain/runtime` migration (all 10 usages) | ✅ |
| `gnomod.toml` with `gno = "0.9"` | ✅ |
| Files sorted alphabetically (ValidateBasic) | ✅ |
| Gas fee bumped to 10 GNOT | ✅ |
| Storage deposit set to 10 GNOT | ✅ |
| 2 GNOT dev fee → samourai-crew wallet | ✅ |
| Verified on test11 via `gnokey` (height 401999) | ✅ |

---

## v5.1.0 — Advanced Governance

| Feature | Description | Status |
|---------|-------------|--------|
| Proposal creation from UI | Full form → MsgCall | ⬜ Planned |
| Real-time updates | Polling for vote status during active proposals | ✅ SHIPPED (v5.0.3) |
| Notification system | Alerts for new proposals | ⬜ Planned |
| Multi-chain | Mainnet + portal-loop + staging support | ✅ SHIPPED (v5.0.2 — staging + chain mismatch) |

---

## v2.x — Roadmap (PM/CTO Planning Session — 2026-03-05)

> Consolidated vision for Memba v2.x. Scoped milestones, AAA quality, perfect execution per step.
> Planning tracker: see [MASTER_ROADMAP.md](docs/planning/MASTER_ROADMAP.md).

### Shipped Features (prior brainstorm items)
- ~~**User Profiles**: profile pages, gnolove integration, editable profiles, GitHub CTA~~ → v5.3.0–v5.5.0
- ~~**Proposal Categories**: governance, treasury, membership, operations~~ → v5.2.0
- ~~**Vote Intelligence**: turnout, progress bars, filter tabs, VOTED badges~~ → v9.0.0
- ~~**Notification dots**: pulsing badges for unvoted proposals~~ → v1.3.0

---

### Architectural Decisions (resolved via cross-perspective audit)

| Decision | Outcome | Audit |
|----------|---------|-------|
| **Plugin deployment** | Option A: separate realms per plugin (isolation, independent audits) | 11 perspectives |
| **Notifications** | On-chain board-based activity feed (no backend, no PII) | 11 perspectives |
| **Monetisation** | Phased freemium: Free → Soft limits → On-chain subscription realm | 22 perspectives |
| **MsgRun vs MsgCall** | gnodaokit helper functions (`ProposeAddMember`, etc.) work with MsgCall ✅ | Code audit |
| **Boards package** | Track HEAD, pin for milestones, abstract behind adapter | Git history audit |

---

### v2.0-α — Foundation ✅ SHIPPED

> Plugin architecture, deployment UX, Add/Remove Member proposals.

| Feature | Description | Priority |
|---------|-------------|----------|
| 🔌 Plugin architecture | `plugins/` directory, manifest schema, lazy loader, DAOHome plugin tabs | 🟢 High |
| 🚀 Deployment Pipeline | `<DeploymentPipeline>` animated stepper for all deploy flows | 🟢 High |
| 👥 Add Member proposal | UI form → `ProposeAddMember(addr, roles)` MsgCall | 🟢 High |
| 👥 Remove Member proposal | Confirmation dialog → `ProposeRemoveMember(addr)` MsgCall | 🟢 High |

---

### v2.0-β — Board ✅ SHIPPED

> DAO Board Plugin Phase 1: on-chain discussion, token-gated access.

| Feature | Description | Priority |
|---------|-------------|----------|
| 💬 Board realm generator | `boardTemplate.ts` — generate per-DAO board realm using `gno.land/p/gnoland/boards` | 🟢 High |
| 💬 Board UI | Channel view, thread list, new post form, markdown preview | 🟢 High |
| 🔒 Token-gated writes | gnodaokit `MembersViewExtension.IsMember()` check in board realm | 🟢 High |
| 🔗 DAO Factory integration | Optional Board deployment in wizard Step 3 | 🟡 Medium |

---

### v2.0-γ — Swap ✅ SHIPPED

> GnoSwap integration Plugin Phase 1: treasury swap via governance proposal. Partnership with [Onblocs](https://github.com/gnoswap-labs/gnoswap).

| Feature | Description | Priority |
|---------|-------------|----------|
| 🔄 GnoSwap queries | ABCI query helpers for pool info, token prices (TWAP) | 🟢 High |
| 🔄 Swap MsgCall builders | `SwapRoute` builder with slippage protection | 🟢 High |
| 🔄 Swap proposal UI | Token selector, amount, slippage, preview → governance proposal | 🟢 High |
| 💰 Treasury integration | "Swap" tab in Treasury for DAO members | 🟡 Medium |

---

### v2.0-δ — Polish ✅ SHIPPED

> Leaderboard, Settings, Memba Feedback Feed, Network info.

| Feature | Description | Priority |
|---------|-------------|----------|
| 🏆 Leaderboard plugin | Sortable contributor table, gnolove + vote data, visual podium | 🟡 Medium |
| ⚙️ Settings page | Network, appearance, security, data export, advanced sections | 🟡 Medium |
| 📣 Feedback Feed | `r/samcrew/memba_feedback` board realm — eat-your-own-dogfood | 🟡 Medium |
| 🌐 Network info | Basic chain status, block height, latest block time | 🔵 Low |

---

### v2.0-ζ — Sidebar Navigation + Sentry ✅ SHIPPED 2026-03-07

> Vercel-inspired sidebar navigation, mobile tab bar, Sentry integration, betanet config.

| Feature | Status |
|---------|--------|
| 📐 Sidebar (3-section: nav, plugins, user) | ✅ |
| 🔝 TopBar (badges, network, wallet, security banners) | ✅ |
| 📱 Mobile TabBar (5 tabs + bottom sheet More) | ✅ |
| 📋 BottomSheet (slide-up modal with a11y) | ✅ |
| ♿ Skip-to-content link | ✅ |
| 🔄 Layout.tsx refactor (419→205 LOC) | ✅ |
| 🌐 Betanet network config + getUserRegistryPath() | ✅ |
| 🪲 Sentry integration (PII scrubbing, source maps) | ✅ |
| 🧪 E2E migration (header→sidebar, 9→17 tests) | ✅ |

**Quality gates:** TS 0 | Lint 0 | 360/360 tests | Build 496KB

---

### v2.1 — Intelligence ✅ SUPERSEDED

> v2.1a (Community Foundation) and v2.1b (Validators & Notifications) shipped. Remaining items moved to v3.0+.

| Feature | Description | Status |
|---------|-------------|--------|
| 🔄 GnoSwap Phase 2 | LP positions, portfolio view, on-chain position NFT display | 🔮 DEFERRED |
| 💬 Board Phase 2 | Multi-channel, `#proposal-N` auto-channels, @mentions | ✅ DONE (v2.5) |
| 💰 Payroll plugin | Payment configs, batch MsgSend, payment history, CSV export | 📋 PLANNED |
| 🔔 Webhook notifications | Optional Discord/Slack/Telegram relay (off-chain, opt-in) | 📋 PLANNED |
| 🌍 i18n | FR/EN with `react-intl` | 📋 PLANNED |

---

### v2.2+ — Revenue ⬜ PLANNED

| Feature | Description | Priority |
|---------|-------------|----------|
| 💳 Subscription realm | `r/samcrew/memba_subscription` — tier management + on-chain payment | 🟡 Medium |
| 🔐 Tier enforcement | ABCI query `GetTier(addr)` → enforce plugin limits on-chain | 🟡 Medium |
| 📊 DAO Analytics | Pure frontend aggregation dashboard | 🔵 Low |

#### Freemium Tiers

| | Free | Pro (~5 GNOT/mo) | Enterprise (~20 GNOT/mo) |
|---|------|------|------|
| DAOs | 1 (Basic preset) | Unlimited, all presets | Unlimited + custom |
| Plugins | Board (#general) | All plugins | All + priority support |
| Members | Up to 7 | Up to 50 | Unlimited |
| Token fee | 5% | 3% | 1% |
| GnoSwap | ❌ | ✅ | ✅ + advanced |
| Payroll | ❌ | Up to 10 | Unlimited |

---

### v3.0+ — Horizon ⬜ FUTURE

| Feature | Status |
|---------|--------|
| 🎙️ Voice/Video channels (WebRTC, suitenumerique/meet) | R&D |
| 🔗 On-chain signature coordination (remove backend dependency) | Blocked on realm dev |
| 🔐 Ledger hardware wallet | Blocked on Adena support |
| 🌉 IBC transfers | Blocked on Gno IBC maturity |
| 📅 Calendar, Task Board, NFT Badges | Community-driven plugins |
| ⚖️ Delegation system | Needs on-chain voting power delegation |

---

### Proposal Type Extensibility

> gnodaokit provides the full on-chain Action infrastructure. Memba generates **helper functions** in each DAO realm for MsgCall compatibility (no MsgRun needed).

| Proposal Type | On-Chain API | Memba Helper Function | Target |
|--------------|-------------|----------------------|--------|
| 👥 **Add Member** | ✅ `basedao.NewAddMemberAction` | `ProposeAddMember(addr, roles)` | v2.0-α |
| 👥 **Remove Member** | ✅ `basedao.NewRemoveMemberAction` | `ProposeRemoveMember(addr)` | v2.0-α |
| 🏷️ **Assign Role** | ✅ `basedao.NewAssignRoleAction` | `ProposeAssignRole(addr, role)` | v2.0-α |
| ✏️ **Edit Profile** | ✅ `basedao.NewEditProfileAction` | `ProposeEditProfile(field, value)` | v2.1 |
| 💰 **Treasury Spend** | ⚠️ Needs `ExecuteLambda` Action | Amount/recipient form + MsgSend | v2.1 |
| ⚙️ **Code Upgrade** | ⚠️ Needs `MsgAddPackage` Action | In-app code editor | v3.0+ |

---

### Chain Timeline

| Chain | Target | Memba Milestone |
|-------|--------|----------------|
| test11 | Current | v2.0-α, v2.0-β dev + testing |
| Betanet | Next week (2026-03-12) | v2.0-α, v2.0-β ready |
| Mainnet | ~April 2026 | v2.0-γ (GnoSwap) live |

---

## CHANGELOG Convention

All changes follow [Keep a Changelog](https://keepachangelog.com/) + [Semantic Versioning](https://semver.org/):

```markdown
## [v0.1.0] - YYYY-MM-DD
### Added
- Multisig import by address
- Adena wallet connection
- GNOT balance display
- Transaction proposal and signing
- Signature tracking with progress bar
- Transaction broadcast and completion
- Challenge-response authentication
- Dark mode dashboard UI
```

