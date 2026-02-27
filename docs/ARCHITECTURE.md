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
│                       Service Layer     │                        │
│                                         ▼                        │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │              Go Backend (Fly.io)                         │   │
│   │                                                          │   │
│   │   ┌──────────┐ ┌──────────────┐ ┌───────────────────┐   │   │
│   │   │   Auth   │ │  Multisig    │ │  Transactions     │   │   │
│   │   │ ed25519  │ │  CRUD        │ │  Propose/Sign/    │   │   │
│   │   │ ADR-036  │ │  3 RPCs      │ │  Complete (4 RPCs)│   │   │
│   │   └──────────┘ └──────────────┘ └───────────────────┘   │   │
│   │                        │                                 │   │
│   │                  ┌─────▼─────┐                           │   │
│   │                  │  SQLite   │                           │   │
│   │                  │  WAL mode │                           │   │
│   │                  └───────────┘                           │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                                                    │
┌───────────────────────────────────────────────────┼──────────────┐
│                     Blockchain Layer              │              │
│                                                   ▼              │
│   ┌──────────────────────────────────────────────────────────┐   │
│   │                Gno Chain (test11)                        │   │
│   │   ABCI queries • TX broadcast • Bank balances            │   │
│   └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Components

| Component | Tech | Responsibility |
|-----------|------|---------------|
| **Frontend** | React + Vite + Vanilla CSS + Kodera design system | UI, wallet integration, tx assembly |
| **Backend** | Go + ConnectRPC | Auth, multisig coordination, tx management |
| **Database** | SQLite (WAL mode, FK enabled) | Multisigs, members, transactions, signatures |
| **Wallet** | Adena (window.adena) | Key management, signing |
| **Chain** | Gno test11 | Account state, tx broadcast, balance queries |

## Backend Packages

| Package | Files | Responsibility |
|---------|-------|---------------|
| `cmd/memba` | `main.go` | Server entry, CORS (`connectrpc.com/cors`), rate limiter, graceful shutdown |
| `internal/auth` | `crypto.go`, `crypto_test.go` | Challenge/token lifecycle, ADR-036, secp256k1 |
| `internal/service` | `service.go`, `auth_rpc.go`, `multisig_rpc.go`, `tx_rpc.go` | Core struct + 9 RPC handlers (split by domain) |
| `internal/db` | `db.go`, `migrations/` | SQLite connection, migration runner |
| `gen/memba/v1` | Generated | Proto stubs (Go + ConnectRPC) |

## Frontend Structure

| Path | Responsibility |
|------|---------------|
| `lib/api.ts` | ConnectRPC transport + client |
| `lib/account.ts` | ABCI query for account number + sequence (JSON-RPC POST) |
| `lib/grc20.ts` | GRC20 factory helpers: list, info, balance, MsgCall builders, DoContract broadcast |
| `lib/dao.ts` | DAO helpers: ABCI queries (config, members, proposals), MsgCall builders (Vote, Execute, Propose) |
| `hooks/useAdena.ts` | Adena wallet connect, sign, disconnect |
| `hooks/useAuth.ts` | Challenge-response token flow |
| `hooks/useBalance.ts` | GNOT balance via ABCI query (30s refresh) |
| `hooks/useMultisig.ts` | Multisig CRUD wrappers |
| `lib/parseMsgs.ts` | Human-readable TX content parser (MsgSend, MsgCall, MsgAddPackage) |
| `pages/` | Dashboard, CreateMultisig, ImportMultisig, MultisigView, ProposeTransaction, TransactionView, CreateToken, TokenDashboard, TokenView, DAOHome, ProposalView, DAOMembers, ProposeDAO, Treasury, TreasuryProposal |
| `components/multisig/ProgressBar.tsx` | K-of-N threshold visualization |

## Data Flow — Multisig Transaction

1. **Proposer** creates a send tx via UI → backend stores it
2. **Signers** open pending tx → sign with Adena → backend stores sigs
3. **When threshold reached** → frontend combines sigs → broadcasts to chain
4. **On confirmation** → frontend reports final hash to backend

## Security Model

- Backend **never** holds private keys
- All signing is **client-side** via Adena
- Auth via **ed25519 challenge-response** with ADR-036 signature verification
- Anti-phishing via `ClientMagic` constant
- CORS restricted to allowed origins
- Parameterized SQL queries (no injection)
- Token expiry: 24h, Challenge expiry: 5min

## Database Schema

4 tables + 1 migration tracker:
- `multisigs` — chain_id, address, pubkey_json, threshold, members_count
- `user_multisigs` — user↔multisig membership, join state, role
- `transactions` — proposed txs with msgs, fees, sequence, final_hash
- `signatures` — per-user signature on a transaction
- `_migrations` — schema version tracking
