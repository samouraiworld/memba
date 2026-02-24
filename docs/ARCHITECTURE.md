# Memba — Architecture

> System design for Memba, the Gno multisig & DAO governance application.

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                          Client Layer                            │
│                                                                  │
│   ┌─────────────────────┐    ┌──────────────────────────────┐   │
│   │   Adena Extension   │◄──►│   Vite SPA (Netlify)         │   │
│   │   (wallet/signing)  │    │   memba.samourai.app         │   │
│   └─────────────────────┘    └──────────┬───────────────────┘   │
└─────────────────────────────────────────┼────────────────────────┘
                                          │ ConnectRPC (HTTPS)
┌─────────────────────────────────────────┼────────────────────────┐
│                        Service Layer    │                        │
│                                         ▼                        │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              Go Backend (Fly.io)                         │   │
│   │                                                          │   │
│   │   ┌──────────┐ ┌──────────────┐ ┌───────────────────┐   │   │
│   │   │   Auth   │ │  Multisig    │ │   Chain Bridge    │   │   │
│   │   │ (ed25519 │ │  Coordinator │ │   (Gno RPC)       │   │   │
│   │   │ challenge│ │  (CRUD, sigs)│ │                   │   │   │
│   │   └──────────┘ └──────────────┘ └───────────────────┘   │   │
│   │                        │                    │            │   │
│   │                  ┌─────▼─────┐        ┌─────▼─────┐     │   │
│   │                  │  SQLite   │        │ Gno RPC   │     │   │
│   │                  │  (local)  │        │ (test11)  │     │   │
│   │                  └───────────┘        └───────────┘     │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                                    │
┌───────────────────────────────────────────────────┼──────────────┐
│                     Blockchain Layer              │              │
│                                                   ▼              │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                Gno Chain (test11)                        │   │
│   │                                                          │   │
│   │   Account state • TX broadcast • Realm queries           │   │
│   │   gnodaokit realms (Phase 2)                             │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Tech | Responsibility |
|-----------|------|---------------|
| **Frontend** | React + Vite + Tailwind v4 | UI, wallet integration, tx assembly |
| **Backend** | Go + ConnectRPC | Auth, multisig coordination, chain queries |
| **Database** | SQLite (WAL mode) | Multisig state, pending txs, signatures |
| **Wallet** | Adena SDK (dApp mode) | Key management, signing |
| **Chain** | Gno test11 | Account state, tx broadcast |

## Data Flow — Multisig Transaction

1. **Proposer** creates a send tx via UI → backend stores it
2. **Signers** open pending tx → sign with Adena → backend stores sigs
3. **When threshold reached** → frontend combines sigs → broadcasts to chain
4. **On confirmation** → frontend reports final hash to backend

## Security Model

- Backend **never** holds private keys
- All signing is **client-side** via Adena
- Auth via **ed25519 challenge-response** tokens
- CORS restricted to `memba.samourai.app`
- Rate limiting: 100 req/min per IP

See the full implementation plan for detailed security analysis.
