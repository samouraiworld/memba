# Memba EVM Migration — Known Issues

> Open bugs, blockers, and items requiring human resolution.
> Updated by AI agents during sessions.
>
> **This file sat empty through 21 commits** while the branch accumulated a fund-theft
> path, 14 fabricated storage constants, 22 type errors, 40 lint errors, and a contract
> with 0% coverage. It is the only designed escalation path from an agent to a human.
> A persistently empty issue log is not the absence of problems — it is the absence of a
> working escalation path, and should be treated as a P0 process alarm.

Severity and detail for contract findings: [SECURITY_FINDINGS.md](SECURITY_FINDINGS.md).

---

## 🔴 Blocking — no deployment of any kind until closed

_All four original blockers are now closed; entries retained below for the record._

### ~~ISSUE-001~~ ✅ RESOLVED 2026-07-24 — see Resolved below

<details><summary>original report</summary>

### ISSUE-001: Seller can take 100% of escrowed ETH
**Severity**: 🔴 CRITICAL · **Found in**: independent audit 2026-07-24 · **Status**: ⬜ Open · **Owner**: AI

`MembaEscrow.completeMilestone` (`:207-225`) is a unilateral seller assertion — the only
gate is `msg.sender == sc.seller`. `cancelContract` (`:340-388`) accepts either party and
its `Completed` branch pays the seller the full amount with **no fee**. A seller calls
`completeMilestone` on every funded milestone, then `cancelContract`, and leaves with
everything, having delivered nothing.

**Impact**: total loss of buyer funds. The buyer has no recourse — `dispute` reverts
`ContractNotActive`, `claimAutoRefund` reverts `MilestoneNotFunded`.

**Why it was invisible**: `test_CancelContract_RefundsAndReleases` asserts this exact
payout as correct behaviour; it simply never makes the *seller* the canceller.

**Fix direction**: require buyer acceptance (or a challenge window that expires into
acceptance) before `Completed` unlocks funds; and/or make `cancelContract` refund
`Completed` milestones to the buyer, forcing contested work through `dispute`. Charge the
platform fee consistently across all four exit paths.

---

### ISSUE-002: `claimAutoRefund` bypasses the dispute freeze
**Severity**: 🔴 CRITICAL · **Status**: ⬜ Open · **Owner**: AI

`MembaEscrow.claimAutoRefund` (`:394-418`) checks buyer, index, milestone status and
timeout — but never `sc.status`, unlike every other fund-moving function. A buyer disputes,
waits out `autoRefundTimeout` (30 days per `Deploy.s.sol:92`), and claims the full refund;
the admin's later `resolveDispute` finds nothing left to award.

**Impact**: arbitration is unenforceable. The spec requires the freeze "in every function".

**Fix direction**: require `sc.status == Active`, and freeze/extend the auto-refund clock
for the duration of a dispute so `dispute()` cannot be used as a stalling device.

</details>

---

### ~~ISSUE-003~~ ✅ RESOLVED 2026-07-24: Upgrade authority is a backend hot key, and cannot be rotated
**Severity**: 🔴 CRITICAL · **Status**: ✅ Resolved · **Owner**: Human (key policy) + AI (code)

`MembaBadges.sol:170` gates `_authorizeUpgrade` on `onlyMinter`; `MembaQuests.sol:82` on
`onlyVerifier`. `Deploy.s.sol:40` sets both from `BACKEND_VERIFIER` — the Fly.io
operational key. Compromise the backend and you own those proxies. Leave the variable unset
and it defaults to the Safe, so the backend cannot mint at all: **both configurations are
broken.**

No `transferAdmin`/`setAdmin` exists in any contract; 13 of 14 have permanently immutable
upgrade authority (only `MembaDAO`, on `AccessControlUpgradeable`, can rotate).

**Fix direction**: separate `UPGRADER_ROLE` from operational minter/verifier roles; two-step
admin transfer everywhere; upgrade authority = Safe behind a timelock.

---

### ~~ISSUE-004~~ ✅ RESOLVED 2026-07-24: No timelock anywhere
**Severity**: 🔴 CRITICAL · **Status**: ✅ Resolved · **Owner**: AI

`grep -ri timelock contracts/evm/src` → zero hits. Plan §17.2 made "Timelock on all contract
upgrades (48h minimum)" a **mandatory** CSO requirement. All 14 upgradeable contracts are
instantly upgradeable, including those custodying user ETH, with no user exit window.

