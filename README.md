# Memba メンバー

> Gno-native multisig wallet & DAO governance application.

[![CI](https://github.com/samouraiworld/memba/actions/workflows/ci.yml/badge.svg)](https://github.com/samouraiworld/memba/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-cyan.svg)](./LICENSE)

**Memba** is a standalone web application for managing multisig wallets and DAO governance on the [Gno](https://gno.land) blockchain. Built for the samourai-crew.

## Features (v0.2.2)

- 🔑 Create & import multisig wallets
- 💼 Adena wallet connection (dApp mode)
- 💰 GNOT balance display (live via ABCI query)
- 📝 Propose GNOT send transactions
- ✍️ Sign with Adena (individual member)
- 📊 Signature tracking + threshold progress
- 📡 Combine signatures + broadcast to chain
- 🔐 Challenge-response authentication (ed25519 + ADR-036)
- 📜 TX history with parsed messages (MsgSend/MsgCall/MsgAddPackage)
- 📱 Mobile responsive (375px+)
- 🛡️ Threshold-enforced completion (v0.2.1 security fix)
- ⚡ Batch signature loading (N+1 fix)

## Architecture

```
frontend/   → React + Vite + Tailwind v4 + Kodera CSS (Netlify)
backend/    → Go + ConnectRPC + SQLite (Fly.io)
api/        → Protobuf service definitions (Buf)
contracts/  → Gno realms (future)
docs/       → Architecture, API, deployment docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Quick Start

### Prerequisites

- Go ≥ 1.23
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
