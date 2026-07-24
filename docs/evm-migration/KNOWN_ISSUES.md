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

### ISSUE-003: Upgrade authority is a backend hot key, and cannot be rotated
**Severity**: 🔴 CRITICAL · **Status**: ⬜ Open · **Owner**: Human (key policy) + AI (code)

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

### ISSUE-004: No timelock anywhere
**Severity**: 🔴 CRITICAL · **Status**: ⬜ Open · **Owner**: AI

`grep -ri timelock contracts/evm/src` → zero hits. Plan §17.2 made "Timelock on all contract
upgrades (48h minimum)" a **mandatory** CSO requirement. All 14 upgradeable contracts are
instantly upgradeable, including those custodying user ETH, with no user exit window.

---

## 🟠 High — blocks testnet deployment

- ~~**ISSUE-005**~~ ✅ RESOLVED · `MembaEscrow` push payments have no pull escape hatch. A seller contract
  arming `receive()` to revert blocks `releaseFunds`, `cancelContract` and
  `resolveDispute(true)`; a reverting `feeRecipient` bricks releases protocol-wide, and
  **there is no `setFeeRecipient`**. Slither corroborates (`calls-loop` ×6).
- **ISSUE-006** · `MembaCollections.mintNFT` can never succeed — the Collections proxy is
  not the creator of the `MembaNFT` sub-collection it mints into, and nothing makes it so.
  The launchpad's only revenue function is inert. Hidden by 0% coverage.
- **ISSUE-007** · `Deploy.s.sol` never grants `ADMIN_ROLE` to `MembaCandidature`, so
  `markApproved` reverts 100% post-deploy. The test suite does this grant explicitly
  (`MembaCandidature.t.sol:40-43`); the script does not. Because the DAO is created with
  `admin = safe`, **only the Safe can issue it** — this needs a follow-up multisig
  transaction, not just a script line.
- **ISSUE-008** · `MembaTokenOTC` records `totalAmount` before transferring and fills from a
  shared un-partitioned pool, so a fee-on-transfer token lets one listing's fill drain
  another seller's escrowed tokens.
- **ISSUE-009** · Frontend `EvmProvider` calls four DAO functions that do not exist
  (`createProposal`→`propose`, `executeProposal`→`execute`, `votingThreshold`→`thresholdBps`,
  `getMemberByIndex`→`getMember`); `createToken` omits the required `salt` and `value`;
  `getDAOProposal` destructures fields absent from the ABI (→ `NaN` votes, permanently
  "open" status). Root cause: `writeAndWait` types `abi` as `readonly unknown[]` and casts,
  discarding `as const` inference.
- **ISSUE-010** · Backend `evmreader.GetDAOMembers` can never return a member — it asserts
  geth's unpacked tuple against an untagged struct, and tags are part of Go type identity.
  Returns `[]` with a nil error. Plus an unauthenticated OOM-kill via an attacker-chosen
  contract address, and routes that bypass the repo's rate-limit/auth middleware.

---

## 🟡 Medium

- Candidature strands ETH two ways (re-application overwrites an un-withdrawn deposit;
  approved applicants can never withdraw). No `receive`/`fallback`/sweep exists anywhere, so
  it is unreachable short of an upgrade.
- `MembaTokenOTC.unitPrice` is per base unit and decimals-unaware — the EVM twin of the Gno
  OTC bug fixed in memba#992. The test fixture uses `decimals=0`, which is why it was never
  found.
- `MembaTokenOTC` accepts an unbounded `feeBps` at init with no `MAX_FEE_BPS` and no setter;
  a fat-fingered deploy parameter bricks the contract permanently.
- Overpayment confiscated on three paths (Collections create + mint, TokenFactory, AppStore).
- Auth: the new `Verifier` interface takes only a raw nonce, so it cannot express challenge
  authenticity, expiry, single-use or chain binding — re-opening `AUTH-CHAINID-01`. EVM login
  is currently blind `personal_sign`, not SIWE.
- CAL `switchChain` conflicts with the frozen-at-import network model in `config.ts`; mounting
  `NetworkSelector` would hard-block every Gno broadcast via `assertWalletBroadcastSafe`.

---

## ✅ Resolved

- **ISSUE-001 (seller drains 100% of escrow)** — `cancelContract` no longer lets the
  canceller direct funds to themselves; a seller-initiated cancel refunds the buyer and
  contested work must go through `dispute()`. The buyer-accepts path now charges the
  platform fee. Covered by `test_C01_SellerCannotSelfCompleteThenCancelToDrainEscrow`.
- **ISSUE-002 (auto-refund bypasses the dispute freeze)** — `claimAutoRefund` now
  requires `sc.status == Active` and rejects while Disputed; it also accepts Completed
  milestones so a seller cannot void the buyer's remedy by stalling. Covered by
  `test_H02_AutoRefundIsBlockedWhileDisputed`.
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
