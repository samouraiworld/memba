# Session Handoff — SESSION_006_CAL_INTERFACES

## Session Metadata
- **Date**: 2026-07-24
- **Agent**: Claude Opus 4 (Thinking)
- **Branch**: `feat/evm/foundation`
- **Continuation of**: SESSION_002-005

## What Was Done

Designed and implemented the Chain Abstraction Layer (CAL) TypeScript interfaces. These are the foundational types and interfaces that decouple the Memba frontend from the underlying blockchain (Gno vs EVM).

### Files Created
- [x] [types.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/types.ts) — All chain-agnostic types:
  - `ChainFamily` ("gno" | "evm"), `ChainId` (5 known chains)
  - `ChainAddress` with type guards and formatting
  - `TxResult`, `ContractRef`, `TokenInfo`, `NativeToken`
  - `CALMember`, `CALProposal`, `CALDAOConfig` — DAO abstraction
  - `CALNFT` — NFT abstraction
  - `CALEscrowContract`, `CALMilestone` — Escrow abstraction
  - `CALNetworkConfig` — unified network config (Gno + EVM fields)

- [x] [provider.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/provider.ts) — `ChainProvider` interface:
  - Wallet: `connect()`, `disconnect()`, `getWalletState()`, `isConnected()`
  - Auth: `signLoginChallenge()` (ADR-036 for Gno, SIWE for EVM)
  - DAO reads: `getDAOConfig()`, `getDAOMembers()`, `getDAOProposals()`
  - DAO writes: `propose()`, `vote()`, `executeProposal()`, `addMember()`, `removeMember()`
  - Token reads/writes: `getTokenInfo()`, `createToken()`, `mintTokens()`
  - NFT reads: `getNFTsByOwner()`, `getNFT()`
  - Escrow: `createEscrowContract()`, `fundMilestone()`, `completeMilestone()`, `releaseFunds()`
  - Utilities: explorer URLs, address parsing, native balance
  - `ChainError` class with normalized error codes

- [x] [context.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/context.ts) — React integration:
  - `ChainContext` — React context
  - `useChain()` — hook with safety guard
  - `ChainContextValue` — provider + family + switchChain + availableNetworks

- [x] [registry.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/registry.ts) — Provider factory:
  - `registerProviderFactory()` — plugin architecture
  - `getProvider()` — cached provider creation
  - `ALL_NETWORKS` — Gno (topaz-1, test-13) + EVM (RH mainnet/testnet)
  - Network lookup utilities

- [x] [index.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/index.ts) — Barrel export

## Audit Results
| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors — CAL compiles cleanly, zero regressions |
| No existing code modified | ✅ All additive — 5 new files in `frontend/src/lib/chain/` |

## Design Decisions
- **No runtime dependency**: CAL types/interfaces have zero imports from wagmi/viem/adena — provider implementations will import those
- **Plugin architecture**: `registerProviderFactory("gno", createGnoProvider)` enables lazy loading
- **Cached providers**: One provider instance per chainId, avoiding duplicate RPC connections
- **Type safety**: `ChainAddress` wraps raw strings with family discriminator — impossible to pass Gno address to EVM-only function

## What's Next
- **Phase 1 starts**: SESSION 007 — CAL type definitions refinement + GnoProvider implementation (wrap existing code)
- Phase 0 is now **COMPLETE** (Sessions 001–006)