---

## 🟠 High — blocks testnet deployment

- ~~**ISSUE-005**~~ ✅ RESOLVED · `MembaEscrow` push payments have no pull escape hatch. A seller contract
  arming `receive()` to revert blocks `releaseFunds`, `cancelContract` and
  `resolveDispute(true)`; a reverting `feeRecipient` bricks releases protocol-wide, and
  **there is no `setFeeRecipient`**. Slither corroborates (`calls-loop` ×6).
- ~~**ISSUE-006**~~ ✅ RESOLVED · `MembaCollections.mintNFT` can never succeed — the Collections proxy is
  not the creator of the `MembaNFT` sub-collection it mints into, and nothing makes it so.
  The launchpad's only revenue function is inert. Hidden by 0% coverage.
- ~~**ISSUE-007**~~ ✅ RESOLVED 2026-07-24 · `Deploy.s.sol` never granted `ADMIN_ROLE` to
  `MembaCandidature`, so `markApproved` reverted 100% post-deploy. The DAO is created with
  `admin = safe`, so only the Safe can issue it — now a **documented ceremony step**
  (`DEPLOY_CEREMONY.md` step 1) with an `ACTION REQUIRED` deploy-log line and two regression
  tests (un-granted fails loudly / granted succeeds). Same audit surfaced a sibling: the A-1
  Collections launchpad needs a Safe `MembaNFT.setLaunchpad` too (ceremony step 2). See
  Resolved below.
- ~~**ISSUE-008**~~ ✅ RESOLVED · `MembaTokenOTC` recorded `totalAmount` before transferring
  and filled from a shared un-partitioned pool, so a fee-on-transfer token let one listing's
  fill drain another seller's escrowed tokens. `list` now records the amount **actually
  received** (balance-delta), so the books can never over-claim the pool. See Resolved below.
- ~~**ISSUE-009**~~ ✅ RESOLVED · Frontend `EvmProvider` calls four DAO functions that do not exist
  (`createProposal`→`propose`, `executeProposal`→`execute`, `votingThreshold`→`thresholdBps`,
  `getMemberByIndex`→`getMember`); `createToken` omits the required `salt` and `value`;
  `getDAOProposal` destructures fields absent from the ABI (→ `NaN` votes, permanently
  "open" status). Root cause: `writeAndWait` types `abi` as `readonly unknown[]` and casts,
  discarding `as const` inference.
- ~~**ISSUE-010**~~ ✅ RESOLVED 2026-07-24 · Backend `evmreader.GetDAOMembers` could never
  return a member (untagged-struct assertion), had an unauthenticated OOM-kill via an
  attacker-chosen contract address, and served routes that bypassed the rate-limit/auth
  middleware with no address validation. All three fixed — decode via `abi.ConvertType` with
  a hard error on shape mismatch, `boundedMemberCount` cap before allocation, mandatory
  middleware wrapper on `RegisterRoutes`, and `requireAddr` 400 validation. See Resolved below.

---

## 🟡 Medium

- Candidature strands ETH two ways (re-application overwrites an un-withdrawn deposit;
  approved applicants can never withdraw). No `receive`/`fallback`/sweep exists anywhere, so
  it is unreachable short of an upgrade.
- ~~`MembaTokenOTC.unitPrice` is decimals-unaware~~ ✅ RESOLVED 2026-07-24 — now priced per
  whole token with ceiling conversion through the token's decimals. See Resolved below.
- ~~`MembaTokenOTC` accepts an unbounded `feeBps`~~ ✅ RESOLVED 2026-07-24 — `MAX_FEE_BPS` cap
  at init + `setPlatformFee` setter. See Resolved below.
- ~~Overpayment confiscated (TokenFactory, AppStore)~~ ✅ RESOLVED 2026-07-24 — both refund the
  excess via a `_settle` helper; AppStore also gained a reentrancy guard and its first tests.
  See Resolved below.
- Auth: the new `Verifier` interface takes only a raw nonce, so it cannot express challenge
  authenticity, expiry, single-use or chain binding — re-opening `AUTH-CHAINID-01`. EVM login
  is currently blind `personal_sign`, not SIWE.
- CAL `switchChain` conflicts with the frozen-at-import network model in `config.ts`; mounting
  `NetworkSelector` would hard-block every Gno broadcast via `assertWalletBroadcastSafe`.

