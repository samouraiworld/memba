# Memba メンバー

> Gno-native multisig wallet & DAO governance application.

[![CI](https://github.com/samouraiworld/memba/actions/workflows/ci.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/ci.yml)
[![Security](https://github.com/samouraiworld/memba/actions/workflows/codeql.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](./LICENSE)

**Memba** is a standalone web application for managing multisig wallets and DAO governance on the [Gno](https://gno.land) blockchain. Built for the samourai-crew.

## Features (v7.0.0)

- 🔑 Create & import multisig wallets
- 💼 Adena wallet connection (dApp mode)
- 💰 GNOT balance display (live via ABCI query)
- 📝 Propose GNOT send & contract call transactions
- ✍️ Sign with Adena or paste gnokey signatures (air-gapped)
- 📊 Signature tracking + threshold progress
- 📡 Combine signatures + broadcast to chain
- 🔐 Challenge-response authentication (ed25519)
- 📜 TX history with parsed messages (MsgSend/MsgCall/MsgAddPackage)
- 📱 Mobile responsive (375px+) with progressive header collapse
- 🌐 Network selector (test11 ↔ staging ↔ portal-loop) with chain mismatch detection
- 🔗 Shareable import links for 1-click multisig onboarding
- 🔍 Auto-detect multisig membership with 1-click join
- 📋 Full addresses with 1-click copy everywhere
- ✏️ Inline multisig rename (per-user, backend-persisted)
- 🪙 GRC20 Token Launchpad (create, mint, burn, transfer, faucet)
- 💎 5% platform fee on mints (supports Samouraï Coop)
- 🏛️ Multisig admin governance for GRC20 tokens
- 🏛️ DAO Governance (multi-DAO hub, proposals, voting, execution, member management)
- 🏗️ DAO Factory — 4 presets (Basic, Team, Treasury, Enterprise) with `cur realm` crossing
- 🎭 DAO Roles — admin, dev, finance, ops, member + role management
- 📊 Quorum — configurable minimum participation %
- 📁 Proposal Categories — governance, treasury, membership, operations
- 🗄️ Archive DAO — admin-only archival for obsolete DAOs
- 👤 Member @usernames resolved via gno.land user registry
- 💰 Treasury Management (asset overview, spending proposals)
- 🔗 Multi-DAO support (connect to any DAO on gno.land by realm path)
- 🔴 LIVE auto-refresh for active proposals (30s polling)
- ⚡ Code splitting (424KB main bundle, lazy-loaded DAO/token chunks)
- 🐳 Docker Compose self-hosting
- 🚀 CI/CD pipeline (GitHub Actions + Netlify + Fly.io)
- 🔗 GitHub OAuth identity verification (link GitHub to profile)
- 👤 User profiles (bio, social links, contributions, deployed packages)
- 📛 Username registration via `gno.land/r/gnoland/users/v1`
- 🗳️ Vote status badges ("You voted YES/NO/ABSTAIN")
- 🔀 User redirect (`/u/username` → `/profile/address`)
- 📊 Gnolove contribution stats (commits, PRs, issues, reviews)
- 🧪 167 unit tests (Vitest) — ABCI parsers, code generators, profile logic
- 🗺️ Centralised error mapping layer (10 error patterns → user-friendly messages + retry)
- ⚡ Progressive loading (DAOHome, DAOList — per-section skeleton states)
- ♻️ CreateDAO wizard split (5 components, draft persistence with 24h TTL)
- 🔧 Stale chunk auto-recovery (auto-reload on Vite lazy-load failures)
- 🏗️ Enhanced `/health` endpoint (DB status, uptime, memory, version)
- 💾 SQLite automated backup (daily VACUUM INTO, 7-day retention)
- 📥 TX history CSV export (client-side, 10 columns)

## Architecture

```
frontend/   → React + Vite + Vanilla CSS + Kodera design system (Netlify)
backend/    → Go + ConnectRPC + SQLite (Fly.io)
api/        → Protobuf service definitions (Buf)
contracts/  → Gno realms (future)
docs/       → Architecture, API, deployment docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

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

## License

[MIT](LICENSE) © 2026 Samouraï Coop
