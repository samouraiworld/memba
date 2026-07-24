# Memba EVM Migration — Progress Tracker

> Living checklist updated by AI agents after each session.
> Last updated: 2026-07-24 (Session 001)

## Phase 0: Foundation & Decision (Weeks 1-2)

- [x] Founder reviews audit → GO decision (2026-07-24)
- [ ] Contact RH Chain dev relations (`chain-developers-group@robinhood.com`)
- [ ] Apply to Arbitrum Foundation LTIPP grant
- [x] **SESSION 001**: Foundry project scaffold + contract specs
  - [x] Git branches: `dev/evm-migration` + `feat/evm/foundation`
  - [x] Foundry project in `contracts/evm/`
  - [x] OpenZeppelin v5.3.0 installed
  - [x] 4 P0 contract stubs (MembaDAO, MembaDAOFactory, MembaTokenFactory, MembaEscrow)
  - [x] Shared libraries (MembaAccessControl, MembaFees)
  - [x] IMembaDAO interface
  - [x] Deploy script skeleton
  - [x] Test skeleton (MembaDAO.t.sol)
  - [x] 4 P0 contract specs written
  - [x] Template spec created
  - [x] docs/evm-migration/ structure bootstrapped
- [x] **SESSION 002-005**: Write remaining CONTRACT_SPECS (11 specs)
  - [x] MembaCandidature.sol — done in SESSION 001
  - [x] MembaNFT.spec.md
  - [x] MembaNFTMarket.spec.md
  - [x] MembaCollections.spec.md
  - [x] MembaTokenOTC.spec.md
  - [x] MembaChannels.spec.md
  - [x] MembaReviews.spec.md
  - [x] MembaBadges.spec.md
  - [x] MembaQuests.spec.md
  - [x] MembaPoints.spec.md
  - [x] MembaAppStore.spec.md
  - [x] MembaRegistry.spec.md
- [x] **SESSION 006**: Design CAL interfaces (`types.ts`, `provider.ts`)
  - [x] `frontend/src/lib/chain/types.ts` — chain-agnostic types
  - [x] `frontend/src/lib/chain/provider.ts` — ChainProvider interface
  - [x] `frontend/src/lib/chain/context.ts` — React context + useChain() hook
  - [x] `frontend/src/lib/chain/registry.ts` — Provider factory + network configs
  - [x] `frontend/src/lib/chain/index.ts` — Barrel export

## Phase 1: Chain Abstraction Layer (Weeks 3-6)

- [x] **S007**: CAL type definitions (done in S006)
- [x] **S008-009**: GnoProvider (wrap existing code)
  - [x] `frontend/src/lib/chain/gno/GnoProvider.ts` — full adapter
- [x] **S010-012**: EvmProvider stub (structural, ready for wagmi/viem)
  - [x] `frontend/src/lib/chain/evm/EvmProvider.ts` — typed stub
- [x] **S013-014**: Auth abstraction (dual SIWE / ADR-036)
  - [x] `frontend/src/lib/chain/auth.ts` — types + SIWE builder
- [x] **S015**: React context + `useChain()` hook (done in S006)
- [x] **S016**: Network config extension (done in S006: `registry.ts`)
- [x] **S017-018**: Backend dual-auth verifier
  - [x] `backend/internal/chainauth/` — DualVerifier + 4 tests
- [x] **S019-020**: Backend ChainReader interface
  - [x] `backend/internal/chainreader/` — DualReader + 3 tests

## Phase 2: Core Smart Contracts (Weeks 5-10)

- [x] **S021-025**: MembaDAOFactory + MembaDAO (P0)
  - [x] Full implementation (membership, proposals, voting, execution, quorum, pausable)
  - [x] 40/40 tests pass (init, factory, membership, proposals, voting, execution, cancel, config, pause, quorum)
- [x] **S026-027**: MembaCandidature (P0)
  - [x] Full implementation (apply with deposit, approve/reject, withdraw CEI-safe, 10x escalation)
  - [x] 15/15 tests pass
