# Changelog

All notable changes to Memba are documented here.

## [2.0.0] — 2026-02-24

### Added
- **Docker Self-Hosting**: `docker compose up` — backend (Go + SQLite) + frontend (Nginx) with health checks
- **Frontend Dockerfile**: Node 20 build → Nginx static serve with SPA fallback + 1y cache
- **CI/CD**: TypeScript type check (`tsc --noEmit`), Docker build verification job (4 CI jobs total)
- **Backend .env.example**: Documents all 4 required env vars

### Fixed (Final Audit)
- **MultisigView**: Fixed TS18048 `address` possibly undefined in config export download

## [1.2.0] — 2026-02-24

### Added
- **Activity Feed**: Tabbed Pending/Completed transaction views with counts on MultisigView
- **Shareable TX Links**: 'Share' button on TransactionView + 'Copy Shareable Link' on MultisigView
- **Completed TXs**: Fetches executed transactions in parallel alongside pending ones

## [1.1.0] — 2026-02-24

### Added
- **Generic TX Builder**: Tabbed ProposeTransaction with 'Send GNOT' (MsgSend) and 'Contract Call' (MsgCall) modes
- **MsgCall Support**: Package path, function name, comma-separated args, optional GNOT send amount
- **Config Export**: MultisigView 'Export Config' button downloads multisig config JSON for backup/sharing
- **Higher gas for calls**: Contract calls use 2M gas vs 100K for sends

## [0.4.0] — 2026-02-24

### Added
- **Export Unsigned TX**: Download sign doc as JSON for offline signing with gnokey
- **Manual Sig Paste**: Paste base64 gnokey signatures for air-gapped signers → SignTransaction RPC
- **Import via Pubkey JSON**: New tabbed import with 'By Pubkey JSON' mode — paste full Amino multisig pubkey to import/join

### Fixed (Audit)
- **TransactionView**: DRY refactored sign doc construction into `buildSignDoc()` helper (3 call sites → 1 function)
- **ImportMultisig**: Added per-pubkey item validation (type + value fields) in JSON import mode
- **ImportMultisig**: Migrated hardcoded bech32 prefix to `GNO_BECH32_PREFIX` config constant

## [0.3.0] — 2026-02-24

### Added
- **MultisigView**: Fetches real data from MultisigInfo + Transactions RPCs (threshold, balance, members, pending TXs)
- **ProposeTransaction**: Builds MsgSend JSON, fetches account info from chain, validates inputs, calls CreateTransaction RPC
- **Sign Transaction**: Builds Amino sign doc, calls Adena SignAmino, submits via SignTransaction RPC
- **Broadcast**: Sends signed TX to chain via RPC, records hash via CompleteTransaction RPC
- **CreateMultisig**: Fetches member secp256k1 pubkeys from chain via ABCI, builds Amino LegacyAminoPubKey JSON, creates via CreateOrJoinMultisig RPC
- **Manual pubkey paste**: Fallback for members without on-chain pubkeys (accounts that haven't sent a TX yet)

### Fixed (Audit Round 1)
- **CreateMultisig**: Fixed `fetchPubkey` stale closure — switched to functional `setState` pattern
- **TransactionView**: Reset `actionLoading` on signature rejection (early return bug)
- **TransactionView**: Error state now checks `auth.isAuthenticated` (was `adena.connected`)
- **ProposeTransaction**: Reduced default fee from 1 GNOT to 0.01 GNOT for testnet

### Changed (Audit Round 2)
- **Config centralization**: Created `lib/config.ts` — all env vars (×12 duplicates) now imported from single source
- Migrated 7 files from local `import.meta.env` reads to centralized config imports

## [0.2.2] — 2026-02-24

### Fixed
- **F1**: Auth bridge — wallet connect now auto-triggers challenge-response token flow
- **F4**: Import Multisig — wired to MultisigInfo → CreateOrJoinMultisig RPCs
- **F1-audit**: Fixed ClientMagic constant mismatch (frontend vs backend)
- **F1-audit**: Fixed challenge nonce/signature serialization (Uint8Array → base64 for protojson)
- **A1-audit**: Dashboard guards aligned to `auth.isAuthenticated` (was `adena.connected`)
- **A2-audit**: Fixed UGNOT conversion for amounts with exactly 6 digits in `parseMsgs`

### Changed
- Layout centralizes auth state via Outlet context (Dashboard + TransactionView migrated)
- LayoutContext extended with `auth.token`, `isAuthenticated`, `address`, `loading`, `error`
- Header shows "Authenticating..." state during challenge-response flow
- Auth error banner displayed on login failures with dismiss button
- Import page shows "Connect wallet" prompt when unauthenticated

### Documentation
- ARCHITECTURE.md: Fixed Tailwind note, service split table, added parseMsgs entry
- ROADMAP.md: Added v0.2.2 section, expanded v0.3.0 scope, updated timeline
- README.md: Updated version badge and architecture line
- Version badges: header + footer updated to v0.2.2

## [0.2.1] — 2026-02-24

### Security
- **P0-B**: `CompleteTransaction` now enforces `signatures >= threshold` before allowing finalization
- **P3-C**: Added `Content-Security-Policy` header to `netlify.toml`

### Fixed
- **P0-A**: `TransactionView` accepts `?ms=&chain=` query params to scope TX fetch
- **P1-A**: Dashboard state updates are atomic (all-or-nothing on `Promise.all`)
- **P1-B**: `SignTransaction` uses `ON CONFLICT UPDATE` instead of `INSERT OR REPLACE` (preserves `created_at`)
- **P1-C**: Removed dead `var _ *sql.DB` in `main.go`
- **P2-A**: Rate limiter GC goroutine stops cleanly on graceful shutdown (context-based)
- **P2-C**: `ErrorToast` deduplicates renders via `lastMessageRef`
- **P2-D**: Documented client-side token validation trade-off in `useAuth.ts`
- **P3-A**: Replaced `alert()` stubs with `console.warn` + `TODO(v0.3.0)` markers
- **P3-B**: Standardized all slog error contexts to `RpcName: operation` format

### Tests
- `TestTransactionLifecycle` updated with threshold-rejection assertion + 2nd signer

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
