# Changelog

All notable changes to Memba are documented here.

## [0.2.0] — 2026-02-24

### Added
- **TX detail page**: `/tx/:id` with parsed transaction content, real signers, fee/metadata
- **Msg parser**: Human-readable display for MsgSend (ugnot→GNOT), MsgCall, MsgAddPackage
- **TX history**: Dashboard shows live multisig count, pending TX count, and real balance
- **Status badges**: 4-state transaction badges (pending → signing → ready → complete)
- **Error toast**: Auto-dismiss error notifications with Kodera styling
- **Loading skeletons**: Shimmer cards and table rows during data fetch
- **Mobile responsive**: 3 breakpoints (768px tablet, 480px mobile, 375px iPhone SE)
- **Integration tests**: 11 service-level tests with in-memory SQLite harness
- **E2E test docs**: 7-section manual test checklist for samourai-crew flow

### Changed
- **Service split**: `service.go` (601 LOC) → 4 files: `service.go`, `auth_rpc.go`, `multisig_rpc.go`, `tx_rpc.go`
- **N+1 fix**: Batch signature loading in Transactions RPC (1 query instead of N)
- **Context wiring**: All SQL operations use `ctx` for cancellation/timeout support
- **Layout**: Version badge updated from MVP to v0.2

### Fixed
- **P0**: 7 bare `tx.QueryRow`/`tx.Exec` calls → context variants inside `sql.Tx`
- **P1**: `GetToken` no longer leaks internal error details to client
- **P3**: Shared `BadgeStatus` type, shared `LayoutContext`, removed unused `icon` field

## [0.1.1] — 2026-02-24

### Security
- **S1**: Persistent ed25519 keypair from `ED25519_SEED` env — tokens survive restarts
- **S2**: `internalError()` helper — 18 error leaks sanitized, no DB details to client
- **S3**: Address regex validation in `useBalance` — prevents ABCI URL injection
- **S4**: IP-based rate limiter (100 req/min) with GC goroutine
- **S5**: Challenge nonce deduplication (in-memory TTL set, 5-min replay window)
- **S6**: Input length limits: pubkey 4KB, msgs 100KB, fee 4KB, memo 256 chars

### Fixed
- **B1**: Removed unused `gcc musl-dev` from Dockerfile (CGO_ENABLED=0)
- **B2**: Added `rows.Err()` checks after all 3 row iteration loops
- **B3**: `splitOrigins` now trims whitespace from CORS origins
- **Adena detection**: Replaced sync `isInstalled()` with reactive polling (200ms × 15)
- **CI/CD**: Fixed Go version (1.23→1.24), committed proto stubs, fixed errcheck lint
- **ESLint**: Added `src/gen` to flat config `globalIgnores`, fixed TS2352 double assertion

### Added
- Auth token persistence via `localStorage` with 60s expiry check
- "Install Adena" fallback link when extension not detected
- Rate limiter middleware on ConnectRPC handler

### Docs
- Updated ARCHITECTURE.md, API.md, DEPLOYMENT.md, ROADMAP.md

## [0.1.0] — 2026-02-24

### Added
- **Auth**: ed25519 challenge-response with ADR-036 signature verification (8 tests)
- **Multisig CRUD**: CreateOrJoinMultisig, MultisigInfo, Multisigs (3 RPCs)
- **Transactions**: CreateTransaction, Transactions, SignTransaction, CompleteTransaction (4 RPCs)
- **Wallet**: Adena browser extension integration (connect, sign, disconnect)
- **Balance**: GNOT balance via ABCI query with 30s auto-refresh
- **Frontend**: Dashboard, CreateMultisig, ImportMultisig, MultisigView, ProposeTransaction, TransactionView
- **UI**: Kodera design system (dark mode, cyan accents, JetBrains Mono, dashed borders)
- **Infra**: Fly.io backend, Netlify frontend, SQLite WAL, CI/CD (7 checks)