---

## ✅ Resolved

- **ISSUE-006 (Collections mint unreachable, 0% coverage)** — MembaNFT now authorises a
  launchpad to mint into collections it does not own (creator keeps royalties), and
  MembaCollections binds registration to the sub-collection's owner so that authorisation
  cannot be abused. 18 tests added, from zero. Overpayment on both payable paths now
  refunded via `_settle`.
- **ISSUE-009 (EvmProvider called non-existent functions)** — `writeAndWait` is now generic
  over the ABI, so the four bad calls became compile errors and were fixed
  (`propose`/`execute`/`createToken` salt+value). `getDAOProposal` derives status from the
  real tuple. Also fixed an inverted `VOTE_MAP` that sent every YES as Against.
- **ISSUE-003 (upgrade authority = backend hot key, non-rotatable)** — `MembaUpgradeAuthority`
  gives upgrade rights their own ERC-7201 namespace, separate from every operational role,
  with two-step rotation. All 13 non-DAO contracts gate `_authorizeUpgrade` on
  `onlyUpgrader`; Badges/Quests now take an explicit `_upgrader`. `MembaDAO` keeps
  `DEFAULT_ADMIN_ROLE` (already grantable/revocable — reasoning recorded at the call site).
  `Deploy.s.sol` requires `BACKEND_VERIFIER` explicitly and rejects it equalling the
  upgrade authority. Covered by `test/UpgradeAuthority.t.sol`.
- **ISSUE-004 (no timelock)** — `Deploy.s.sol` deploys a `TimelockController` when
  `TIMELOCK_DELAY` is set (Safe as proposer/executor, `admin = address(0)` so the delay
  cannot be re-granted around), and warns loudly when it is not.
  `test_TimelockEnforcesDelayOnUpgrade` proves the delay actually blocks an early upgrade.
- **H-2 (no upgrade tests existed)** — `upgradeToAndCall` had never been called anywhere.
  Now covered: storage survives V1→V2, an unauthorised caller is rejected, and rotation
  requires the nominee to accept.
- **ISSUE-001 (seller drains 100% of escrow)** — `cancelContract` no longer lets the
  canceller direct funds to themselves; a seller-initiated cancel refunds the buyer and
  contested work must go through `dispute()`. The buyer-accepts path now charges the
  platform fee. Covered by `test_C01_SellerCannotSelfCompleteThenCancelToDrainEscrow`.
- **ISSUE-002 (auto-refund bypasses the dispute freeze)** — `claimAutoRefund` now
  requires `sc.status == Active` and rejects while Disputed; it also accepts Completed
  milestones so a seller cannot void the buyer's remedy by stalling. Covered by
  `test_H02_AutoRefundIsBlockedWhileDisputed`.
- **A-10 (overpayment confiscation — TokenFactory + AppStore)** — both forwarded the entire
  `msg.value` to the fee recipient after only checking `>= creationFee`. Now use a `_settle`
  helper (pay the fee, refund the excess) mirroring `MembaCollections`. `MembaAppStore` had no
  reentrancy guard and no tests; added `ReentrancyGuardUpgradeable` + `nonReentrant` and a first
  suite. 9 tests incl. hostile fee-recipient and refund-to-rejecting-caller paths. Branch
  coverage 53.71 → 55.36.
