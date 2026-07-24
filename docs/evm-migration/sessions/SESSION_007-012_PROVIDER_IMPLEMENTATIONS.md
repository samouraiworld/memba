# Session Handoff — SESSION_007-012_PROVIDER_IMPLEMENTATIONS

## Session Metadata
- **Date**: 2026-07-24
- **Agent**: Claude Opus 4 (Thinking)
- **Branch**: `feat/evm/foundation`
- **Continuation of**: SESSION_006_CAL_INTERFACES

## What Was Done

Implemented both ChainProvider concrete classes: GnoProvider (full adapter wrapping existing code) and EvmProvider (typed stub ready for wagmi + viem).

### GnoProvider — `frontend/src/lib/chain/gno/`
- [x] [GnoProvider.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/gno/GnoProvider.ts) — Full implementation:
  - **DAO reads**: Wraps `getDAOConfig()`, `getDAOMembers()`, `getDAOProposals()`, `getProposalDetail()` from `lib/dao/`
  - **DAO writes**: Wraps `buildVoteMsg()`, `buildExecuteMsg()`, `buildProposeMsg()`, `buildProposeAddMemberMsg()`, `buildProposeRemoveMemberMsg()` via `doContractBroadcast()`
  - **Token reads**: Wraps `listFactoryTokens()` from `lib/grc20.ts`
  - **NFT reads**: Wraps `listCollectionTokens()`, `getNFTOwner()`, `getTokenURI()` from `lib/grc721.ts`
  - **Error normalization**: Maps Gno-specific errors (user rejected, insufficient funds, not a member, timeout) to `ChainErrorCode`
  - **Wallet bridge**: `GnoProviderExtended.setWalletState()` — syncs wallet state from useAdena hook
  - **Escrow/token writes**: Throw `"not yet implemented"` — will wire up when escrow/tokenfactory CAL integration is prioritized

### EvmProvider — `frontend/src/lib/chain/evm/`
- [x] [EvmProvider.ts](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/lib/chain/evm/EvmProvider.ts) — Structural stub:
  - Every ChainProvider method is typed and implemented
  - Read methods return empty/null (no contracts deployed yet)
  - Write methods throw `"not yet implemented"` with correct `ChainError`
  - Ready for wagmi `useConnect()`/`useAccount()` + viem `readContract()`/`writeContract()`

### Design Decisions
- **Zero duplication**: GnoProvider delegates 100% to existing functions — no re-implementation
- **Wallet management**: Gno wallet is managed by the existing `useAdena` hook; GnoProvider reads state from it via the `setWalletState()` bridge
- **Error normalization**: `ChainError` with typed codes replaces ad-hoc string matching in UI components
- **Progressive enhancement**: EvmProvider is a typed shell — when contracts deploy, fill in `readContract()` calls against the ABIs from the contract specs

## Audit Results
| Gate | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| No existing code modified | ✅ All additive — 4 new files in `frontend/src/lib/chain/gno/` and `evm/` |

## What's Next
- **S013-014**: Auth abstraction (dual SIWE for EVM / ADR-036 for Gno)
- **S017-020**: Backend dual-auth verifier + ChainReader interface