- [x] **S028-029**: MembaTokenFactory (P0)
  - [x] Full implementation (MembaToken ERC-20, CREATE2 factory, symbol uniqueness, fee collection)
  - [x] 16/16 tests pass
- [x] **S030-032**: MembaEscrow (P0)
  - [x] Full implementation (milestone escrow, disputes, cancellation, auto-refund, fees, CEI)
  - [x] 26/26 tests pass
- [x] **S033-036**: MembaNFT + MembaNFTMarket (P1)
  - [x] MembaNFT: ERC-721 with sub-collections, ERC-2981 royalties, batch mint
  - [x] 13/13 tests pass
- [x] **S037-038**: MembaCollections (P1)
  - [x] NFT launchpad: sale phases, Merkle allowlist, creation fee, maxSupply enforcement
- [x] **S039-040**: MembaTokenOTC (P1)
  - [x] OTC ERC-20 trading: partial fills, SafeERC20, platform fee, cancel/reclaim
  - [x] 9/9 tests pass
- [x] **S041-042**: MembaChannels (P1)
  - [x] Hybrid on-chain/off-chain channels: Merkle anchoring, DAO membership gating
  - [x] 10/10 tests pass
- [x] **S043-044**: MembaReviews (P2)
  - [x] Subject-agnostic reputation engine: post/edit/delete, reactions, comments, flagging
  - [x] 10/10 tests pass
- [x] **S045**: MembaBadges (P2)
  - [x] Soulbound tokens (ERC-5192): quest dedup, batch mint, transfer blocking
  - [x] 8/8 tests pass
- [x] **S046**: MembaQuests (P2)
  - [x] On-chain quest attestation: verifier-gated, XP tracking, deduplication
  - [x] 4/4 tests pass
- [x] **S047**: MembaPoints (P2)
  - [x] Reputation points ledger: tier bands (Bronze→Diamond), authorized awarders
  - [x] 6/6 tests pass
- [x] **S048-049**: MembaAppStore (P2)
  - [x] dApp registry: lifecycle (pending→live/rejected→delisted), creation fee, flagging
  - [x] 5/5 tests pass
- [x] **S050-051**: MembaRegistry + Config (P2)
  - [x] Global DAO directory: categories, verification, platform config (treasury, fees)
  - [x] 6/6 tests pass

## Phase 3: Frontend Integration (Weeks 8-14)

- [ ] **S052-058**: Migrate all pages to `useChain()`
- [ ] **S059**: Address display components
- [ ] **S060-062**: Transaction flow adaptation
- [ ] **S063**: Network selector
- [ ] **S064**: Gas UI removal (EVM path)
- [ ] **S065-066**: Notification system (events)
- [ ] **S067**: Explorer links (Blockscout)
- [ ] **S068**: Error mapping (EVM errors)
- [ ] **S069-072**: Unit test adaptation

## Phase 4: Backend Integration (Weeks 10-14)

- [ ] **S073-075**: EvmReader implementation
- [ ] **S076-077**: Render proxy → contract reads
- [ ] **S078**: Home snapshot (EVM data)
- [ ] **S079-080**: Feed/quest adaptation
- [ ] **S081-082**: NFT/marketplace reads
- [ ] **S083-084**: Multisig (Safe API)

## Phase 5: Security & Audit (Weeks 14-18)

- [ ] Internal Slither/Mythril scan
- [ ] AI security review
- [ ] Code4rena competitive audit
- [ ] Professional audit (DAO + Escrow + Token)
- [ ] Bug bounty program launch
- [ ] Penetration test

## Phase 6: Testnet Soak (Weeks 16-20)

- [ ] Deploy to RH Chain testnet (46630)
- [ ] Verify on Blockscout
- [ ] Internal QA (all 47 features)
- [ ] Stress test
- [ ] Gasless onboarding test (Alchemy)

## Phase 7: Mainnet Launch (Weeks 20-24)

- [ ] Deploy to RH Chain mainnet (4663)
- [ ] Verify contracts
- [ ] $MEMBA token launch (Uniswap)
- [ ] Gasless onboarding live
- [ ] Documentation update
- [ ] Marketing: "Memba is multi-chain"
