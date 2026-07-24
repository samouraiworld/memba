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

**Last swept:** 2026-07-24 (branch `feat/evm/remediation`, after A-3/A-4/A-5)

---

## A. Open defects — blocks testnet deployment

| ID | Item | Why still open | Done when |
|---|---|---|---|
| ~~A-1~~ | ~~`MembaCollections.mintNFT` can never succeed~~ | ✅ **fixed** 2026-07-24 — `MembaNFT.setLaunchpad` authorises the proxy to mint (creator keeps royalties); `createCollection` binds registration to the sub-collection's owner so that authorisation cannot be abused. 18 tests, from zero. | — |
| **A-2** | `Deploy.s.sol` never grants `ADMIN_ROLE` to `MembaCandidature`, so `markApproved` reverts 100% post-deploy. | Needs a **follow-up Safe transaction**, not just a script line — the DAO is created with `admin = safe`, so only the Safe can issue the grant. Requires a documented post-deploy ceremony step. | Script asserts the grant, or a documented Safe step exists and a test proves the un-granted deployment fails loudly. |
| ~~A-3~~ | ~~`MembaTokenOTC`: fee-on-transfer/rebasing tokens let one listing's fill drain another seller's escrowed tokens~~ | ✅ **fixed** 2026-07-24 — `list` now records the amount **actually received** (balance-delta), so every listing's `totalAmount` is backed by real balance and the sum of open escrows can never exceed the contract's holdings. Fee-on-transfer / rebasing / returns-false / fully-confiscating mocks added (`test/mocks/Tokens.sol`). ⚠️ A downward rebase remains an inherent shared-pool limitation — noted below. | — |
| ~~A-4~~ | ~~`MembaTokenOTC.unitPrice` is per **base unit** and decimals-unaware~~ | ✅ **fixed** 2026-07-24 — `unitPrice` is now wei per **whole token**; `fill` converts through the token's decimals (snapshotted at `list`) via `Math.mulDiv(..., Rounding.Ceil)` so rounding never favours the buyer. Missing `decimals()` falls back to per-base-unit. Tested with an 18-decimal factory token. | — |
| ~~A-5~~ | ~~`MembaTokenOTC` accepts an unbounded `feeBps` at init with no `MAX_FEE_BPS` and no setter~~ | ✅ **fixed** 2026-07-24 — `MAX_FEE_BPS = 2000` checked at init and in a new `setPlatformFee` admin setter (mirrors `MembaEscrow`). | — |
| **A-3b** | `MembaTokenOTC` has **no `setFeeRecipient`** and `fill` reverts the whole call if the fee recipient rejects ETH (the escrow ISSUE-005 pattern, un-ported to OTC). Deliberately out of A-5's scope to keep the change reviewable. | Not started. | Port the escrow pull-payment escape hatch + `setFeeRecipient` to OTC, or fold into C-6 fee-helper work. |
| **A-6** | Backend `evmreader.GetDAOMembers` can **never** return a member (asserts geth's unpacked tuple against an untagged struct; tags are part of Go type identity). Returns `[]` with a nil error. | Not started. | Decode via `UnpackIntoInterface` or `abigen` bindings; the `!ok` branch returns an error rather than `continue`. |
| **A-7** | Backend: unauthenticated remote OOM-kill — `make([]DAOMember, 0, count)` where `count` comes from an attacker-chosen contract address in the URL path. | Not started. | Allowlist of known DAO addresses, hard cap on `count`, `IsInt64()` guard, pagination. |
| **A-8** | Backend `evmrender` routes bypass the repo's `rateLimitMiddleware`/`requireAuthMiddleware` convention; no address validation (`common.HexToAddress` never errors, and a 64-hex string is cropped to a valid address — address aliasing). | Not started. | Routes exposed as plain handlers and wrapped in `main.go` like every other route; `common.IsHexAddress` validation returning 400. |
| **A-9** | Candidature strands ETH two ways: re-applying after rejection overwrites an un-withdrawn deposit, and approved applicants can never withdraw. No `receive`/`fallback`/sweep exists anywhere, so it is unreachable short of an upgrade. | Not started. | Reject re-application while a deposit is outstanding (or accumulate); decide explicitly whether approval forfeits or refunds, and implement the chosen one. |
| **A-10** | Overpayment confiscated. ✅ **`MembaCollections` fixed** (both paths, via `_settle`). ⬜ **`MembaTokenFactory` and `MembaAppStore` still confiscate.** | Partially done. | `_settle`-equivalent on the remaining two. |

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
| **C-4** | `src/core/MembaDAOFactory.sol` | `TODO: Implement per CONTRACT_SPECS`. Also the only non-upgradeable contract in the set, and `Deploy.s.sol` never calls `transferOwnership(safe)` — the deployer EOA keeps `setImplementation` forever. |
| **C-6** | four contracts (was five) | Fee math (`amount * bps / 10_000`) is hand-rolled inline in Escrow, OTC, TokenFactory, Collections and AppStore, each with its own copy. §17.2 mandated formal verification of "the fee distribution logic" — which pointed at a file nothing imported. Consolidate into one tested helper. `MembaCollections._settle` is the first instance and the shape to copy. |
| **C-7** | `MembaCandidature`, `MembaChannels` | Each declares its own local `IMembaDAO`/`IMembaDAOMember` duplicate. Two declarations of one interface will drift. |
| **C-5** | `frontend/src/lib/chain/gno/GnoProvider.ts` (×6) | Unimplemented provider methods returning empty/null: `getTokenInfo`, `getTokenBalance`, `createToken`, `mintTokens`, escrow reads, native balance. Half the interface silently returns "no data" rather than "unsupported". |

## D. Test backlog (from the test-quality audit)

Target tiers — a global floor is not enough for funds-at-risk contracts:

| Tier | Contracts | Line | Branch | Func |
|---|---|---:|---:|---:|
| T1 — funds at risk | Escrow, TokenOTC, TokenFactory, Token, Collections, Candidature | ≥95% | ≥90% | 100% |
| T2 — authority | DAO, DAOFactory, Channels, Registry, Badges, NFT | ≥90% | ≥80% | 100% non-view |
| T3 — social | Reviews, AppStore, Points, Quests | ≥85% | ≥70% | ≥90% |

**Current: 80.97% line / 53.71% branch / 72.73% func.** CI floors are 79/52/71.

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
