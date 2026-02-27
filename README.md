# Memba メンバー

> Gno-native multisig wallet & DAO governance application.

[![CI](https://github.com/samouraiworld/memba/actions/workflows/ci.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](./LICENSE)

**Memba** is a standalone web application for managing multisig wallets and DAO governance on the [Gno](https://gno.land) blockchain. Built for the samourai-crew.

## Features (v5.0.3)

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
- 👤 Member @usernames resolved via gno.land user registry
- 💰 Treasury Management (asset overview, spending proposals)
- 🏗️ DAO Factory (create and deploy new governance DAOs on-chain)
- 🔗 Multi-DAO support (connect to any DAO on gno.land by realm path)
- 🔴 LIVE auto-refresh for active proposals (30s polling)
- ⚡ Code splitting (424KB main bundle, lazy-loaded DAO/token chunks)
- 🐳 Docker Compose self-hosting
- 🚀 CI/CD pipeline (GitHub Actions + Netlify + Fly.io)

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

- Go ≥ 1.24
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

## License

[MIT](LICENSE) © 2026 Samouraï Coop