- **ISSUE-010 (backend evmreader/evmrender — three defects)** — (1) `GetDAOMembers` decode now
  goes through `abi.ConvertType` (which handles geth's tag-carrying anonymous tuple struct)
  and **returns an error on any shape mismatch** instead of silently `continue`-ing, so it can
  no longer return an empty slice with a nil error. (2) `boundedMemberCount` rejects negative,
  int64-overflowing, and above-cap member counts before the `make([]…, 0, count)`, closing the
  attacker-chosen-address OOM (cap = `Config.MaxMembers`, default 1000). (3) `RegisterRoutes`
  now requires a `Middleware` wrapper argument (a route cannot be registered without the repo's
  rate-limit/auth), and `requireAddr` rejects non-hex/cropped-hex path values with 400 before
  any read. Unit tests: `evm_reader_test.go` (decode round-trip, count-bound matrix) and
  `handler_test.go` (invalid-address matrix). ⚠️ Still unwired into `main.go` (imported by
  nothing) and a known-DAO allowlist (A-7b) remains open.
- **ISSUE-007 (Candidature ADMIN_ROLE grant) + A-1 launchpad wiring** — both are post-deploy
  Safe steps the deployer EOA cannot perform, now captured as a runbook
  (`DEPLOY_CEREMONY.md`): step 1 grants the Candidature proxy `ADMIN_ROLE` on the DAO, step 2
  calls `MembaNFT.setLaunchpad(Collections)`. `Deploy.s.sol` prints an `ACTION REQUIRED
  (Safe tx)` line for each with the exact addresses. Regression tests pin the un-granted
  Candidature deployment failing loudly and the grant fixing it.
- **ISSUE-008 (OTC cross-listing drain) + OTC decimals + OTC unbounded fee** — `list` records
  the amount **actually received** via a balance-delta measurement, so a fee-on-transfer
  token can no longer let one listing's fill drain another seller's escrow; `unitPrice` is now
  wei per whole token, converted through the token's snapshotted decimals with ceiling
  rounding (buyer never underpays); `MAX_FEE_BPS = 2000` is enforced at init and via a new
  `setPlatformFee` admin setter. Covered by `test/MembaTokenOTC.moneypaths.t.sol` (13 tests,
  incl. fee-on-transfer, rebasing, returns-false, no-decimals, and fully-confiscating mocks).
  ⚠️ A **downward** rebase remains an inherent shared-pool limitation (BACKLOG A-3b/C-6), and
  a hostile fee-recipient can still freeze `fill` (BACKLOG A-3b — no `setFeeRecipient` yet).
- **ISSUE-005 (hostile recipient freezes funds)** — payouts fall back to a withdrawable
  credit instead of reverting the whole call, and `setFeeRecipient` now exists. Covered
  by `test_H03_*`.
- **Retroactive `updateTimeouts` / fee evasion via dispute / unguarded mutators** —
  milestones snapshot `refundableAt` at funding, the window is bounded, the
  cancellation fee applies on every unwind path, and `completeMilestone`/`dispute` are
  `nonReentrant`.

- **ERC-7201 storage constants** — all 14 were fabricated rather than derived (`MembaDAO`'s
  came from `cast index`, a mapping-slot helper; the rest were hand-typed patterns). Now
  derived and pinned by `test/StorageSlots.t.sol`, with a negative control and the formula
  itself checked against OpenZeppelin's published `Initializable` slot.
- **Dependency provenance** — 2,285 vendored files (~430K lines) committed with no
  `.gitmodules` and no lockfile are now pinned submodules (forge-std v1.16.2, OZ v5.3.0 ×2).
  The removed tree was verified byte-identical to upstream v5.3.0.
- **No CI on `contracts/evm`** — `.github/workflows/evm.yml` now runs build, fmt, test,
  coverage-with-ratchet, Slither, and negative-control canaries. `ci.yml` triggers extended
  to `dev/evm-migration`, and its no-op `tsc --noEmit` replaced with `tsc -b --force`.

---

## ⚪ Process

- **`evm_version = "cancun"`** in `foundry.toml` is unverified against Robinhood Chain's
  ArbOS version. Confirm before deploying — Cancun opcodes (`MCOPY`, `TSTORE`) may not be
  supported, in which case contracts fail to deploy or revert at runtime.
- **`.env.example` ships the Anvil account-0 private key** as `DEPLOYER_PRIVATE_KEY`. It
  fails closed only because `SAFE_MULTISIG_ADDRESS` is empty.
- **`MembaNFTMarket.sol` does not exist** but S033-036 is ticked complete in PROGRESS.md. It
  is one of four named revenue lines.
- **`MembaFees.sol` and `MembaAccessControl.sol` are dead code** (0 importers, 0% coverage);
  fee math is instead hand-rolled inline in five contracts.
- **PROGRESS.md is not machine-checked.** A tick should require a script mapping it to an
  artifact and a test.

---

## Issue Template

```
### ISSUE-XXX: Title

**Severity**: 🔴 CRITICAL / 🟠 HIGH / 🟡 MEDIUM / 🟢 LOW
**Found in**: Session XXX
**Status**: ⬜ Open / 🔄 In Progress / ✅ Resolved
**Owner**: AI / Human

**Description**: What's wrong.
**Impact**: What happens if not fixed.
**Workaround**: Temporary fix, if any.
**Resolution**: How it was fixed (fill when resolved).
```
