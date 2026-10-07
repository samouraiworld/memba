# EVM port — Phase 0 verification (2026-10-07)

Adversarial check of the EVM strategy (`Strategy/MEMBA_EVM_STRATEGY_2026-10-07.md` §4–§6, §11) against the
contracts actually deployed on **Base (8453)** and **Base Sepolia (84532)**. Evidence only: anything not
reproduced here is marked **UNVERIFIED**.

## 0. Method

- **Fork tests, no broadcast.** No funded key exists and none was used; no faucet, no transaction sent to
  any network. Every "working transaction" below is a Foundry fork test that runs the real deployed bytecode
  at a pinned block (Base `52,289,000`, Base Sepolia `47,800,000`; availability runs at the latest block).
  Consequence: **there are no Sepolia transaction hashes**; the tests are the reproducible evidence.
- Project: `contracts/evm/` (Foundry 1.4.4, solc 0.8.28, `via_ir`). Dependencies: `forge-std` v1.17.0 and
  `openzeppelin-contracts` v5.7.0, git submodules pinned to the release tags. External protocols are called
  through minimal interfaces in `test/fork/Interfaces.sol`; no protocol repository is vendored.
- Run: `git submodule update --init contracts/evm/lib/forge-std contracts/evm/lib/openzeppelin-contracts`,
  then `cd contracts/evm && forge test -vv`. Result on 2026-10-07: **45 tests, 45 passed, 0 skipped**
  (13 suites; each functional suite runs on both chains). Public RPCs did not rate-limit at this volume.
- **Gas** figures are in-EVM (`gasleft()` deltas): they exclude the 21,000 intrinsic gas, calldata gas and
  Base's L1 data fee. Base gas price at the time: 0.006 gwei (`cast gas-price`).

| Test file | What it proves |
|---|---|
| `Availability.t.sol` (since replaced by `test/manifest/ManifestLive.t.sol`, which reads `deployments/evm`) | Task 1: code + codehash at every canonical address, both chains |
| `SafeTreasury.t.sol` | 2a Safe 2-of-3 + EIP-1271; 2b Zodiac Roles v2 and AllowanceModule v1.0.0 monthly budget |
| `AragonDao.t.sol` | 2c DAOFactory + Multisig (proposal approved and executed) and + TokenVoting |
| `SnapshotX.t.sol` | 2d + task 3: space → Safe, self-updating whitelist, class escalation, mitigation |
| `TokenLaunch.t.sol` | 2e Wizard ERC-20 by CREATE2 + 0.5% in one Safe batch; 2f CCA auction end to end |
| `Eas.t.sol` | 2g schema + onchain attestation |
| `Basenames.t.sol` | Profile row: register + text record; which controller is live |

## 1. Verdicts per core row

| Row (§4) | Verdict | Evidence | What breaks or must change |
|---|---|---|---|
| Wallet (viem/wagmi, EIP-6963/5792) | **UNVERIFIED** | Frontend-only; nothing on chain to test | EIP-5792 `atomicRequired` support per wallet is unknown and decides the token-fee batch (row Tokens) |
| Auth: SIWE + EIP-1271 | **RISKY** | `test_safe_eip1271_message`: 2-of-3 owner signatures over the SafeMessage hash return `0x1626ba7e`; a different message **reverts** (not `false`) | Verifier must treat revert as invalid, check on the SIWE `chainId`, and handle ERC-6492 (undeployed smart wallets): ERC-6492 **UNVERIFIED** (not tested). See §5 |
| Multisig: Safe 1.5.0 | **SOUND** | Codehashes = safe-deployments v1.5.0 on both chains; 2-of-3 deploy 276k gas, exec 78.9k; 1 signature → `GS020`. Tx Service `GET /tx-service/{base,basesep}/api/v1/about/` = 200 without key, `x-ratelimit-limit: 5000`, reset 2,591,216 s (≈30 days) | Use the **SafeL2** singleton `0xEdd160…7C7e` for Safes Memba creates on Base (§11 cites the non-L2 `0xFf51…`; Safe tooling uses SafeL2 on L2s so its events can be indexed — reason UNVERIFIED here, both work on the fork). A Safe 1.5.0 tx with `safeTxGas = 0` bubbles the inner revert instead of `GS013` (seen in `test_token_batch_is_atomic`) |
| Profile: Basenames | **SOUND with an address change** | `test_basename_register_and_text_record`: register through **UpgradeableRegistrarController** + `setText` on **UpgradeableL2Resolver**, both chains; 1-year price for a 16-char name 99,908,791,632,000 wei; register 157k gas | On Base mainnet the README's `RegistrarController 0x4cCb…19a5` is **no longer a registrar controller** (`controllers()` = false; register reverts) while on Base Sepolia the legacy one is still accepted: a testnet-only success trap. Primary name (reverse record) needs a signature field: **UNVERIFIED** |
| DAOs: Safe + Aragon OSx | **SOUND** (Aragon), with per-chain pinning | `test_aragon_multisig_dao_proposal`: DAOFactory 1.4.0, Multisig build 3, create 1.64–1.89M gas, proposal → approve → execute moves ETH from the DAO; non-member approval refused. `test_aragon_tokenvoting_dao` creates a TokenVoting DAO with a new token (2.1–2.3M gas) | **TokenVoting differs between chains**: Base = build 4 (plugin v1.4: `MintSettings.ensureDelegationOnMint` + `excludedAccounts`), Base Sepolia = build 3 (v1.3 install data). Same calldata cannot serve both. The token-voting-plugin `addresses.json` points Base Sepolia at a **stale repo** `0x424F…F7dF` (build 2); osx-commons gives `0xdEbc…4e9d` (build 3). A proposal cannot be created in the block of the settings change (`ProposalCreationForbidden`). Aragon has no Base Sepolia entry in `aragon/osx` addresses.json; osx-commons has one |
| Treasury: Roles v2 / AllowanceModule | **SOUND** | `test_roles_monthly_allowance`: Roles 2.1.1 proxy via ModuleProxyFactory, `WithinAllowance` on `transfer`, 600 then 401 refused, exactly 400 passes, other selector refused, refill after 30 days. `test_allowanceModule_v1_monthly`: same with AllowanceModule v1.0.0 (exact revert string asserted) | "Monthly" is a fixed period: Roles = 30 days in seconds; AllowanceModule `resetTimeMin` is `uint16` minutes (max ≈45.5 days). AllowanceModule v1.0.0 is deployed at `0x691f…E331` on both chains but **absent from safe-modules-deployments** (registry stops at 0.1.1): pin our own codehash. §11 is inaccurate: the replay fix is v0.1.1; v1.0.0 fixes nonce overflow, false-returning tokens and delegate key collision |
| Tokens: Wizard ERC-20 + CREATE2 + 0.5% | **RISKY** | `test_token_create2_with_fee_batch`: Wizard ERC20+Permit deployed by the CREATE2 deployer `0x4e59…956C` + 0.5% to the treasury in **one** Safe `MultiSendCallOnly` delegatecall, 826k gas. `test_token_batch_is_atomic`: a failing fee transfer reverts the deployment too. `test_token_create2_frontrun_griefs_batch`: anyone can deploy the same initcode first | (1) **Wizard output hard-codes name, symbol and premint** (`@openzeppelin/wizard` 0.10.16, see §2): every user token is a new source file; "diff 0 in CI" covers one file, not user tokens. Each token needs the pinned generator + solc at creation time (browser solc-js or a backend compiler) and its own source verification. (2) The 0.5% fee is **frontend-only**: enforceable inside one batch, never on chain. (3) Atomic only for a Safe creator or an EIP-5792 `atomicRequired` wallet; an EOA otherwise sends two txs and may skip the second. (4) A front-run CREATE2 collision makes the creator's batch revert **and burns its whole gas limit** (991M in the test): simulate first, detect existing code, fall back to the fee transfer alone |
| Launchpad: Uniswap CCA v2.1.0 | **SOUND (mechanics) / RISKY (operations)** | `test_cca_auction_graduates_to_safe`: factory `create` + fund + `onTokensReceived` in one Safe batch (3.91M gas), two ETH bids, graduation, `exitBid`, `claimTokens`, `sweepCurrency` and `sweepUnsoldTokens` by the Safe. 4 ETH demand at floor 1e-4 ETH: 40,000 tokens cleared, Safe received 3.999…999 ETH (1 wei rounding). `test_cca_auction_fails_to_graduate`: full refund, full supply back. `protocolFeeController()` = `address(0)` on both chains today | **"+ pool v4" is not done by the CCA factory**: migration to a v4 pool is the separate Liquidity Launcher flow, not exercised here (**UNVERIFIED** on Base). Pitfalls in §5.4 (past start block accepted, schedule in blocks, recipients must call sweep, Permit2 for ERC-20 currency) |
| (V2) Weighted governance: Snapshot X | **BROKEN as a port of memba_gov; RISKY as a "value parity" substitute** | `SnapshotX.t.sol`, 6 tests × 2 chains. See §3 | Classes are not enforceable without Roles per strategy; headcount AND weight is not linear in general; roster changes do not invalidate open proposals; accepted proposals never expire; votes are final |
| (V2) EAS | **SOUND** | `test_eas_schema_and_attestation`: register 122k, attest 262k, both chains | **Versions differ**: Base `1.0.1`, Base Sepolia `1.2.0` (`version()`), so Sepolia-only tests do not cover prod. Offchain attestations are EIP-712 signatures, no tx: nothing to test on a fork |
| (V2) Seaport 1.6 | present, **not exercised** | `information()` on Base returns `"1.6"`, conduit controller `0x0000…Ad63` | Runtime codehash differs between Base and Base Sepolia (both 23,981 B); likely chain-specific immutables, **UNVERIFIED**. The manifest must store codehash per chain |

