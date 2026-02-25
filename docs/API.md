# Memba — API Reference

> Source: `api/memba/v1/memba.proto` | Protocol: ConnectRPC

## Service: `MultisigService`

| RPC | Auth | Description |
|-----|------|-------------|
| `GetChallenge` | No | Generate a server-signed ed25519 challenge (5min expiry) |
| `GetToken` | No | Validate ADR-036 signature + challenge → auth token (24h) |
| `CreateOrJoinMultisig` | ✅ | Register multisig (pubkey derivation) or join existing |
| `MultisigInfo` | ✅ | Get multisig details + member list |
| `Multisigs` | ✅ | List user's multisigs (filter by chain, join state) |
| `CreateTransaction` | ✅ | Propose a new transaction (membership required) |
| `GetTransaction` | ✅ | Get single transaction by ID (membership required) |
| `Transactions` | ✅ | List transactions (filter by multisig, execution state, cursor pagination) |
| `SignTransaction` | ✅ | Add signature to pending transaction |
| `CompleteTransaction` | ✅ | Record final tx hash after broadcast |

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
  │  - user_pubkey_json            │
  │  - user_bech32_prefix: "g"     │
  │                                │
  │  Sign info_json with Adena     │
  │  (ADR-036 SignAmino)           │
  │                                │
  │── GetToken(info, sig) ────────►│  Validate challenge + ADR-036 sig
  │◄─ Token (address, expiry) ─────│  → server-signed token (24h)
  │                                │
  │── Any RPC(auth_token: Token) ─►│  ValidateToken() on each call
```

## Key Messages

| Message | Fields |
|---------|--------|
| `Challenge` | nonce (bytes), expiration (RFC3339), server_signature |
| `Token` | nonce (base64), expiration (RFC3339), user_address, server_signature |
| `Multisig` | chain_id, address, pubkey_json, threshold, members_count, joined, name |
| `Transaction` | id, chain_id, multisig_address, msgs_json, fee_json, signatures[], final_hash |
| `Signature` | value, user_address, body_bytes, created_at |

## Error Codes

| Code | Meaning |
|------|---------|
| `UNAUTHENTICATED` | Missing or invalid/expired token |
| `PERMISSION_DENIED` | Not a member of the multisig, or invalid signature |
| `NOT_FOUND` | Multisig or transaction doesn't exist |
| `INVALID_ARGUMENT` | Missing required fields or invalid pubkey format |
| `FAILED_PRECONDITION` | Signatures < threshold (CompleteTransaction) |
| `INTERNAL` | Server error (details logged, not exposed to client) |

See `api/memba/v1/memba.proto` for full message definitions.
