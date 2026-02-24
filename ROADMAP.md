# Memba — Product Roadmap

> Versioned roadmap for Memba, the standalone Gno multisig & DAO wallet.
> Each version includes scope, acceptance criteria, engineering gates, and cross-perspective review checkpoints.

---

## Methodology

Every version follows these gates before release:

| Gate | What happens | Deliverable |
|------|-------------|-------------|
| **1. RFC** | Scope lock, acceptance criteria defined | Scope doc approved by zooma |
| **2. Design Review** | Architecture, API, DB changes reviewed | Updated `ARCHITECTURE.md` / proto files |
| **3. Implementation** | Code + tests + PR reviews | Merged PRs, lint-clean |
| **4. QA Gate** | All acceptance criteria verified | Test report + security checklist |
| **5. Release Gate** | CHANGELOG + tag + deploy + verify | Production-verified release |

After each release, a **Cross-Perspective Review** is conducted:

| Lens | Focus |
|------|-------|
| 🔒 Security | Auth, key handling, input validation, CORS, rate limits |
| 👤 UX | Clarity, latency, error messages, accessibility, mobile responsiveness |
| ⚙️ Engineering | Code quality, test coverage, performance, tech debt, documentation |

Review findings feed into the **next version's RFC** as action items.

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

## v0.2.2 — Auth Bridge & Import — 🚧 IN PROGRESS

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

## v1.0.0 — DAO Governance

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

## v1.2.0 — Notifications & Collaboration

| Feature | Description |
|---------|-------------|
| Email notifications | Signature needed alerts |
| Webhook notifications | Custom integrations |
| Activity feed | Audit log of all actions |
| Shareable TX links | Direct link to pending tx |

---

## v2.0.0 — On-Chain Coordination

> Eliminate backend for signature coordination.

| Feature | Description |
|---------|-------------|
| Coordination realm | On-chain sig collection (no backend for sigs) |
| Hybrid mode | On-chain + off-chain fallback |
| Docker self-hosting | `docker compose up` |
| E2E test suite | Testnet integration tests |
| CI/CD pipeline | Automated lint, test, deploy |
| PostgreSQL migration | Scale beyond SQLite |

---

## v2.1.0 — Treasury Management

| Feature | Description |
|---------|-------------|
| Treasury dashboard | All assets overview |
| Spending analytics | Charts and trends |
| Budget proposals | Treasury spending via governance |
| Spending limits | `daocond` policies |

---

## v3.0.0 — Mobile & Ecosystem

| Feature | Description |
|---------|-------------|
| Mobile app | React Native signing companion |
| Push notifications | Mobile alerts |
| Batch transactions | Multi-tx proposals |
| DAO registry | Discover public DAOs |

---

## v3.1.0 — Multi-chain & Advanced

| Feature | Description |
|---------|-------------|
| IBC transfers | Cross-chain from multisig |
| Ledger support | Hardware wallet signing |
| i18n | Multi-language |

---

## v4.0.0 — Public Platform

| Feature | Description |
|---------|-------------|
| Public instance | Self-service DAO creation |
| Template library | Pre-built DAO templates |
| Public API | Third-party integrations |

---

## Timeline

```
2026 Q1-Q2   v0.1.0 MVP ──► v0.2.0 Polish ──► v0.2.1/v0.2.2 Hardening
2026 Q2       v0.3.0 Air-gap/GRC20/Wiring
2026 Q2-Q3   v1.0.0 DAO ──► v1.1.0 Realms ──► v1.2.0 Notifications
2026 Q3-Q4   v2.0.0 On-chain ──► v2.1.0 Treasury
2027 Q1      v3.0.0 Mobile ──► v3.1.0 Multi-chain
2027 Q2+     v4.0.0 Public Platform
```

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
