# Memba EVM Migration — Architecture

> This document captures the Chain Abstraction Layer (CAL) design and contract architecture.
> It is a living document maintained by AI agents and reviewed by the CTO office.
> Source of truth: `CONFIDENTIAL_EVM_STRATEGY_AUDIT.md` §5 and §7.

## Chain Abstraction Layer (CAL)

### Design Principles

1. **Dual-chain**: Memba works on Gno AND EVM simultaneously — runtime chain selection
2. **Feature parity**: No feature disabled on any chain
3. **Single codebase**: No fork; adapters behind interfaces
4. **Testable**: Each adapter unit-testable independently
5. **AI-agent friendly**: Clear interfaces that AI can implement without full context

### Interface Architecture

See `CONFIDENTIAL_EVM_STRATEGY_AUDIT.md` §5.2 for the full `ChainProvider` interface definition.

Key types:
- `ChainFamily = "gno" | "evm"` — discriminator
- `ChainProvider` — wallet, auth, reads, writes, subscriptions, address formatting
- `GnoProvider` — wraps existing `useAdena` + ABCI queries
- `EvmProvider` — wagmi + viem implementation

### Provider Directory Structure

```
src/lib/chain/
├── types.ts              # Shared types & interfaces
├── provider.ts           # ChainProvider interface
├── context.ts            # React context + useChain() hook
├── gno/
│   ├── GnoProvider.ts    # Wraps existing useAdena + ABCI
│   ├── gnoAuth.ts        # ADR-036 login challenge
│   ├── gnoQuery.ts       # resilientAbciQuery wrapper
│   └── gnoAddress.ts     # bech32 utilities
├── evm/
│   ├── EvmProvider.ts    # wagmi + viem implementation
│   ├── evmAuth.ts        # SIWE (EIP-4361) login
│   ├── evmQuery.ts       # viem readContract wrapper
│   ├── evmAddress.ts     # 0x address utilities
│   └── evmContracts.ts   # ABI + address registry
└── registry.ts           # Chain → Provider mapping
```

## Smart Contract Architecture

### Upgrade Pattern: UUPS (EIP-1822)

All stateful contracts deploy behind ERC-1967 proxies with OpenZeppelin `UUPSUpgradeable`.
The Samouraï Coop Safe multisig is the upgrade authority.

### Contract Map

```
contracts/evm/src/
├── core/
│   ├── MembaDAOFactory.sol       # Factory → deploys DAO proxies via CREATE2
│   └── MembaDAO.sol              # Governor + membership logic
├── commerce/
│   ├── MembaTokenFactory.sol     # ERC20 factory (2.5% fee)
│   └── MembaEscrow.sol           # Milestone-based service escrow
├── interfaces/
│   └── IMembaDAO.sol             # Interface for CAL consumption
└── lib/
    ├── MembaAccessControl.sol    # Shared access control
    └── MembaFees.sol             # Fee calculation + distribution
```

### Dependencies

- **Foundry** (forge, cast, anvil) — build/test/deploy
- **OpenZeppelin Contracts v5.3.0** — battle-tested bases
- **OpenZeppelin Contracts Upgradeable v5.3.0** — UUPS + initializer patterns

## Auth Architecture (Dual-Mode)

### Current (Gno): ADR-036

Frontend builds `/vm.m_call` sentinel doc → Adena signs → backend verifies via gno canonical signbytes + secp256k1 + bech32 derivation.

### EVM: SIWE (EIP-4361)

Frontend creates SIWE message → wallet signs plaintext → backend verifies via `ecrecover` → `0x` address.

### Backend Dual-Auth

```go
type AuthVerifier interface {
    VerifyLogin(challenge Challenge, userSig string) (address string, err error)
}

type GnoVerifier struct { ... }  // existing code, wrapped
type EvmVerifier struct { ... }  // new, uses go-ethereum crypto
```

Auto-detection: `0x`-prefixed hex signature = EVM, base64 = Gno.

## Target Chain: Robinhood Chain

- **Type**: Arbitrum Nitro L2 (Ethereum-settled)
- **Chain ID**: 4663 (mainnet), 46630 (testnet)
- **Block time**: ~100ms
- **Gas token**: ETH
- **Contract size limit**: 96KB (4× Ethereum)
- **Tx ordering**: FCFS (no MEV)