## 2. Wizard output (task 2e)

Generated with the OpenZeppelin Wizard library, not typed:

```bash
npm install @openzeppelin/wizard@0.10.16
node -e 'process.stdout.write(require("@openzeppelin/wizard").erc20.print({name:"MembaToken",symbol:"MBT",premint:"1000000",permit:true}))' > contracts/evm/src/MembaToken.sol
```

- `contracts/evm/src/MembaToken.sol` sha256 `42d5426bac7287aa446b0fbbd9460c9a173e68c00373abbb9d7aa7eec56f5710`.
  Regenerating and diffing gives no difference: **zero hand edits**. It compiles against OZ v5.7.0 (pragma
  `^0.8.27`, header "Compatible with OpenZeppelin Contracts ^5.7.0").
- Generating with another name/symbol/premint changes the contract name, the `ERC20(...)`/`ERC20Permit(...)`
  arguments and the `_mint` amount in the source. Only the premint recipient is a constructor argument.
- The CI check is not wired yet (needs node + the pinned generator); see §6.

## 3. Snapshot X vs memba_gov (task 3)

### 3.1 What memba_gov does (samcrew-deployer `origin/main`, `projects/gov/memba_gov/`)

- Roster of seated persons, weight 1 or 2, 2–25 seats; a key counts only after its own `Join` (`gov.gno`).
- Rules on **YES votes only**, as fractions of seated weight W and persons N (`policy.gno` `meets`):
  - Routine: `8w ≥ 3W` and `p ≥ 2`, no delay.
  - Financial: `5w ≥ 3W` and `p ≥ 3` and `2p > N`, no delay.
  - Critical: two routes — weighted `3w ≥ 2W` and `2p > N` then **24 h**, or headcount `3p ≥ 2N` and `2w > W`
    then **72 h** (`durations.gno`); the earliest route wins.
  - Roster actions have fixed classes and delays (7 days; RemoveInactive 14 days, vetoed by the member's activity).
- A target realm hard-codes the minimum class it accepts (`Consume(..., minClass, ...)`): the **target**
  enforces the class, not the proposer.
- A YES can be withdrawn until execution; ready as soon as a coalition qualifies; 7-day voting period then a
  7-day execution window; then expired.
- Any executed roster action or `Join` **invalidates every open proposal**; `Consume` invalidates the other open
  proposals of the same (target, scope). The executor must be a seated member.

### 3.2 What the deployed Snapshot X does (sx-monorepo `contracts/sx-evm/src`, confirmed on fork)

| memba_gov property | Snapshot X (deployed on Base) | Test | Status |
|---|---|---|---|
| Weighted roster | `WhitelistVotingStrategy` params = `(address, uint96 vp)[]` stored in the space | all | OK |
| Thresholds as fractions of W | **Absolute** quorum per execution strategy: `for + abstain ≥ quorum` **and** `for > against`; must be re-set on every roster change | `test_sx_self_update_whitelist` | Partial |
| Weight AND headcount | Power is a **sum** over strategies. A single whitelist with `vp_i = a·w_i + b` gives `a·w + b·p`; this is a linear threshold, and `w ≥ X ∧ p ≥ Y` is not linear in general | see 3.3 | **BROKEN in general** |
| Class enforced by the target | The **proposer picks** the execution strategy (any address). Every Avatar strategy enabled on the Safe has full module power | `test_sx_class_escalation_unrestricted`: `addOwnerWithThreshold(attacker, 1)` passes at the routine quorum | **BROKEN** unless mitigated |
| (mitigation) | Routine/financial strategies target a **Zodiac Roles** modifier with a scoped default role; only critical targets the Safe | `test_sx_class_escalation_blocked_by_roles`: the same attack reverts, a scoped payment passes | OK (composition, not a single product) |
| Ready as soon as the coalition qualifies | `minVotingDuration = 0` → `VotingPeriodAccepted`, executable before the deadline | `test_sx_routine_payment_through_safe` | OK |
| YES only, NO ignored | NO counts: `for > against` required; abstain counts toward quorum | `test_sx_against_votes_block` | Different (stricter on NO, laxer on abstain) |
| Withdraw a YES | Votes are final (`UserAlreadyVoted`) | `test_sx_routine_payment_through_safe` | **Missing** |
| Critical delays 24 h / 72 h, two routes | Avatar strategy has no delay. `TimelockExecutionStrategy` (deployed) queues with a delay and one `vetoGuardian`, but executes from itself (would have to be a Safe module calling `execTransactionFromModule`, **UNVERIFIED**). One proposal = one strategy, so only one route | — | Partial |
| Execution window, expiry | An accepted proposal stays executable forever | `test_sx_against_votes_block` (executed 10M blocks later) | **Missing** (owner `cancel` only) |
| Roster change invalidates open proposals | Proposals snapshot the active strategy indexes; a pre-change proposal keeps the **old whitelist** but is checked against the **current quorum** | `test_sx_self_update_whitelist`: removed member votes on the stale proposal, it executes | **BROKEN** unless the same payload cancels open proposals (`cancel` is owner = Safe only) |
| Self-update of the whitelist | Works: one critical proposal runs `space.updateSettings` (add new strategies, remove old indexes, replace the proposal-validation copy of the list) + `setQuorum` through the Safe | `test_sx_self_update_whitelist` (698k gas) | OK |
| Only members propose | `PropositionPowerProposalValidationStrategy(threshold 1, [whitelist])`; its list is a **separate copy** to update with the roster | `test_sx_membership_checks` | OK |
| Executor is a member | `execute` is permissionless | — | Different, harmless |
| Lifetime | `nextVotingStrategyIndex` is `uint8`: at most ~255 strategies ever added (1 per roster change with the single-whitelist form) | — | Limit |
| Time base | This deployment counts **blocks** (`startBlockNumber`, `maxEndBlockNumber`), not seconds: 7 days = 302,400 Base blocks at 2 s | all | Note |

### 3.3 Is "weight AND headcount" expressible?

All the space's execution strategies see the same vote totals, so one space needs **one** power formula
`vp_i = a·w_i + b` that makes every class a threshold. `contracts/evm/script/gov_linear_check.py` enumerates every
coalition of a roster and searches integers `0 ≤ a, b < 8`:

| Roster (weights) | W, N | One formula for all classes | Quorums (routine / financial / critical weighted / critical headcount) |
|---|---|---|---|
| Seed seated: 2,1,1,1 | 5, 4 | `vp = w + 1` | 4 / 6 / 7 / 6 (tested on fork) |
| Seed + 3 invitees: 2,1,1,1,1,1,1 | 8, 7 | `vp = w + 1` | 5 / 9 / 11 / 10 |
| 3×2 + 5×1 | 11, 8 | **none found** (each class alone has one, with different `a, b`: one space per class) | — |
| 6×2 + 6×1 | 18, 12 | **none**; financial has no linear form at all | — |

Proof for 6×2 + 6×1, financial (`w ≥ 11`, `p ≥ 7`): coalitions (12, 6) and (10, 8) fail and (11, 7) passes,
and (11, 7) is their midpoint, so no `a·w + b·p ≥ T` separates them. Within memba_gov's 25-seat bounds the
classes are therefore not expressible in general; a roster change can silently move the DAO from a
representable roster to a non-representable one.

### 3.4 Closest unmodified configuration (valid only while a checker confirms the roster is representable)

1. One space, owner = the council Safe. Authenticator `EthTxAuthenticator` (votes are txs; `EthSigAuthenticator`
   would need a relayer).
2. One `WhitelistVotingStrategy` with `vp_i = w_i + 1` (the tests use the equivalent pair "weights" + "ones").
3. Proposal validation: `PropositionPower(threshold 1, [same whitelist])`.
4. Three `AvatarExecutionStrategy` proxies with quorums from §3.3; **routine and financial target a Zodiac Roles
   modifier** with a scoped default role each; critical targets the Safe directly (or a `TimelockExecutionStrategy`
   enabled as a Safe module for the 24 h delay, **UNVERIFIED**).
5. `votingDelay 0`, `minVotingDuration 0`, `maxVotingDuration 302,400` blocks.
6. Every roster change is one critical proposal whose payload: swaps the whitelist, replaces the proposition list,
   re-sets the three quorums, and cancels every open proposal. A Memba-side checker recomputes the formula and
   refuses rosters with no linear form.

Still lost: YES withdrawal, the second critical route, the execution window, NO-blind counting.
**Verdict: BROKEN as a faithful port; usable only as the RISKY value-parity configuration above.** Alternative to
evaluate before V2 (**UNVERIFIED**): Aragon OSx with a non-transferable voting token (TokenVoting thresholds are
ratios, so they follow the roster) combined with a headcount body, e.g. Aragon's staged proposal processing if
deployed on Base; or accept that the Memba council keeps memba_gov semantics only on Gno.

## 4. Address table (task 1)

Every address has code on the chain listed (latest block on 2026-10-07: Base 52,289,683; Base Sepolia
47,800,212). "= published" means the runtime codehash equals the one published by the source.

Sources: **S1** safe-global/safe-deployments `src/assets/v1.5.0/*.json` (canonical); **S2** safe-fndn/safe-modules
`modules/allowances/CHANGELOG.md` "Expected addresses" (v1.0.0 and v0.1.1); **S3** gnosisguild/zodiac
`src/contracts.ts` (Roles 2.1.1, ModuleProxyFactory 1.2.0) and zodiac-modifier-roles README; **S4** aragon/osx
`npm-artifacts/src/addresses.json`, aragon/osx-commons `configs/src/deployments/json/{baseMainnet,baseSepolia}.json`
v1.4.0, aragon/multisig-plugin and aragon/token-voting-plugin `addresses.json`; **S5** snapshot-labs/sx-monorepo
`contracts/sx-evm/deployments/{base,base-sepolia}.json` (identical); **S6** Uniswap/continuous-clearing-auction
README (v2.1.0, commit 7d7602d); **S7** ethereum-attestation-service/eas-contracts README; **S8** ProjectOpenSea/seaport
README; **S9** base/basenames README.

| Contract | Address | Chain | Present (bytes) | Codehash | Src |
|---|---|---|---|---|---|
| Safe 1.5.0 singleton | `0xFf51A5898e281Db6DfC7855790607438dF2ca44b` | Base | yes (21451) | `0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2` = published | S1 |
| Safe 1.5.0 singleton | `0xFf51A5898e281Db6DfC7855790607438dF2ca44b` | Base Sepolia | yes (21451) | `0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2` = published | S1 |
| SafeL2 1.5.0 singleton | `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e` | Base | yes (22231) | `0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc` = published | S1 |
| SafeL2 1.5.0 singleton | `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e` | Base Sepolia | yes (22231) | `0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc` = published | S1 |
| SafeProxyFactory 1.5.0 | `0x14F2982D601c9458F93bd70B218933A6f8165e7b` | Base | yes (3321) | `0x967dae4cda22b0c9ef7f31b010bdc1ceb0af9904b0c3dc060b5302e4c18a4529` = published | S1 |
| SafeProxyFactory 1.5.0 | `0x14F2982D601c9458F93bd70B218933A6f8165e7b` | Base Sepolia | yes (3321) | `0x967dae4cda22b0c9ef7f31b010bdc1ceb0af9904b0c3dc060b5302e4c18a4529` = published | S1 |
| CompatibilityFallbackHandler 1.5.0 | `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4` | Base | yes (6294) | `0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc` = published | S1 |
| CompatibilityFallbackHandler 1.5.0 | `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4` | Base Sepolia | yes (6294) | `0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc` = published | S1 |
| MultiSend 1.5.0 | `0x218543288004CD07832472D464648173c77D7eB7` | Base | yes (640) | `0xca1147a12963172a93910c5cb2bfa5ad0e941c7f03fc7eb017dd06a8ea4e5604` = published | S1 |
| MultiSend 1.5.0 | `0x218543288004CD07832472D464648173c77D7eB7` | Base Sepolia | yes (640) | `0xca1147a12963172a93910c5cb2bfa5ad0e941c7f03fc7eb017dd06a8ea4e5604` = published | S1 |
| MultiSendCallOnly 1.5.0 | `0xA83c336B20401Af773B6219BA5027174338D1836` | Base | yes (421) | `0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663` = published | S1 |
| MultiSendCallOnly 1.5.0 | `0xA83c336B20401Af773B6219BA5027174338D1836` | Base Sepolia | yes (421) | `0xcdbdcec38d2f1c7d961b0029ff8416b7e86e9974d6f0e9c9580c7d17fcfb6663` = published | S1 |
| AllowanceModule v1.0.0 | `0x691f59471Bfd2B7d639DCF74671a2d648ED1E331` | Base | yes (15504) | `0xfafc86ce3000fbdc8ad155875c0b3b5a20d17662e7c2cdbf3e95f15945a46657` | S2 |
| AllowanceModule v1.0.0 | `0x691f59471Bfd2B7d639DCF74671a2d648ED1E331` | Base Sepolia | yes (15504) | `0xfafc86ce3000fbdc8ad155875c0b3b5a20d17662e7c2cdbf3e95f15945a46657` | S2 |
| AllowanceModule v0.1.1 | `0xAA46724893dedD72658219405185Fb0Fc91e091C` | Base | yes (14908) | `0x7aa63affdca06fe94576f00077ad61a02ccf203a5da31e1b4ed595df7b65cf3e` | S2 |
| AllowanceModule v0.1.1 | `0xAA46724893dedD72658219405185Fb0Fc91e091C` | Base Sepolia | yes (14908) | `0x7aa63affdca06fe94576f00077ad61a02ccf203a5da31e1b4ed595df7b65cf3e` | S2 |
| Zodiac Roles v2.1.1 mastercopy | `0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5` | Base | yes (24409) | `0x471d8b3b419f1eb955230c0326c8812176df49bf3c7b414a563fda5a3c6c10b6` | S3 |
| Zodiac Roles v2.1.1 mastercopy | `0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5` | Base Sepolia | yes (24409) | `0x471d8b3b419f1eb955230c0326c8812176df49bf3c7b414a563fda5a3c6c10b6` | S3 |
| Zodiac ModuleProxyFactory 1.2.0 | `0x000000000000aDdB49795b0f9bA5BC298cDda236` | Base | yes (2046) | `0x01623cbcf010a1c326230f1b2d5f48a66b440232ee49096102bc84967dc5f21e` | S3 |
| Zodiac ModuleProxyFactory 1.2.0 | `0x000000000000aDdB49795b0f9bA5BC298cDda236` | Base Sepolia | yes (2046) | `0x01623cbcf010a1c326230f1b2d5f48a66b440232ee49096102bc84967dc5f21e` | S3 |
| Zodiac Roles Integrity lib | `0x6a6Af4b16458Bc39817e4019fB02BD3b26d41049` | Base | yes (5637) | `0xee8ec55ea4ac609a3fc768eccf3f0479631454fe0a802e4a4b8132102d10d495` | S3 |
| Zodiac Roles Integrity lib | `0x6a6Af4b16458Bc39817e4019fB02BD3b26d41049` | Base Sepolia | yes (5637) | `0xee8ec55ea4ac609a3fc768eccf3f0479631454fe0a802e4a4b8132102d10d495` | S3 |
| Zodiac Roles Packer lib | `0x869718C939652084BC491fBC5ce0D3C1d5B309F0` | Base | yes (2138) | `0xc28f5fb0c8857669286d01e3df89f310d5ddfbf98205ad46d2f7d28767a76c82` | S3 |
| Zodiac Roles Packer lib | `0x869718C939652084BC491fBC5ce0D3C1d5B309F0` | Base Sepolia | yes (2138) | `0xc28f5fb0c8857669286d01e3df89f310d5ddfbf98205ad46d2f7d28767a76c82` | S3 |
| Zodiac Roles MultiSendUnwrapper | `0xB4Cd4bb764C089f20DA18700CE8bc5e49F369efD` | Base | yes (2096) | `0x1f6e088be5e6ef9d0fbe0547d3fa9a9e40d823433fd8a4449215b5663209a1eb` | S3 |
| Zodiac Roles MultiSendUnwrapper | `0xB4Cd4bb764C089f20DA18700CE8bc5e49F369efD` | Base Sepolia | yes (2096) | `0x1f6e088be5e6ef9d0fbe0547d3fa9a9e40d823433fd8a4449215b5663209a1eb` | S3 |
| Snapshot X ProxyFactory | `0x4B4F7f64Be813Ccc66AEFC3bFCe2baA01188631c` | Base | yes (3428) | `0x9d58d183bb98c199c270f0f2ba7c0abbda1a119caef4c136e137bbacca8c4035` | S5 |
| Snapshot X ProxyFactory | `0x4B4F7f64Be813Ccc66AEFC3bFCe2baA01188631c` | Base Sepolia | yes (3428) | `0x9d58d183bb98c199c270f0f2ba7c0abbda1a119caef4c136e137bbacca8c4035` | S5 |
| Snapshot X Space implementation | `0xC3031A7d3326E47D49BfF9D374d74f364B29CE4D` | Base | yes (16749) | `0x4f2f90c70374b7dcd468d351747e9c865efc0d47e606eb6fdaeb2a842c148d81` | S5 |
| Snapshot X Space implementation | `0xC3031A7d3326E47D49BfF9D374d74f364B29CE4D` | Base Sepolia | yes (16749) | `0x4f2f90c70374b7dcd468d351747e9c865efc0d47e606eb6fdaeb2a842c148d81` | S5 |
| Snapshot X WhitelistVotingStrategy | `0x3CEE21A33751A2722413fF62dEC3dEc48e7748A4` | Base | yes (838) | `0x5ac5acac888dd781c9cfe7cdac9182a316560bfc6aa443ee148c0ed090d3d585` | S5 |
| Snapshot X WhitelistVotingStrategy | `0x3CEE21A33751A2722413fF62dEC3dEc48e7748A4` | Base Sepolia | yes (838) | `0x5ac5acac888dd781c9cfe7cdac9182a316560bfc6aa443ee148c0ed090d3d585` | S5 |
| Snapshot X AvatarExecutionStrategy impl | `0xecE4f6b01a2d7FF5A9765cA44162D453fC455e42` | Base | yes (5189) | `0xff49b6b368f46437fcdcca49e92468602a8b2d61da76bbcf2f49652f6bcfb28a` | S5 |
| Snapshot X AvatarExecutionStrategy impl | `0xecE4f6b01a2d7FF5A9765cA44162D453fC455e42` | Base Sepolia | yes (5189) | `0xff49b6b368f46437fcdcca49e92468602a8b2d61da76bbcf2f49652f6bcfb28a` | S5 |
| Snapshot X TimelockExecutionStrategy impl | `0xf2A1C2f2098161af98b2Cc7E382AB7F3ba86Ebc4` | Base | yes (7126) | `0x3865767ce0d582f31812edde45d3909a333fc04e5a1a6f8e1f686d6023a95eed` | S5 |
| Snapshot X TimelockExecutionStrategy impl | `0xf2A1C2f2098161af98b2Cc7E382AB7F3ba86Ebc4` | Base Sepolia | yes (7126) | `0x3865767ce0d582f31812edde45d3909a333fc04e5a1a6f8e1f686d6023a95eed` | S5 |
| Snapshot X VanillaAuthenticator | `0xb9BE0a0093933968E3B4c4fC5d939B6c1Fe45142` | Base | yes (665) | `0xcc5ac61ffe33da5b76ee182f88f532af0041f693f347341cba4a31732031f108` | S5 |
| Snapshot X VanillaAuthenticator | `0xb9BE0a0093933968E3B4c4fC5d939B6c1Fe45142` | Base Sepolia | yes (665) | `0xcc5ac61ffe33da5b76ee182f88f532af0041f693f347341cba4a31732031f108` | S5 |
| Snapshot X EthTxAuthenticator | `0xBA06E6cCb877C332181A6867c05c8b746A21Aed1` | Base | yes (1744) | `0xe7a216f07f812245a89909f0eee52435d9892c029d23dde2e7d46f28a1983bdb` | S5 |
| Snapshot X EthTxAuthenticator | `0xBA06E6cCb877C332181A6867c05c8b746A21Aed1` | Base Sepolia | yes (1744) | `0xe7a216f07f812245a89909f0eee52435d9892c029d23dde2e7d46f28a1983bdb` | S5 |
| Snapshot X EthSigAuthenticator | `0x95CF9B585fDb12DeB78002B5643dFF8fe67a496D` | Base | yes (4429) | `0xc2c4b1c07072a071c6a341f0b81a8f73f560e673b54fc9f73838eaee7dfa1814` | S5 |
| Snapshot X EthSigAuthenticator | `0x95CF9B585fDb12DeB78002B5643dFF8fe67a496D` | Base Sepolia | yes (4429) | `0x908f830614f145bf3820834e16985efffd940dc2d5e285fcc0dfb96ce2aa5d75` | S5 |
| Snapshot X VanillaProposalValidation | `0x9A39194F870c410633C170889E9025fba2113c79` | Base | yes (248) | `0xddd4560ead7f2c3de35f37de8d50c43e57f0173ad3eefd20098c3b6e08cba9d8` | S5 |
| Snapshot X VanillaProposalValidation | `0x9A39194F870c410633C170889E9025fba2113c79` | Base Sepolia | yes (248) | `0xddd4560ead7f2c3de35f37de8d50c43e57f0173ad3eefd20098c3b6e08cba9d8` | S5 |
| Snapshot X PropositionPowerValidation | `0x6D9d6D08EF6b26348Bd18F1FC8D953696b7cf311` | Base | yes (2010) | `0x2be4000dde1953be92dff29da1c0b058d736ac3194fc63ac1ec33bfed24675ab` | S5 |
| Snapshot X PropositionPowerValidation | `0x6D9d6D08EF6b26348Bd18F1FC8D953696b7cf311` | Base Sepolia | yes (2010) | `0x2be4000dde1953be92dff29da1c0b058d736ac3194fc63ac1ec33bfed24675ab` | S5 |
| Uniswap CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | Base | yes (24214) | `0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa` | S6 |
| Uniswap CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | Base Sepolia | yes (24214) | `0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa` | S6 |
| EAS predeploy | `0x4200000000000000000000000000000000000021` | Base | yes (2055) | `0x1f958654ab06a152993e7a0ae7b6dbb0d4b19265cc9337b8789fe1353bd9dc35` | S7 |
| EAS predeploy | `0x4200000000000000000000000000000000000021` | Base Sepolia | yes (2059) | `0xfa8c9db6c6cab7108dea276f4cd09d575674eb0852c0fa3187e59e98ef977998` | S7 |
| EAS SchemaRegistry predeploy | `0x4200000000000000000000000000000000000020` | Base | yes (2055) | `0x1f958654ab06a152993e7a0ae7b6dbb0d4b19265cc9337b8789fe1353bd9dc35` | S7 |
| EAS SchemaRegistry predeploy | `0x4200000000000000000000000000000000000020` | Base Sepolia | yes (2059) | `0xfa8c9db6c6cab7108dea276f4cd09d575674eb0852c0fa3187e59e98ef977998` | S7 |
| Seaport 1.6 | `0x0000000000000068F116a894984e2DB1123eB395` | Base | yes (23981) | `0x2d5cb8553e21a19550413299c05a6493cc606fb0000b5042328a5ba06bfdaf35` | S8 |
| Seaport 1.6 | `0x0000000000000068F116a894984e2DB1123eB395` | Base Sepolia | yes (23981) | `0x7912af42062ec0080cde88360c1429d58984ae16eb3f17af505b815bf6ffc745` | S8 |
| Seaport ConduitController | `0x00000000F9490004C11Cef243f5400493c00Ad63` | Base | yes (8820) | `0x880348b652e7cce91216153a4d0107e70c77b92192f3d7a127ff1f1351961948` | S8 |
| Seaport ConduitController | `0x00000000F9490004C11Cef243f5400493c00Ad63` | Base Sepolia | yes (8820) | `0x880348b652e7cce91216153a4d0107e70c77b92192f3d7a127ff1f1351961948` | S8 |
| Aragon DAOFactory v1.4.0 | `0xcc602EA573a42eBeC290f33F49D4A87177ebB8d2` | Base | yes (8255) | `0xa0bbd977e2c16d930f82ca77c4ac7bb4f09359de1157852494ce8c2c749aee37` | S4 |
| Aragon PluginSetupProcessor | `0x91a851E9Ed7F2c6d41b15F76e4a88f5A37067cC9` | Base | yes (11972) | `0xb014967d0e04e9bddbd4bba6f05dd1debbd4180330449668a90bbfc0af5d29a5` | S4 |
| Aragon DAORegistry | `0xeB98a71d69a1e12B62c10368D9dA5364CE0f7178` | Base | yes (833) | `0x1bce65331ab220385d4fe958fc084b4d00226b85e6633941cfb690ad6b0534a6` | S4 |
| Aragon PluginRepoRegistry | `0xB5eB5C011827C9F5787ceE3Abc72d247E36a5a0D` | Base | yes (833) | `0x1bce65331ab220385d4fe958fc084b4d00226b85e6633941cfb690ad6b0534a6` | S4 |
| Aragon Multisig plugin repo | `0xcDC4b0BC63AEfFf3a7826A19D101406C6322A585` | Base | yes (833) | `0x1bce65331ab220385d4fe958fc084b4d00226b85e6633941cfb690ad6b0534a6` | S4 |
| Aragon TokenVoting plugin repo | `0x2532570DcFb749A7F976136CC05648ef2a0f60b0` | Base | yes (833) | `0x1bce65331ab220385d4fe958fc084b4d00226b85e6633941cfb690ad6b0534a6` | S4 |
| Basenames Registry | `0xB94704422c2a1E396835A571837Aa5AE53285a95` | Base | yes (2540) | `0x353bc9548a1b34980e89e32fd9efceb369faaf19594792a2e9168f15e7ff9a47` | S9 |
| Basenames BaseRegistrar | `0x03c4738Ee98aE44591e1A4A4F3CaB6641d95DD9a` | Base | yes (8447) | `0x1f879417fc3c65a3111bf79ef584f6a2ea353d175526f3bcb29645cc69d11592` | S9 |
| Basenames RegistrarController (legacy) | `0x4cCb0BB02FCABA27e82a56646E81d8c5bC4119a5` | Base | yes (10877) | `0xcda0794672ba734845550745a0131dd5b43ffa95274f0bb1c9b6cabd13c89be7` | S9 |
| Basenames UpgradeableRegistrarController | `0xa7d2607c6BD39Ae9521e514026CBB078405Ab322` | Base | yes (1201) | `0x28898dfa35bcd9f32cc2be3d49c0a9e2540ed32d17872376deadb674749352a5` | S9 |
| Basenames L2Resolver (legacy) | `0xC6d566A56A1aFf6508b41f6c90ff131615583BCD` | Base | yes (13070) | `0x0b59e4aef257ba45839c5dd63f9c0e67497c74f3b2095b1f65148e80d58bd402` | S9 |
| Basenames UpgradeableL2Resolver | `0x426fA03fB86E510d0Dd9F70335Cf102a98b10875` | Base | yes (1201) | `0xe561198a50395090294eb9ed1995e51d766fcdd52a4f4b6f7b7b0751503d52af` | S9 |
| Aragon DAOFactory v1.4.0 | `0x016CBa9bd729C30b16849b2c52744447767E9dab` | Base Sepolia | yes (6255) | `0x0df48db198643ea62e7cc254523fd10b45693642cf6aa54d7352dd79d3ef7860` | S4 |
| Aragon PluginSetupProcessor | `0xd97D409Ca645b108468c26d8506f3a4Bf9D0BE81` | Base Sepolia | yes (10368) | `0xfcb47ca000a871dcafc9c8a8cd6065f9490467c69934c07708880380251d0609` | S4 |
| Aragon Multisig plugin repo | `0x705596219C1C31dd92E3449c8E04251CcacCb6aB` | Base Sepolia | yes (203) | `0x08349d5a38235748c9496d25a57f4bc8e6793e452e5f7b10903ec48d1ab8c74c` | S4 |
| Aragon TokenVoting repo (osx-commons) | `0xdEbcF8779495a62156c6d1416628F60525984e9d` | Base Sepolia | yes (203) | `0x08349d5a38235748c9496d25a57f4bc8e6793e452e5f7b10903ec48d1ab8c74c` | S4 |
| Aragon TokenVoting repo (npm-artifacts) | `0x424F4cA6FA9c24C03f2396DF0E96057eD11CF7dF` | Base Sepolia | yes (833) | `0x1bce65331ab220385d4fe958fc084b4d00226b85e6633941cfb690ad6b0534a6` | S4 |
| Basenames Registry | `0x1493b2567056c2181630115660963E13A8E32735` | Base Sepolia | yes (2540) | `0x353bc9548a1b34980e89e32fd9efceb369faaf19594792a2e9168f15e7ff9a47` | S9 |
| Basenames BaseRegistrar | `0xA0c70ec36c010B55E3C434D6c6EbEEC50c705794` | Base Sepolia | yes (8447) | `0xd34980744a10c7c697040eab4217c4f898eff2e368f5a13a3730c00871d6354d` | S9 |
| Basenames RegistrarController (legacy) | `0x49aE3cC2e3AA768B1e5654f5D3C6002144A59581` | Base Sepolia | yes (10874) | `0xcff3c041dcb782edb2ace26d7d9621ff9f46fef2e657cff596e436e0c553a69b` | S9 |
| Basenames UpgradeableRegistrarController | `0x82c858CDF64b3D893Fe54962680edFDDC37e94C8` | Base Sepolia | yes (1201) | `0x59c6d41167b7183daba3411654e04c6a17d9393723464656526df6bc84917de7` | S9 |
| Basenames L2Resolver (legacy) | `0x6533C94869D28fAA8dF77cc63f9e2b2D6Cf77eBA` | Base Sepolia | yes (13070) | `0x5f8138cfb4afbb24152621c1f656f631680d2670dee017eec534b13aec50efc2` | S9 |
| Basenames UpgradeableL2Resolver | `0x85C87e548091f204C2d0350b39ce1874f02197c6` | Base Sepolia | yes (1201) | `0x519955142f4f6a53016c77bde296ebf6702988de491c85a9c9c1c99a16346ca5` | S9 |

On-chain version reads: `Safe.VERSION()` = 1.5.0; AllowanceModule `NAME/VERSION` = "Allowance Module"/1.0.0 (both
chains); Roles mastercopy `owner()` = `0x…01` (locked); `DAOFactory.protocolVersion()` = [1,4,0] (both); Base PSP
`protocolVersion()` reverts (older PSP, used by the 1.4.0 factory); Multisig repo latest 1.3 (both); TokenVoting repo
latest 1.4 (Base) / 1.3 (Sepolia); EAS `version()` 1.0.1 (Base) / 1.2.0 (Sepolia); Seaport `information()` "1.6";
CCA `protocolFeeController()` = 0 (both). Also present on both chains: CREATE2 deployer `0x4e59…956C`, Safe
singleton factory `0x914d…43d7`, Permit2 `0x0000…8BA3`.

## 5. Threats (ranked)

1. **Module power = Safe power (governance escalation).** Proven: any execution strategy or module enabled on a
   Safe can do anything (`test_sx_class_escalation_unrestricted`). Rule: only critical paths are direct modules;
   everything else goes through Zodiac Roles with a scoped role (`test_sx_class_escalation_blocked_by_roles`). The
   import flow must list modules and the guard of every imported Safe.
2. **SIWE replay / misuse.** Server-issued single-use nonce with short TTL; `domain` and `uri` equal to the serving
   origin; `chainId` equal to the chain where EIP-1271 is checked (a Safe address can exist on another chain with
   other owners after owner changes); `expirationTime` ≤ 10 min and `issuedAt` within skew; consume the nonce
   atomically before issuing the session. Re-check EIP-1271 on session refresh: Safe owners change.
3. **EIP-1271 edge cases.** Safe `isValidSignature` **reverts** on a bad signature (proven): treat revert as
   false. A Safe also validates a message with an **empty signature** when it was approved on chain via
   `SignMessageLib` (`signedMessages`; from the fallback handler source, not tested). The SafeMessage hash binds the Safe address and chainId (no cross-chain
   replay at the Safe level). Undeployed smart wallets (Base Account, passkeys) need ERC-6492, verified only in
   `eth_call`, never by executing the factory call in a state-changing path: **UNVERIFIED**, add a test in M1.
4. **Safe address poisoning / counterfeit Safes.** Before importing or paying a Safe: read the proxy singleton
   (slot 0) and require a known Safe codehash, require the canonical fallback handler, enumerate modules and the
   guard, show the full address (and Basename), never pick an address from transaction history. A look-alike
   Safe with a malicious singleton passes a naive `getOwners()` check.
5. **CCA parameter mistakes** (from `test_cca_parameter_pitfalls` and the sources): floor price not a multiple
   of the tick spacing → revert; step data whose `Σ mps·blocks ≠ 1e7` or whose blocks ≠ `end - start` → revert;
   `claimBlock < endBlock` → revert; a **start block in the past is accepted** (the elapsed share of supply is
   never offered); everything is in **blocks**; tokens and funds recipients must call `sweep*` themselves (a Safe
   needs a Safe tx; a contract that cannot call them locks the proceeds); `requiredCurrencyRaised` too high →
   no graduation, full refunds (proven); an ERC-20 currency is pulled through Permit2; an auction created but not
   funded is inert (`TokensNotReceived`): create, fund and `onTokensReceived` in one batch (proven); very fine
   tick spacing raises bid gas (iterating ticks).
6. **Token-creation batch partial failure.** Safe batch is atomic (proven). EOA path without EIP-5792 atomicity is
   two txs: the fee transfer can be skipped or fail; fee is advisory. CREATE2 front-run makes the batch revert and
   burn its whole gas limit (proven): simulate first, check code at the predicted address.
7. **Testnet ≠ mainnet.** Three proven divergences (Basenames controller, Aragon TokenVoting build, EAS version):
   every gate that runs on Base Sepolia must also run as a Base mainnet fork test.

## 6. Required changes to the strategy

- **§4 Multisig:** create Safes with SafeL2 1.5.0 `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`; keep `0xFf51…`
  only as a recognised singleton on import. Tx Service: keyless is 5,000 requests per ~30 days per IP (measured),
  so the backend key stays mandatory in prod.
- **§4 Profile:** Basenames through `UpgradeableRegistrarController` (`0xa7d2…b322` Base, `0x82c8…94C8` Sepolia) and
  `UpgradeableL2Resolver` (`0x426f…0875` Base, `0x85C8…97c6` Sepolia); never the legacy controller.
- **§4 DAOs:** the manifest pins Aragon builds per chain (Multisig 1.3 both; TokenVoting 1.4 Base / 1.3 Sepolia,
  different install ABIs); Base Sepolia addresses come from osx-commons, not the plugin's npm `addresses.json`;
  the UI never creates a DAO and a proposal in the same block.
- **§4 Treasury:** "monthly" = 30-day period. Correct §11 on AllowanceModule (replay fixed in 0.1.1; 1.0.0 is not in
  the Safe registry; pin codehash `0xfafc86ce…a46657`). Roles v2 needs 1 + 4 Safe txs to configure (batchable).
- **§4 Tokens (mode W):** decide how user tokens satisfy "Wizard output, zero diff": (a) run the pinned
  `@openzeppelin/wizard` + solc per token at creation (browser or backend) and verify each source, or (b) one
  audited factory = a second registered exception. State plainly that the 0.5% fee is UI-enforced and atomic only
  for Safe creators or EIP-5792-atomic wallets.
- **§4 Launchpad:** CCA factory only runs the auction; the v4 pool needs Liquidity Launcher (separate artifacts,
  to verify). Budget ~3.9M gas per auction creation (full contract per auction). Auction recipients = the Safe and
  the UI schedules the sweep Safe txs.
- **§4 Weighted governance (V2):** replace "classes → strategies/thresholds per type" with §3.4 (Roles per class,
  cancel-on-roster-change, roster representability checker) or re-scope; record the lost properties as accepted.
- **§4 EAS:** test against Base mainnet fork (1.0.1), not only Sepolia (1.2.0).
- **§5 Manifest:** `deployments/evm/<chainId>.json` stores codehash **per chain** (Seaport, EthSigAuthenticator,
  EAS predeploy proxies and Basenames differ between chains) and the Aragon build per plugin.
- **§5/§6 CI:** add a contracts job (`forge test` on both forks, pinned blocks, `via_ir`), and the Wizard diff
  check (`node` + pinned `@openzeppelin/wizard` regenerates `src/MembaToken.sol`, `git diff --exit-code`).
- **§6 M1 gate:** "E2E multisig on Sepolia" plus the same flow on a Base mainnet fork.

## 7. Open questions

1. Liquidity Launcher / v4 pool migration for CCA on Base: addresses, audit, flow. **UNVERIFIED.**
2. ERC-6492 + Base Account sign-in: not tested. **UNVERIFIED.**
3. EIP-5792 `wallet_sendCalls` with `atomicRequired` across MetaMask, Rabby, Coinbase/Base Account. **UNVERIFIED.**
4. `TimelockExecutionStrategy` as a Safe module for critical delays; Snapshot X offchain API/indexer for Base. **UNVERIFIED.**
5. Aragon staged proposal processing (weight AND headcount) availability on Base. **UNVERIFIED.**
6. Seaport per-chain codehash difference: cause not checked. **UNVERIFIED.**
7. Real wallet cost per action including Base's L1 data fee: not measured (in-EVM gas only).
8. Owner decision: is the Memba council on Base allowed to lose YES withdrawal, the 72 h headcount route and the
   execution window (§3.4), or does weighted governance wait for a better primitive?

## 8. Gas (in-EVM, Base mainnet fork; Base Sepolia within ±2%)

| Action | Gas |
|---|---|
| Safe 2-of-3 deploy (SafeL2 via factory) | 276,235 |
| Safe execTransaction, 2 signatures, ETH transfer | 78,904 |
| Roles v2 proxy deploy | 170,558 |
| Safe tx: enable a module | 81,112 |
| Roles config: assignRoles + scopeTarget + scopeFunction + setAllowance (4 Safe txs) | 346,491 |
| Roles `execTransactionWithRole` (ERC-20 within allowance) | 73,701 |
| AllowanceModule addDelegate + setAllowance (2 Safe txs) | 194,143 |
| AllowanceModule `executeAllowanceTransfer` | 53,353 |
| Aragon createDao + Multisig (2-of-3) | 1,891,394 (Sepolia 1,638,053) |
| Aragon createDao + TokenVoting (new token) | 2,292,418 (build 4; Sepolia build 3: 2,107,662) |
| Aragon Multisig createProposal (+ proposer approval) / approve / execute | 186,373 / 27,790 / 59,215 |
| Snapshot X space deploy (2 whitelist strategies) | 1,261,235 |
| Snapshot X AvatarExecutionStrategy deploy | ~225,600–230,600 |
| Snapshot X propose (first / later) | ~173,900–177,600 / ~120,000 |
| Snapshot X vote (first on a proposal / later) | ~121,300 / ~51,400–73,500 |
| Snapshot X execute → Safe (ETH transfer) | 89,353 |
| Snapshot X execute: whitelist swap + setQuorum via Safe | 698,458 |
| Safe batch: CREATE2 Wizard ERC-20 + 0.5% transfer | 825,924 |
| Safe batch: CCA create + fund + onTokensReceived | 3,913,064 |
| CCA submitBid (new tick / later) | 328,131 / 274,867 |
| CCA final checkpoint / exitBid / claimTokens | 81,140 / 29,569 / 29,103 |
| Safe tx: CCA sweepCurrency | 57,077 |
| EAS register schema / attest | 122,243 / 262,167 |
| Basenames register / setText | 157,467 / 44,598 |
