# Changelog

All notable changes to Memba are documented here.

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
