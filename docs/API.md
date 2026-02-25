# Memba — API Reference

> Source: `api/memba/v1/memba.proto` | Protocol: ConnectRPC

## Service: `MultisigService`

| RPC | Auth | Description |
|-----|------|-------------|
| `GetChallenge` | No | Generate a server-signed ed25519 challenge (5min expiry) |
| `GetToken` | No | Validate challenge + optional ADR-036 sig → auth token (24h) |
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
