# Memba — API Reference

> Auto-generated from `api/memba/v1/memba.proto`.

## Service: `MultisigService`

| RPC | Request | Response | Auth |
|-----|---------|----------|------|
| `GetChallenge` | `GetChallengeRequest` | `GetChallengeResponse` | No |
| `GetToken` | `GetTokenRequest` | `GetTokenResponse` | No |
| `CreateOrJoinMultisig` | `CreateOrJoinMultisigRequest` | `CreateOrJoinMultisigResponse` | Yes |
| `MultisigInfo` | `MultisigInfoRequest` | `MultisigInfoResponse` | Yes |
| `Multisigs` | `MultisigsRequest` | `MultisigsResponse` | Yes |
| `CreateTransaction` | `CreateTransactionRequest` | `CreateTransactionResponse` | Yes |
| `Transactions` | `TransactionsRequest` | `TransactionsResponse` | Yes |
| `SignTransaction` | `SignTransactionRequest` | `SignTransactionResponse` | Yes |
| `CompleteTransaction` | `CompleteTransactionRequest` | `CompleteTransactionResponse` | Yes |

## Protocol

- **Transport**: ConnectRPC over HTTPS
- **Serialization**: Protocol Buffers (binary) or JSON
- **Base URL**: `https://api.memba.samourai.app` (production) / `http://localhost:8080` (dev)

## Authentication

All authenticated endpoints require a `Token` message in the request body.

### Flow

1. `GetChallenge()` → receive server-signed nonce
2. Sign `TokenRequestInfo` with your ed25519 key
3. `GetToken(info_json, signature)` → receive auth token
4. Pass token in subsequent requests

See `api/memba/v1/memba.proto` for full message definitions.
