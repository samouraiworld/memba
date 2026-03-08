# Memba メンバー

> Gno-native multisig wallet & DAO governance application.

[![CI](https://github.com/samouraiworld/memba/actions/workflows/ci.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/ci.yml)
[![Security](https://github.com/samouraiworld/memba/actions/workflows/codeql.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%20%7C%2022-green.svg)](https://nodejs.org)
[![Go](https://img.shields.io/badge/Go-≥1.25-00ADD8.svg)](https://go.dev)
[![Tests](https://img.shields.io/badge/Tests-636%20passing-brightgreen.svg)](#testing)

> ⚠️ **Alpha Software** — Memba is experimental, unaudited, and under active development. See [DISCLAIMER.md](DISCLAIMER.md).

**Memba** is a standalone web application for managing multisig wallets and DAO governance on the [Gno](https://gno.land) blockchain. Built by [Samouraï Coop](https://www.samourai.world).

**🌐 Live:** [memba.samourai.app](https://memba.samourai.app)

## Features (v2.2a)

### Multisig
- 🔑 Create & import multisig wallets
- 💼 Adena wallet connection (dApp mode)
- 💰 GNOT balance display (live via ABCI query)
- 📝 Propose GNOT send & contract call transactions
- ✍️ Sign with Adena or paste gnokey signatures (air-gapped)
- 📊 Signature tracking + threshold progress
- 📡 Combine signatures + broadcast to chain
- 🔗 Shareable import links for 1-click onboarding
- 🔍 Auto-detect multisig membership with 1-click join
- ✏️ Inline multisig rename (per-user, backend-persisted)

### DAO Governance
- 🏛️ Multi-DAO hub — proposals, voting, execution, member management
- 🏗️ DAO Factory — 4 presets (Basic, Team, Treasury, Enterprise)
- 🎭 Roles — admin, dev, finance, ops, member + role management
- 📊 Quorum — configurable minimum participation %
- 📁 Proposal Categories — governance, treasury, membership, operations
- 📊 **SingleVoteBar** — participation % (green YES / red NO split) + tier pie chart
- 📊 **Quorum threshold** — 50% marker with amber/teal participation indicator
- 🗄️ Archive DAO — admin-only archival for obsolete DAOs
- 💰 Treasury Management (asset overview, spending proposals)
- 🔴 LIVE auto-refresh for active proposals (30s polling)
- 📂 **Organization Directory** — discover DAOs, tokens, and users with rich metadata
  - Featured DAOs carousel, DAO Render parsing (members, proposals, description)
  - Save-to-Memba buttons, search/filter, premium glassmorphism UI
- 🗳️ "Needs My Vote" filter tabs for DAO members
- ✅ Vote status badges + auto-hide buttons after voting
- 🔴 Unvoted proposal notification dot (pulsing red badge on DAO nav)

### Token Launchpad
- 🪙 GRC20 Token Launchpad (create, mint, burn, transfer, faucet)
- 💎 5% platform fee on mints (supports Samouraï Coop)
- 🏛️ Multisig admin governance for GRC20 tokens

### User Profiles
- 👤 User profiles (bio, social links, contributions, deployed packages)
- 📛 Username registration via network-aware user registry (`getUserRegistryPath()`)
- 🔗 GitHub OAuth identity verification
- 📊 Gnolove contribution stats (commits, PRs, issues, reviews)
- 🔀 User redirect (`/u/username` → `/profile/address`)
- 🗳️ "My Votes" — cross-DAO vote history on user profile
- 🏛️ DAO Memberships — saved DAO list on profile with navigation
- 🖼️ Avatar Upload — URL + file picker (JPEG/PNG/WebP/GIF, 2MB max)
- 🔔 **Notification Center** — bell icon, 30s ABCI polling, per-wallet isolation, grouped by date
- ⚡ **Validator Dashboard** — network stats, voting power distribution, sortable table, pagination
- 💧 **Faucet Card** — gasless onboarding with eligibility check and cooldown timer

### Navigation & Layout
- 📐 **Sidebar Navigation** — Vercel-inspired 3-section sidebar (Navigation, Plugins, User)
- 📱 **Mobile Tab Bar** — 5-tab bottom navigation (Home, DAOs, Tokens, Directory, More)
- 📋 **Bottom Sheet** — Slide-up modal for mobile overflow menu
- 🔒 **TopBar** — Alpha/v2 badges, network selector, wallet status, security banners
- ♿ **Skip-to-content** — Accessibility link (focus-only)

### Security & Infrastructure
- 🔐 Challenge-response auth (ed25519, ADR-036)
- 🛡️ RPC domain validation — blocks writes through untrusted RPCs
- ⚡ Adena reconnect optimization (5s polling, `GetNetwork()` cached)
- 🏠 **Dashboard guard** — hidden when disconnected, auto-redirect to landing
- 🌐 Network selector (test11 ↔ staging ↔ portal-loop ↔ betanet) with chain mismatch detection
- 📱 Mobile responsive (375px+) with sidebar collapse at 1024px, tab bar below 768px
- ⚡ Code splitting (449KB main, 129KB gzip, lazy-loaded DAO/token/directory chunks)
- 🪲 **Sentry** — Error monitoring with PII scrubbing (self-hosted at sentry.samourai.pro)
- 🐳 Docker Compose self-hosting
- 🚀 CI/CD: GitHub Actions (Node 20+22 matrix) + Netlify + Fly.io

### Testing
- 🧪 **636 unit tests** (Vitest) — ABCI parsers, code generators, profile logic, balance formatting, RPC domain validation, write guard, plugins, notifications, validators, directory, DAO metadata
- 🧪 **199 E2E tests** (Playwright) — 11 spec files: navigation, smoke, plugins, DAO, profile, token, multisig, settings, create-dao, treasury, validators, directory

## Architecture

```
frontend/   → React + Vite + Vanilla CSS + Kodera design system (Netlify)
backend/    → Go + ConnectRPC + SQLite (Fly.io)
api/        → Protobuf service definitions (Buf)
contracts/  → Gno realms (future)
docs/       → Architecture, API, deployment docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

### Plugin Architecture (v2.0)

Memba uses a modular plugin system for extensible DAO features:

```
src/plugins/
├── registry.ts        # Plugin registry (frozen after init)
├── types.ts           # PluginProps interface
├── styles.ts          # Shared plugin styles
├── PluginLoader.tsx   # Lazy-loading error boundary
├── board/             # 💬 Discussion board (ABCI parser)
├── gnoswap/           # 🔄 GnoSwap DEX integration
├── leaderboard/       # 🏆 Member ranking
└── proposals/         # 📋 Proposal Explorer (search, filter, sort, paginate)
```

Each plugin follows: `index.tsx` (entry) → `*View.tsx` (UI) → `queries.ts`/`builders.ts` (logic).

**Extensions in CreateDAO:** The wizard's Step 4 lets users enable plugins during DAO creation. When Board is enabled, a companion board realm is deployed alongside the DAO in a chained transaction.

## Quick Start

### Prerequisites

- Go ≥ 1.25
- Node.js ≥ 20
- [Buf CLI](https://buf.build/docs/installation)
- [Adena Wallet](https://adena.app) browser extension

### Development

```bash
# Backend
cd backend && go run ./cmd/memba

# Frontend
cd frontend && npm install && npm run dev

# Proto generation
make proto-gen
```

### Testing

```bash
# Frontend unit tests (Vitest)
cd frontend && npm test

# Frontend E2E smoke tests (Playwright)
cd frontend && npx playwright test

# Backend tests
cd backend && go test -race -count=1 -cover ./...
```

## Chain

| Network | RPC | Chain ID |
|---------|-----|----------|
| test11 | `https://rpc.test11.testnets.gno.land:443` | `test11` |
| portal-loop | `https://rpc.gno.land:443` | `portal-loop` |

## Target Multisig

samourai-crew 3-of-7: `g10kw7e55e9wc8j8v6904ck29dqwr9fm9u280juh`

## Links

- [Roadmap](ROADMAP.md)
- [Changelog](CHANGELOG.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Disclaimer](DISCLAIMER.md)

## Contributors

Built by the [Samouraï Coop](https://www.samourai.world) team.

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) © 2026 Samouraï Coop
