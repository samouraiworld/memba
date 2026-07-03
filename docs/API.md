# Memba — API Reference

> Source: `api/memba/v1/memba.proto` | Protocol: ConnectRPC
>
> Regenerated against `memba.proto` (38 RPCs) 2026-07-03.

## Service: `MultisigService`

All 38 RPCs live on the single `MultisigService`. Auth legend: **✅** = requires a valid
auth `Token` · **Admin** = requires auth **and** the caller to be in `QUEST_ADMIN_ADDRESSES` ·
**No** = public, unauthenticated read.

### Auth, Multisig, Transactions, Profile

| RPC | Auth | Description |
|-----|------|-------------|
| `GetChallenge` | No | Generate a server-signed ed25519 challenge (5min expiry, pubkey- and chain-bound) |
| `GetToken` | No | Validate challenge + optional ADR-036 sig → auth token (24h) |
| `CreateOrJoinMultisig` | ✅ | Register multisig (pubkey derivation) or join existing |
| `MultisigInfo` | ✅ | Get multisig details + member list (caller must be a joined member — BE-1) |
| `Multisigs` | ✅ | List user's multisigs (filter by chain, join state) |
| `CreateTransaction` | ✅ | Propose a new transaction (membership required) |
| `GetTransaction` | ✅ | Get single transaction by ID (membership required) |
| `Transactions` | ✅ | List transactions (filter by multisig, execution state, cursor pagination) |
| `SignTransaction` | ✅ | Add signature to pending transaction |
| `CompleteTransaction` | ✅ | Record final tx hash after broadcast; the backend then does a best-effort `/tx` lookup against the chain and stores `Transaction.verified` accordingly (W2.3) |
| `GetProfile` | No | Get public user profile (bio, social links, avatar) |
| `UpdateProfile` | ✅ | Update own profile (bio, company, title, avatar, socials) |

### Quests (GnoBuilders)

