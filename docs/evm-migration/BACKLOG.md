# EVM Migration — Deferred Work Tracker

> **Purpose.** One place where everything not-yet-done is written down, so nothing
> survives only in a session's context. Every item has an ID, a source, a reason it is
> still open, and what "done" looks like.
>
> **Rule.** Nothing gets deferred silently. If work is skipped, capped, or scoped down,
> it lands here with the reason — including work skipped for good reasons. An empty or
> stale backlog is not evidence of progress; this project already learned that from
> KNOWN_ISSUES.md sitting empty through 21 commits while a fund-theft path accumulated.
>
> Severity/detail for security items: [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md).
> Status of individual defects: [KNOWN_ISSUES.md](KNOWN_ISSUES.md).

**Last swept:** 2026-07-24 (branch `feat/evm/remediation`, after A-2..A-10 + C-6 + C-7 — all of section A closed)

---

## A. Open defects — blocks testnet deployment

| ID | Item | Why still open | Done when |
|---|---|---|---|
| ~~A-1~~ | ~~`MembaCollections.mintNFT` can never succeed~~ | ✅ **fixed** 2026-07-24 — `MembaNFT.setLaunchpad` authorises the proxy to mint (creator keeps royalties); `createCollection` binds registration to the sub-collection's owner so that authorisation cannot be abused. 18 tests, from zero. | — |
| ~~A-2~~ | ~~`Deploy.s.sol` never grants `ADMIN_ROLE` to `MembaCandidature`~~ | ✅ **fixed** 2026-07-24 — documented Safe ceremony step (`docs/evm-migration/DEPLOY_CEREMONY.md` step 1), the deploy script now prints an `ACTION REQUIRED (Safe tx)` line with the DAO + grantee addresses, and two tests pin the behaviour: `test_A2_MarkApprovedRevertsWithoutDAOAdminGrant` (un-granted deploy fails loudly with `AccessControlUnauthorizedAccount`) and `…SucceedsAfterSafeGrant`. **Found a sibling:** the A-1 Collections launchpad also needs a Safe `setLaunchpad` — documented as ceremony step 2 + its own `ACTION REQUIRED` line. | — |
| ~~A-3~~ | ~~`MembaTokenOTC`: fee-on-transfer/rebasing tokens let one listing's fill drain another seller's escrowed tokens~~ | ✅ **fixed** 2026-07-24 — `list` now records the amount **actually received** (balance-delta), so every listing's `totalAmount` is backed by real balance and the sum of open escrows can never exceed the contract's holdings. Fee-on-transfer / rebasing / returns-false / fully-confiscating mocks added (`test/mocks/Tokens.sol`). ⚠️ A downward rebase remains an inherent shared-pool limitation — noted below. | — |
| ~~A-4~~ | ~~`MembaTokenOTC.unitPrice` is per **base unit** and decimals-unaware~~ | ✅ **fixed** 2026-07-24 — `unitPrice` is now wei per **whole token**; `fill` converts through the token's decimals (snapshotted at `list`) via `Math.mulDiv(..., Rounding.Ceil)` so rounding never favours the buyer. Missing `decimals()` falls back to per-base-unit. Tested with an 18-decimal factory token. | — |
| ~~A-5~~ | ~~`MembaTokenOTC` accepts an unbounded `feeBps` at init with no `MAX_FEE_BPS` and no setter~~ | ✅ **fixed** 2026-07-24 — `MAX_FEE_BPS = 2000` checked at init and in a new `setPlatformFee` admin setter (mirrors `MembaEscrow`). | — |
| ~~A-3b~~ | ~~`MembaTokenOTC` `fill` reverts if the seller/fee recipient rejects ETH; no `setFeeRecipient`~~ | ✅ **fixed** 2026-07-24 — ported the escrow ISSUE-005 pull-payment: all three ETH legs (seller proceeds / fee / buyer excess-refund) push with a 30k-gas stipend and **credit `withdrawable` on failure** instead of reverting, so no seller can veto its own listing and no reverting shared fee-recipient can brick every fill. Added `withdraw` (nonReentrant, non-pausable), `setFeeRecipient` (onlyAdmin), a `withdrawable` getter, and `withdrawable` appended to `OTCStorage`. 12 tests incl. a solvency invariant (`balance == Σ withdrawable` when all three legs reject). Post-impl adversarial review: **SOUND**. |
| ~~A-6~~ | ~~Backend `evmreader.GetDAOMembers` can never return a member~~ | ✅ **fixed** 2026-07-24 — decode extracted to `decodeMemberView`, which converts the tuple with `abi.ConvertType` (handles geth's tag-carrying anonymous struct) and **returns an error** instead of `continue`-ing past a miss. `TestDecodeMemberView_RoundTrip` packs a member and proves it round-trips (was observed failing "unexpected return shape" against the old assertion). | — |
| ~~A-7~~ | ~~Backend: unauthenticated remote OOM-kill via attacker-chosen `count`~~ | ✅ **fixed** 2026-07-24 — `boundedMemberCount` rejects negative / int64-overflow / above-cap counts before the `make`; cap is `Config.MaxMembers` (default 1000 = MembaDAO.MAX_MEMBERS). `TestBoundedMemberCount` covers each branch. ⬜ A known-DAO **allowlist** is still worth adding (A-7b) — noted below. | — |
| ~~A-8~~ | ~~Backend `evmrender` routes bypass middleware; no address validation~~ | ✅ **fixed** 2026-07-24 — `RegisterRoutes(mux, wrap Middleware)` now **requires** a middleware wrapper (impossible to register bare), and `requireAddr` rejects non-hex / cropped-hex path values with 400 before any read. `TestHandler_RejectsInvalidAddresses` covers aliasing + malformed inputs. Wiring into `main.go` with the real rate-limit/auth middleware is left to the founder decision on activating the EVM backend (still imported by nothing). | — |
| **A-7b** | `evmreader` still accepts any DAO address from the URL path; the count cap bounds the blast radius but an allowlist of known DAO addresses would reject unknown targets outright. | Not started — needs the deployed DAO address set wired into `Config`. | `Config.KnownDAOs` allowlist; `resolveDAO`/handlers 404 an unknown address. |
| ~~A-9~~ | ~~Candidature strands ETH two ways~~ | ✅ **fully fixed** 2026-07-24. **(1)** `submitApplication` reverts `OutstandingDeposit` if a prior application still holds a deposit (withdraw-first). **(2)** Founder decision = **forfeit**: `markApproved` now sweeps the deposit to a `feeRecipient` treasury as a one-time membership fee (deposit zeroed → unwithdrawable, CEI + `nonReentrant`). Added `feeRecipient` to storage/init (mirrors the other fee contracts), `updateFeeRecipient`, a getter, and `DepositForfeited`/`FeeRecipientUpdated` events. `Deploy.s.sol` now passes `treasury`. Neither the DAO (no `receive`) nor the deployer could be the sink — the treasury is. 6 Candidature tests cover forfeit / can't-withdraw / rejecting-treasury / setter. | — |
| ~~A-10~~ | ~~Overpayment confiscated on `MembaTokenFactory` and `MembaAppStore`~~ | ✅ **fixed** 2026-07-24 — both now use a `_settle(recipient, owed)` helper mirroring `MembaCollections` (pay the fee, refund `msg.value - owed`). `MembaAppStore` had **no reentrancy guard and no test file at all**; added `ReentrancyGuardUpgradeable` + `nonReentrant` on `registerApp`, and a first test suite. 9 tests across `MembaTokenFactory.moneypaths.t.sol` + `MembaAppStore.moneypaths.t.sol` (overpay refund, exact payment, fee-recipient rejection, refund-to-rejecting-caller). All three `_settle` instances (Collections/Factory/AppStore) are candidates to fold into the C-6 helper. | — |

## B. Open defects — auth / frontend

| ID | Item | Why still open | Done when |
|---|---|---|---|
| **B-1** | The `chainauth.Verifier` interface takes only a raw `[]byte` nonce, so it **cannot express** challenge authenticity, expiry, single-use, or chain binding — re-opening `AUTH-CHAINID-01`, which the Gno path enforces. | Needs a design decision on the shared challenge type before code. **No EVM verifier exists yet**, so nothing is bypassable today. | Interface carries the server-signed challenge; verifiers share `markNonceUsed`; returned address is `ecrecover`-derived, not the submitted one. |
| **B-2** | EVM login is blind `personal_sign` of a bare nonce — not SIWE. `buildSiweMessage` exists, has zero callers, and doesn't EIP-55 checksum the address, so standard verifiers would reject its output anyway. | Blocked on B-1. | viem's `createSiweMessage`/`verifySiweMessage` replace the hand-rolled builder; domain/chainId/expiry bound and verified server-side. |
| **B-3** | CAL `switchChain` conflicts with the frozen-at-import network model in `config.ts`. Mounting `NetworkSelector` would hard-block every Gno broadcast via `assertWalletBroadcastSafe`. Two persisted keys with different id spaces (`memba:activeChainId="topaz-1"` vs `memba_network="topaz"`). | Requires refactoring `config.ts` from module-level `const`s to an observable store — a large, separately-reviewable change that should precede any UI chain switching. | CAL reads/writes the existing `memba_network` key and keeps the reload-on-switch contract, **or** `config.ts` is refactored first. |
| **B-4** | Gno per-network RPC is ignored: `grc721` resolves the endpoint from a module-level `GNO_RPC_URL`, so `config.rpcUrl` has no effect on NFT reads. | Fixing it means threading the endpoint through `grc721` — separate change, documented at the call site in `GnoProvider`. | `getNFTOwner`/`getTokenURI`/`listCollectionTokens` take an explicit endpoint. |
| **B-5** | The CAL is still **unmounted dead code** — `ChainContextProvider` is not in `main.tsx`, zero pages use `useChain()`, and 40 files still import `useAdena`. Plan §12 S052-058 ("87 pages migrated") has not started. | Deliberate: mounting it before B-3 is fixed would break live Gno broadcasts. | One page wired end-to-end (the plan's Phase-V validation step), then the rest. |
| **B-6** | Zero unit tests for the entire CAL (430 test files in the frontend, none reference `lib/chain`). Tests are also excluded from `tsconfig.app.json`, and there is no `vitest.config.*`. | Not started. | Provider tests against mocked clients; the interface is mock-friendly by design. |

## C. Code TODOs — swept from source 2026-07-24

| ID | Location | Item |
|---|---|---|
| ~~C-1~~ | ~~`src/lib/MembaAccessControl.sol`~~ | ✅ **deleted** 2026-07-24 — zero importers, 0% coverage, never implemented. |
| ~~C-2~~ | ~~`src/lib/MembaFees.sol`~~ | ✅ **deleted** 2026-07-24. Note the fee math it was meant to hold is still hand-rolled inline in five contracts — consolidating that is a separate, real task (now **C-6**). |
| ~~C-3~~ | ~~`src/interfaces/IMembaDAO.sol`~~ | ✅ **deleted** 2026-07-24 — zero importers. `MembaCandidature` and `MembaChannels` still each declare their own local duplicate; consolidating those two is **C-7**. |
| ~~C-4~~ | ~~`MembaDAOFactory` ownership + TODO~~ | ✅ **fixed** 2026-07-24 — factory is now `Ownable2Step`; `Deploy.s.sol` calls `transferOwnership(safe)` (+`ACTION REQUIRED` log) so the deployer no longer keeps `setImplementation` after the Safe accepts (**DEPLOY_CEREMONY.md step 3**). `renounceOwnership` disabled (authority rotatable, never destroyable). Stale TODO resolved: the factory already meets the spec; added spec-named `getDaoCount`/`getDao` aliases. Kept non-upgradeable as a recorded decision (**ADR-005**). 11 tests incl. deployer-locked-out-after-handover and a proof that rotating the template leaves existing DAOs untouched. |
| ~~C-6~~ | ~~bps fee math hand-rolled inline~~ | ✅ **done** 2026-07-24 — `src/lib/MembaFees.sol` (`feeOf(amount, bps)`) now holds the formula; the 6 inline `amount * bps / 10_000` sites (Escrow ×5, OTC ×1) call it, byte-identical. `test/MembaFees.t.sol` incl. a fuzz test proving equivalence to the inline expression; all Escrow/OTC tests unchanged. Note: TokenFactory/AppStore/Collections use **flat** fees (no bps), and MembaDAO's `10_000` are voting ratios — correctly out of scope. ⬜ The 3 `_settle` refund helpers were **not** merged: each reverts a contract-specific error (`FeeTransferFailed` vs `TransferFailed`), so a shared helper would change revert selectors — deferred as A-10b if ever wanted. |
| ~~C-7~~ | ~~`IMembaDAO`/`IMembaDAOMember` duplicated~~ | ✅ **done** 2026-07-24 — `src/interfaces/IMembaDAO.sol` is the single declaration; `MembaCandidature` and `MembaChannels` both import it (Channels used only `isMember`, the superset is harmless). No ABI change. |
| **C-5** | `frontend/src/lib/chain/gno/GnoProvider.ts` (×6) | Unimplemented provider methods returning empty/null: `getTokenInfo`, `getTokenBalance`, `createToken`, `mintTokens`, escrow reads, native balance. Half the interface silently returns "no data" rather than "unsupported". |

## D. Test backlog (from the test-quality audit)

Target tiers — a global floor is not enough for funds-at-risk contracts:

| Tier | Contracts | Line | Branch | Func |
|---|---|---:|---:|---:|
| T1 — funds at risk | Escrow, TokenOTC, TokenFactory, Token, Collections, Candidature | ≥95% | ≥90% | 100% |
| T2 — authority | DAO, DAOFactory, Channels, Registry, Badges, NFT | ≥90% | ≥80% | 100% non-view |
| T3 — social | Reviews, AppStore, Points, Quests | ≥85% | ≥70% | ≥90% |

**Current: 81.35% line / 56.12% branch / 73.21% func.** CI floors are 79/52/71.

| ID | Item | Status |
|---|---|---|
| **D-1** | Malicious-receiver mocks | ✅ done (`test/mocks/Receivers.sol`) |
| **D-2** | Escrow reentrancy + negative tests | ✅ done (`MembaEscrow.moneypaths.t.sol`) |
| **D-3** | Escrow invariant suite | ✅ done (`test/invariant/EscrowInvariants.t.sol`) |
| **D-4** | Upgrade tests | ✅ done for Escrow/Badges/Quests (`UpgradeAuthority.t.sol`); **9 contracts still have none** |
| **D-5** | `MembaCollections` test suite | ✅ done — 18 tests, incl. a real 2-leaf merkle tree |
| **D-6** | OTC 18-decimal + fee-on-transfer suite | ✅ done — `test/MembaTokenOTC.moneypaths.t.sol` (13 tests: cross-listing drain, whole-token pricing, ceiling rounding, fee-cap, plus rebasing/returns-false/no-decimals mocks) |
| **D-7** | Replace 13 bare `vm.expectRevert()` with specific selectors | ⬜ open |
| **D-8** | Delete/rewrite the 4 constant-assertion tests that assert literals against literals | ⬜ open |
| **D-9** | Event assertions — **1 `vm.expectEmit` in the whole suite**, against ~45 events. Events are the indexer's only data source. | ⬜ open |
| **D-10** | Access-control negative matrix (every privileged fn × unauthorised caller classes) | ⬜ open |
| **D-11** | Cross-contract integration tests (Candidature→DAO, Collections→NFT, Factory→Token→OTC) | ⬜ open |
| **D-12** | Gas/DoS tests at bounds (MAX_MILESTONES, MAX_MEMBERS, unbounded `roots`/`listDAOs`/`listApps` arrays) | ⬜ open |
| **D-13** | `Deploy.s.sol` is 0% covered — a `test_DeployScript_WiresEverything` is the cheapest catch for a misconfigured mainnet deploy | ⬜ open |

## E. Deliberate caps and decisions — recorded, not hidden

| ID | Decision | Rationale | Revisit when |
|---|---|---|---|
| **E-1** | Slither fails CI on **HIGH only**; MEDIUM/LOW are reported and uploaded but do not block. | First real run had 0 High / 0 Medium / 16 Low / 42 Info. Tightening before the Low queue is triaged would block every PR on pre-existing noise. | The 16 Lows are triaged (6 `calls-loop` already corroborated a real defect). |
| **E-2** | Invariant runs split: default 32×64, CI 256×500. | CI depth takes ~280s; the default has to be fast enough to run on every local change. | If a defect is found that only the deep profile catches, raise the default. |
| **E-3** | Coverage floors set a point below measurement (79/52/71 vs 80.66/53.20/72.97). | An exactly-equal floor reds the build on measurement noise. Ratchet still only moves up. | Each time coverage rises materially. |
| **E-4** | `MembaDAO` not converted to `MembaUpgradeAuthority`. | `AccessControl` already makes `DEFAULT_ADMIN_ROLE` grantable/revocable; two parallel upgrade paths are worse than one. Reasoning recorded at the call site. | Never, unless the DAO drops AccessControl. |
| **E-5** | `TIMELOCK_DELAY` is opt-in in `Deploy.s.sol` (warns loudly when unset) rather than mandatory. | A mandatory delay would make local/testnet iteration painful. §17.2 requires it for **production**. | Mainnet — G4 in the stage gates must verify the timelock is live. |
| **E-6** | Frontend `@/` imports converted to relative rather than adding a path alias. | The alias never existed in this repo; adding it needs `tsconfig` + `vite.config` + a new vitest config to stay in sync. That is a repo-wide convention change, not an EVM feature. | If the repo adopts `@/` deliberately. |

## F. Unverified external facts — must be confirmed before relying on them

| ID | Item | Why it matters |
|---|---|---|
| **F-1** | `evm_version = "cancun"` in `foundry.toml` is unverified against Robinhood Chain's ArbOS version. Cancun emits `MCOPY` and permits `TSTORE`/`BLOBHASH`. | If ArbOS predates Cancun support, contracts fail to deploy or revert at runtime on the first `MCOPY`. Deploy one contract and exercise a memory-copying path before committing to a full run. |
| **F-2** | ~~Tally's shutdown cause~~ — **VERIFIED 2026-07-24 and the strategy document is wrong.** It states "regulatory pressure killed it"; the public record is that regulation *relaxed*, removing DAO-as-regulatory-armor demand, plus the "infinite garden" thesis failing. | §3.2, §15 and §17.5 of the strategy rest on the inverted reading. Recorded in the confidential audit doc; a founder decision, not an engineering one. |
| **F-3** | ~~Robinhood Chain maturity/chain IDs~~ — **VERIFIED**: chain ID 4663, mainnet live 2026-07-01, Arbitrum Orbit, ETH gas, Blockscout from block one, permissionless deploys. | §2's technical claims check out. |

## G. Process items

| ID | Item | Status |
|---|---|---|
| ~~G-1~~ | ~~`.env.example` ships the **Anvil account-0 private key**~~ | ✅ **fixed** 2026-07-24 — emptied, and the file now documents `BACKEND_VERIFIER` / `TIMELOCK_DELAY`, which the deploy script requires. |
| **G-2** | `MembaNFTMarket.sol` does not exist but was ticked complete. One of four named revenue lines. | ⬜ open — PROGRESS.md corrected; contract still unwritten |
| **G-3** | PROGRESS.md is not machine-checked — a tick should require a script mapping it to an artifact and a test. | ⬜ open |
| **G-4** | `go-ethereum` + 15 indirect deps are in the **production** `backend/go.mod` for code imported by nothing (incl. `ProjectZKM/Ziren` at an untagged pseudo-version, pulled via geth crypto). | ⬜ open — revert until wired, or move the EVM backend to its own module |
| **G-5** | Session handoff docs stopped at SESSION_007-012 (4 docs for 77 claimed sessions). Partially addressed: `sessions/SESSION_REMEDIATION_2026-07-24.md` covers this session. The 65-session gap in the original branch remains undocumented. | 🟡 partial |
| ~~G-6~~ | Checked-in frontend ABIs drift silently — 13 of 15 were stale after a round of contract changes, so the frontend encoded calls against a shape that no longer existed. | ✅ **fixed** 2026-07-24 — `contracts/evm/script/gen-abis.sh` + a CI determinism gate mirroring the repo's `verify-worker.cjs` one. |
| **G-7** | **Flaky Slither job in `evm.yml`.** `crytic/slither-action@v0.4.0` re-installs **unpinned nightly foundry** internally on every run (redundant with the `foundry-toolchain@stable` step right above it), and that download is transient-flaky — on the 2nd `dev/evm-migration` push it returned a corrupt tarball (`gzip: stdin: not in gzip format` → `tar: status 1`), the action exited non-zero, and the gate step (`if: steps.slither.outcome == 'failure'`) fired with a **hardcoded, misleading** "reported HIGH severity findings" message. Slither actually found **0 High** (verified locally at 0.10.4 AND 0.11.5 from the repo root with the repo config). A plain re-run went green. | ⬜ open — replace the action with a direct `pip install slither-analyzer` + `slither contracts/evm --config-file … --sarif … --fail-high` (reuses the already-installed stable foundry, removes nightly-foundryup flakiness, and makes the gate mean what it says), **or** wrap the action in a retry. Also: the gate message must distinguish "found High" from "couldn't run". |
