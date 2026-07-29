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

---

## ADR-005: MembaDAOFactory Stays Non-Upgradeable

**Date**: 2026-07-24  
**Status**: ✅ Accepted  
**Context**: `MembaDAOFactory` is the only non-proxy, non-upgradeable contract in the set. C-4 raised whether to make it upgradeable while fixing its ownership handover.  
**Decision**: Keep the factory non-upgradeable. Hand ownership to the Safe via `Ownable2Step` (see DEPLOY_CEREMONY.md step 3); do not proxy it.  
**Rationale**:
- It holds no funds and no per-DAO authority. Each DAO is an independent `ERC1967Proxy` that copies the implementation into its own ERC-1967 slot at construction, so the factory retains no upgrade power over already-created DAOs.
- The one "upgrade" it plausibly needs — swapping the DAO template — is already served by `setImplementation` (owner-gated) without proxying the factory.
- CREATE2 pre-computation of DAO addresses depends on the factory's address and init code staying fixed; making it upgradeable would break that stability for zero benefit and add attack surface (same E-4 reasoning as MembaDAO keeping AccessControl over a second upgrade path).
- Ownership is rotatable (two-step) but not renounceable: `renounceOwnership` reverts `OwnershipCannotBeRenounced`, so authority can never be destroyed (which would freeze `setImplementation` forever).

---

## ADR-006 — The CAL relays what a chain reports; it never derives it

**Date**: 2026-07-29 · **Status**: Accepted · **Context**: B-5 Phase 3 wave 1 (BACKLOG B-7)

### Context

Phase 3 wave 1 was blocked on a question the plan never answered: the DAO hooks
render `author`, `yesPercent` and `noPercent`, and `CALProposal` carried none of
them — only `proposer: ChainAddress` and raw vote counts. `CALDAOConfig.threshold`
was basis points where the lib returned the realm's display string (`"66%"`).

Two options: (a) pages consume raw counts and derive the percentages, or
(b) the CAL carries what the chain reported.

### Decision

**(b).** Reported values ride alongside the canonical ones and are `undefined`
when a chain does not report them. They are never computed from the counts.

### Rationale

- The Gno realm **publishes its own vote percentages**. Re-deriving
  `yesVotes / totalVoters` can disagree with it under weighted voting or
  rounding. On a surface that tells a user whether a proposal passed, a number
  the chain does not agree with is a correctness bug, not a cosmetic one.
- These are not new data. The lib's `DAOProposal` already had `author`,
  `yesPercent`, `noPercent` and `enrichFailed`; the CAL was **discarding** them.
  Carrying them stops data loss rather than inventing anything.
- `enrichFailed` mattered most: it distinguishes "the vote RPCs failed" from
  "nobody voted". Dropping it would have made a failed read render as a genuine
  zero-vote proposal — the CAL would have introduced a data-honesty bug the
  direct path did not have. It is now `votesUnavailable`.
- The alternative — every consumer deriving its own percentages — guarantees
  drift between pages, and puts the same arithmetic in N places.

### Consequences

- `CALProposal` gains `author?`, `yesPercent?`, `noPercent?`, `votesUnavailable?`.
- `CALDAOConfig` gains `thresholdLabel?` — the chain's own wording, so the UI
  never re-renders a number back into a string and disagrees with the realm.
- **EVM providers leave all of them `undefined`**, with the reason recorded at
  the call site: `MembaDAO` exposes an address and raw counts and publishes
  neither a display name nor its own percentages. Filling them there would
  manufacture agreement that does not exist.
- `undefined` means "not reported", and consumers already omit the figure rather
  than showing a fabricated one.
- A chain-family-specific field (e.g. Gno's `memberstorePath`) does **not** get
  this treatment — that is what keeps the type chain-agnostic, and it is why
  `useYourWorlds` remains on the direct path (BACKLOG B-8).

### Also fixed under this decision

`GnoProvider.getDAOConfig` ran `Math.round(parseFloat(threshold) * 100)` on a
truthy threshold. A non-numeric one (`"supermajority"`) made `parseFloat` return
NaN, which `Math.round` passed straight through — so `threshold` could be **NaN**,
which is neither a number nor the honest `null` the surrounding code was written
to produce. Unparseable now means unreported.
