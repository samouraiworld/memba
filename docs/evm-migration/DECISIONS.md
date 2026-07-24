# Memba EVM Migration — Architecture Decision Records

> ADR log for the EVM migration. Each decision is numbered and immutable once recorded.
> New decisions are appended; existing ones are never modified (add superseding ADRs instead).

---

## ADR-001: UUPS Proxy Pattern for All Contracts

**Date**: 2026-07-24  
**Status**: ✅ Accepted  
**Context**: Need an upgrade mechanism for contracts that's secure and gas-efficient.  
**Decision**: Use UUPS (EIP-1822) proxy pattern via OZ `UUPSUpgradeable` for all stateful contracts.  
**Rationale**:
- Lower gas than Transparent Proxy (no admin-slot check on every call)
- Simpler than Diamond (EIP-2535) — easier to audit
- Upgrade authority restricted to Samouraï Coop Safe multisig
- OZ v5 has mature UUPS support with `_disableInitializers()` pattern

**Alternatives considered**:
- Immutable (no proxy): Too risky for first deploy — can't fix bugs
- Transparent Proxy: Higher gas, admin confusion
- Diamond (EIP-2535): Over-engineered for our use case

---

## ADR-002: Foundry as Build/Test/Deploy Toolchain

**Date**: 2026-07-24  
**Status**: ✅ Accepted  
**Context**: Need a Solidity toolchain for development, testing, and deployment.  
**Decision**: Use Foundry (forge, cast, anvil) exclusively.  
**Rationale**:
- Native Solidity tests (no JavaScript test overhead)
- Built-in fuzzing (`forge test --fuzz-runs`)
- Fastest compilation in the ecosystem
- `forge script` for deterministic deployments
- `cast` for on-chain interaction
- Active development, industry standard as of 2026

**Alternatives considered**:
- Hardhat: Slower compilation, JavaScript tests add complexity
- Remix: Not suitable for production workflows

---

## ADR-003: OpenZeppelin v5.3.0 as Base Contract Library

**Date**: 2026-07-24  
**Status**: ✅ Accepted  
**Context**: Need battle-tested base contracts for access control, upgradeability, token standards.  
**Decision**: Use OpenZeppelin Contracts v5.3.0 and OpenZeppelin Contracts Upgradeable v5.3.0.  
**Rationale**:
- Industry standard, heavily audited
- v5 uses custom errors (gas savings)
- v5 uses `Initializable` with `_disableInitializers()` pattern
- ERC-7201 namespaced storage support
- Comprehensive Governor, AccessControl, Pausable, ReentrancyGuard

**Pinned version**: v5.3.0 — do not upgrade without explicit session approval.

---

## ADR-004: Contracts in `contracts/evm/` Subdirectory

**Date**: 2026-07-24  
**Status**: ✅ Accepted  
**Context**: The existing `contracts/` directory contains Gno realm references (README.md). Need to colocate EVM contracts without disrupting existing structure.  
**Decision**: Place all Solidity contracts in `contracts/evm/` with its own `foundry.toml`.  
**Rationale**:
- Clean separation from Gno realm references
- Independent toolchain (Foundry has its own config)
- Avoids confusion — `contracts/README.md` explains the dual structure
- `contracts/evm/` is self-contained (src, test, script, lib, remappings)