| RPC | Auth | Description |
|-----|------|-------------|
| `CompleteQuest` | ✅ | Complete a quest. XP is fixed server-side per quest ID; every grant is server-verified (on-chain quests re-verified against the chain, deploy proofs checked against the user's namespace; self-report/social IDs are rejected here and must use the claim flow). Idempotent; rate-limited per address |
| `GetUserQuests` | No | Public quest progress for any address: completions, `total_xp`, `verified_xp`, plus self-report claim statuses (lifecycle only — proof contents are never exposed on this public read) |
| `SyncQuests` | ✅ | Import localStorage completions (batch capped at 200). Each entry passes the same server-side verification as `CompleteQuest`; unknown/unverifiable IDs are skipped, duplicates ignored, `completed_at` preserved. Rate-limited |
| `GetUserRank` | No | Rank tier (0 Newcomer → 7 Gno Guardian), total XP, and XP to next rank for any address |
| `GetLeaderboard` | No | XP leaderboard (default 50, max 100, offset pagination) from the `user_ranks` cache; recomputed from completions when stale |
| `SubmitQuestClaim` | ✅ | Submit proof (URL and/or text) for a **self-report** quest only. A rejected claim reopens as pending on resubmit; pending/approved claims are untouched. Rate-limited (stricter claim bucket) |
| `ReviewQuestClaim` | Admin | Approve or reject a pending claim. Approval grants the completion (and XP). Concurrent-review safe: exactly one review can decide a claim |
| `ListPendingClaims` | Admin | List pending self-report claims with proof, oldest first (max 100) |
| `GetAttestationVouchers` | No | Backend-signed vouchers (Q-05) the user broadcasts to the `memba_quest_attestation_v1` realm, plus realm path + signer pubkey. Empty when the attestation signer is not configured |

### Teams

| RPC | Auth | Description |
|-----|------|-------------|
| `CreateTeam` | ✅ | Create a team; the creator becomes an admin member. Returns the invite code |
| `GetTeam` | ✅ | Get a team by ID — caller must be a member |
| `GetMyTeams` | ✅ | List all teams the caller belongs to |
| `JoinTeam` | ✅ | Join a team via its 8-char invite code |
| `LeaveTeam` | ✅ | Leave a team; the last admin cannot leave (transfer the role first) |
| `UpdateTeamMemberRole` | ✅ | Change a member's role (member/admin) — team admins only |

### Marketplace (agents)

| RPC | Auth | Description |
|-----|------|-------------|
| `FavoriteAgent` | ✅ | Toggle a favorite on an agent (adds if absent, removes if present) |
| `GetFavorites` | ✅ | List the caller's favorited agent IDs |
| `GetAgentStats` | No | Public view + favorite counts for an agent |

### Service Listings

| RPC | Auth | Description |
|-----|------|-------------|
| `CreateServiceListing` | ✅ | Create a freelance service listing (title, category, price in ugnot, delivery days, tags) |
| `GetServiceListings` | No | List active listings, optional category filter, cursor pagination (default 50) |
| `UpdateServiceListing` | ✅ | Update a listing — owner only; empty/zero fields mean "no change"; `active` toggles pause |

### NFT Marketplace (indexer cache)

| RPC | Auth | Description |
|-----|------|-------------|
| `GetNFTCollection` | No | Cached collection stats (supply, floor, volume, sales, listings, royalty). Floor/listings may be 0 when the marketplace home route is unreachable |
| `GetNFTActivity` | No | Recent sales for a collection, newest first, from the event-sourced `nft_sales` table (default 20, max 100) |
| `GetNFTPortfolio` | No | All cached tokens owned by an address, across collections |
| `ListNFTTokens` | No | Cached tokens for a collection, optionally listed-only |

### Home

| RPC | Auth | Description |
|-----|------|-------------|
| `GetHomeSnapshot` | No | Server-assembled, cached dashboard snapshot (network pulse, ecosystem counts, featured DAO, validators health, directory preview). Every source is independently fault-tolerant — failures degrade to zero values and are named in `stale_sources`; the call never fails wholesale |

## REST Endpoints (non-RPC)

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check → `{"status":"ok"}` |
| `GET /github/oauth/state` | No | Generate CSRF state token (256-bit, 10min TTL, one-time-use) |
| `GET /github/oauth/exchange?code=X&state=Y` | No | Exchange GitHub OAuth code for user info (validates CSRF state) |

## Protocol

- **Transport**: ConnectRPC (compatible with gRPC-Web)
- **Serialization**: Protocol Buffers (binary) or JSON
- **Base URL**: `https://memba-backend.fly.dev` (production) / `http://localhost:8080` (dev)
- **Health**: `GET /health` → `{"status":"ok","timestamp":"..."}`

## Authentication Flow

```
Client                          Server
  │                                │
  │── GetChallenge() ─────────────►│  Generate nonce + ed25519 sign
  │◄─ Challenge (nonce, sig) ──────│
  │                                │
  │  Build TokenRequestInfo:       │
  │  - kind: "Login to Memba..."   │
  │  - challenge: (from above)     │
  │  - user_pubkey_json OR         │
  │    user_address                │
  │  - user_bech32_prefix: "g"     │
  │                                │
  │  NOTE: ADR-036 signing skipped │
  │  (Adena UNSUPPORTED_TYPE)      │
  │                                │
  │── GetToken(info, "") ─────────►│  Validate challenge
  │◄─ Token (address, expiry) ─────│  → derive address from pubkey or
  │                                │    use direct address
  │                                │  → server-signed token (24h)
  │                                │
  │── Any RPC(auth_token: Token) ─►│  ValidateToken() on each call
```

> **Security note**: ADR-036 `sign/MsgSignData` is not supported by the Adena wallet
> (returns `UNSUPPORTED_TYPE`). Auth relies on the server-validated challenge (nonce +
> expiry + server ed25519 signature) and Adena's client-side wallet ownership verification.
> When `user_pubkey_json` is provided, the address is derived server-side from the public key.
> When only `user_address` is provided (accounts without on-chain pubkey), the address is
> trusted from the Adena connection.

## Key Messages

| Message | Fields |
|---------|--------|
| `Challenge` | nonce (bytes), expiration (RFC3339), server_signature |
| `Token` | nonce (base64), expiration (RFC3339), user_address, server_signature |
| `TokenRequestInfo` | kind, challenge, user_bech32_prefix, user_pubkey_json (opt), user_address (opt) |
| `Multisig` | chain_id, address, pubkey_json, threshold, members_count, joined, name |
| `Transaction` | id, chain_id, multisig_address, msgs_json, fee_json, signatures[], final_hash, verified |
| `Signature` | value, user_address, body_bytes, created_at |
| `UserQuestState` | completed[], total_xp, verified_xp (proof-backed XP only — feeds the 350-XP candidature gate) |

> **`Transaction.verified` semantics (W2.3)**: at `CompleteTransaction` time the backend
> does a best-effort reconcile of the client-supplied `final_hash` against the chain's
> Tendermint `/tx` endpoint. `verified=true` means the hash was found on-chain at
> completion time. `verified=false` means the hash is **client-claimed and unconfirmed** —
> either the chain answered "not found", the lookup was unavailable, or the row predates
> the reconcile (pre-migration rows are all `false`). Chain availability never blocks
> completion: any transport problem stores `verified=false` and the RPC still succeeds.

## Error Codes

| Code | Meaning |
|------|---------|
| `UNAUTHENTICATED` | Missing or invalid/expired token |
| `PERMISSION_DENIED` | Not a member of the multisig/team, not the listing owner, or not a quest admin |
| `NOT_FOUND` | Multisig, transaction, team, listing, or claim doesn't exist |
| `INVALID_ARGUMENT` | Missing required fields, invalid pubkey format, or unknown quest ID |
| `FAILED_PRECONDITION` | Signatures < threshold (CompleteTransaction), or claim already reviewed |
| `RESOURCE_EXHAUSTED` | Per-address rate limit hit (quest writes / claim submissions) |
| `INTERNAL` | Server error (details logged, not exposed to client) |

See `api/memba/v1/memba.proto` for full message definitions.
