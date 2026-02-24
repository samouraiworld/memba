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

## v0.1.0 — MVP: Multisig Wallet

> First usable version for samourai-crew 3-of-7 on test11.

### Scope

| Feature | Description |
|---------|------------|
| Create multisig | Input member addresses, fetch pubkeys, set threshold → derive address |
| Import multisig | Load existing multisig by address, display members + threshold |
| Adena connect | dApp wallet connection via browser extension |
| Balance | GNOT balance from test11 RPC |
| Propose send | Create unsigned GNOT transfer from multisig |
| Sign | Individual signing via Adena |
| Track | Signature progress bar (K of N) |
| Broadcast | Combine sigs + broadcast to chain |
| Pending list | List of awaiting-signature transactions |
| Auth | Challenge-response ed25519 tokens |
| UI | Kodera design system: dark mode, terminal aesthetic, Inter font, cyan accents |

### Acceptance Criteria
| # | Criterion |
|---|----------|
| 1 | Create 2-of-3 multisig → correct derived address, members displayed |
| 2 | Import `g10kw...` → shows 7 members, threshold=3 |
| 3 | Adena connect → user identity displayed |
| 4 | Balance matches Gnoscan |
| 5 | Propose 1 GNOT send → pending tx visible to all |
| 6 | 3/7 sign → "Ready to broadcast" |
| 7 | Broadcast → tx hash confirmed on chain |
| 8 | Unauthorized request → rejected with 401 |
| 9 | UI matches Kodera design system: black bg, cyan accents, dashed borders |

### Infrastructure
- Backend deployed on Fly.io
- Frontend deployed on Netlify
- `memba.samourai.app` resolves correctly
- SQLite database persisted on Fly.io volume

### Post-release Review
- 🔒 Audit auth flow, signature validation, CORS policy
- 👤 Test with 1 non-technical teammate (can they sign?)
- ⚙️ Measure: dashboard TTI, API latency, cold start time

---

## v0.2.0 — Polish & Essentials

### Scope

| Feature | Description |
|---------|-------------|
| TX history | Executed transactions with hash + timestamp |
| TX details | Human-readable transaction content |
| Error handling | Graceful errors, retry logic, loading skeletons |
| Mobile responsive | Functional on mobile browsers |
| Onboarding | First-time user guide / walkthrough |

### Acceptance Criteria
| # | Criterion |
|---|----------|
| 1 | Executed tx list shows hash, amount, date |
| 2 | Error toast on failed broadcast with actionable message |
| 3 | Dashboard usable on 375px width (iPhone SE) |

### Post-release Review
- 🔒 Input validation for addresses, threshold bounds
- 👤 Full mobile walkthrough (iPhone + Android Chrome)
- ⚙️ Bundle size audit, unused dependency removal

---

## v0.3.0 — Air-gapped Signing & GRC20

### Scope

| Feature | Description |
|---------|-------------|
| Manual sig paste | Import gnokey signature JSON for air-gapped users |
| Export unsigned tx | Download unsigned tx as JSON file |
| GRC20 balances | Display GRC20 token balances |
| GRC20 transfers | Propose GRC20 token sends from multisig |

### Acceptance Criteria
| # | Criterion |
|---|-----------|
| 1 | Export unsigned tx → valid JSON loadable by gnokey |
| 2 | Paste gnokey signature → accepted and counted toward threshold |
| 3 | GRC20 balance query → matches on-chain state |
| 4 | GRC20 send → confirmed on chain |

### Post-release Review
- 🔒 Signature format validation, replay protection
- 👤 Air-gapped workflow test (no internet during signing)
- ⚙️ GRC20 token registry performance, caching strategy

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

## v1.1.0 — Realm Interactions

| Feature | Description |
|---------|-------------|
| TX builder | Generic realm function call UI (any realm, any function) |
| Multi-wallet | Manage multiple multisigs from one account |
| Config export/import | Backup multisig configuration |

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
2026 Q1-Q2   v0.1.0 MVP ──► v0.2.0 Polish ──► v0.3.0 Air-gap/GRC20
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
