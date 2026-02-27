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
| `lib/daoSlug.ts` | DAO slug encoding, realm path validation, saved DAOs localStorage persistence |
| `lib/daoTemplate.ts` | DAO Factory: Gno realm code generator + MsgAddPackage builder |
| `hooks/useAdena.ts` | Adena wallet connect, sign, disconnect |
| `hooks/useAuth.ts` | Challenge-response token flow |
| `hooks/useBalance.ts` | GNOT balance via ABCI query (30s refresh) |
| `hooks/useMultisig.ts` | Multisig CRUD wrappers |
| `lib/parseMsgs.ts` | Human-readable TX content parser (MsgSend, MsgCall, MsgAddPackage) |
| `pages/` | Dashboard, CreateMultisig, ImportMultisig, MultisigView, ProposeTransaction, TransactionView, CreateToken, TokenDashboard, TokenView, DAOList, DAOHome, ProposalView, DAOMembers, ProposeDAO, CreateDAO (DAO Factory wizard), Treasury, TreasuryProposal |
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

## Hybrid Architecture — RPC vs Backend

Memba is a **hybrid** application. DAO and token features talk **directly to the blockchain** via ABCI queries — no backend involvement. The Go backend only exists for **multisig coordination** (collecting partial signatures before broadcast).

### Direct RPC (Frontend → gno.land)

These features are **100% serverless** — they work without the backend:

| Feature | ABCI Method | Realm / Path |
|---------|-------------|-------------|
| DAO config (name, description, tiers) | `vm/qrender` | `r/gov/dao:` |
| DAO members | `vm/qrender` | `r/gov/dao/v3/memberstore:members` |
| DAO proposals | `vm/qrender` | `r/gov/dao:` |
| Proposal detail | `vm/qrender` | `r/gov/dao:N` |
| Vote breakdown | `vm/qrender` | `r/gov/dao:N/votes` |
| Username resolution | `vm/qrender` | `r/gnoland/users/v1:g1address` |
| GRC20 token info | `vm/qrender` + `vm/qeval` | `r/tokens/*/grc20` |
| GNOT balance | `bank/balances` | address query |
| Vote / Execute | `MsgCall` via Adena | `r/gov/dao.MustVoteOnProposalSimple` |
| Token actions | `MsgCall` via Adena | `r/tokens/*/grc20.Transfer` |

### Backend-Dependent (Frontend → Go Backend → Chain)

These features **require** the Go backend for off-chain coordination:

| Feature | Why backend? | Protocol |
|---------|-------------|----------|
| Auth (challenge-response) | ed25519 keypair stored server-side | ConnectRPC |
| Multisig CRUD | SQLite stores configs, members, thresholds | ConnectRPC |
| Transaction coordination | Collect N partial signatures before broadcast | ConnectRPC |
| Signature storage | Partial sigs can't live on-chain | ConnectRPC |
| Inline rename | Per-user metadata, backend-persisted | ConnectRPC |

### Implications

- **DAO Hub could run as a pure static site** (no server, no backend)
- **Multisig features require the Go backend** (signature coordination)
- **All on-chain data is fetched via JSON-RPC POST** to gno.land RPC endpoints
- **All on-chain actions go through Adena wallet** (user confirms in extension)

## Data Flow — DAO ABCI Queries

```
┌─────────────┐     JSON-RPC POST      ┌──────────────────────┐
│   Frontend   │ ──────────────────────► │  gno.land RPC        │
│   lib/dao.ts │                         │  (test11 / mainnet)  │
│              │ ◄────────────────────── │                      │
│  queryRender │     base64 response     │  vm/qrender          │
│  queryEval   │                         │  vm/qeval             │
│  abciQuery   │                         │  bank/balances        │
└──────┬───────┘                         └──────────────────────┘
       │
       │  Parse ABCI markdown/JSON
       ▼
┌──────────────────────────────────────────────────┐
│                    Parsers                        │
│                                                   │
│  Config:  description, memberstorePath, tiers     │
│  Members: pipe table → address + tier + power     │
│  Proposals: regex → title, author, status, votes  │
│  Votes: tier-grouped VPPM breakdown               │
│  Usernames: "# User - `name`" → @name (cached)   │
└──────────────────────────────────────────────────┘
```

## Username Resolution Pipeline

```
resolveUsernames(members[])
    │
    ├── Phase 1: Check localStorage cache (1h TTL)
    │   ├── Cache hit → populate member.username instantly
    │   └── Cache miss → mark for ABCI resolution
    │
    └── Phase 2: Resolve misses in parallel
        ├── Promise.all(resolveUsername(address))
        │   └── queryRender("r/gnoland/users/v1", address)
        │       └── Parse "# User - `username`" → @username
        └── Write results to localStorage cache
```

## Frontend Data Sources

| Page | Backend | RPC | localStorage |
|------|---------|-----|-------------|
| Dashboard | ✅ multisigs, txs | ✅ balances | — |
| MultisigView | ✅ members, sigs | ✅ balance | — |
| CreateToken | — | ✅ Adena DoContract | — |
| TokenDashboard | — | ✅ token list, balances | — |
| DAOList | — | ✅ DAO configs | ✅ saved DAOs |
| DAOHome | — | ✅ config, members, proposals | ✅ usernames |
| DAOMembers | — | ✅ members + tiers | ✅ usernames |
| ProposalView | — | ✅ proposal + votes | — |
| Treasury | — | ✅ GNOT + GRC20 balances | — |
| CreateDAO | — | ✅ MsgAddPackage deploy | ✅ saved DAOs |

