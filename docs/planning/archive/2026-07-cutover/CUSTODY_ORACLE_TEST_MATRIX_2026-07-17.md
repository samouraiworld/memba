# Custody-Oracle Test Matrix — the pre-migration regression net
### Phase-6 deliverable · authored BEFORE any avl diff · gates the avl cut · 2026-07-17

> **Why.** The avl `Get` 2→1 migration touches every custody realm. A **compile-green** dry-run cannot catch a mechanically-weakened `ok`-branch (an existence/auth/dedup check silently dropped) or a **nil-vs-zero** trap on an int64 getter. So we author full behavioral oracles **at the current pinned ref (`f3d5a5d13`, pre-avl)**, get them green, and only THEN migrate — re-running the **identical** suites at the pinned mainnet-candidate ref to prove **zero behavioral drift**. **"Green at BOTH refs" is the hard gate on the cut.**
>
> **Harness rules:** `revive()`/`recover`-based (mirror the existing `*_guard_test.gno` style) — it preprocesses under the pinned v2 toolchain; **do NOT use `p/nt/uassert`** (doesn't preprocess at gno head). Drive funds with `testing.IssueCoins` + `SetOriginSend`; assert realm-balance + recipient deltas, not just "must not abort". Each suite = **paired positive + negative controls** (the negative proves the guard still rejects if weakened). Line refs are from the adversarially-verified audits — confirm at author time.

Legend per row: **POS** = happy-path behavior + balance-delta assertion · **NEG (avl-risk)** = the `ok`-gated branch that MUST still reject (the migration risk site).

---

## 1. `escrow_v3` (→ `escrow_v4`) — 8 fund-movers, only 2 guard tests today
| Entrypoint | POS (assert) | NEG (avl-risk branch that must still reject) |
|---|---|---|
| `CreateContract` | contract stored; client funds escrowed = realm balance delta | duplicate/invalid id rejected |
| `FundMilestone` (206) | milestone funded; realm balance += amount | **IsUserCall guard**; contract-existence `contracts.Get(id)` (675/753) → missing contract panics |
| `CompleteMilestone` (262) | state→complete; no funds move yet | non-party caller rejected |
| `ReleaseFunds` (296) | freelancer += (amount−fee); FeeRecipient += 2%; realm balance −= amount; **CEI: state set before sends** | double-release blocked by `newlyReleased` guard (465-480) |
| `RaiseDispute` (350) | state→disputed | non-party rejected |
| `ResolveDispute` (387, admin) | funds split per resolution; deltas asserted | **assertNotPaused MISSING here** → pause-coverage test is **RED vs v3** (documents the gap), **GREEN vs v4** |
| `CancelContract` (451) | refund path; client refunded; realm balance −= refund | double-refund blocked by `newlyRefunded` guard |
| `ClaimRefund` (515, permissionless) | client principal returned; deltas asserted | **assertNotPaused MISSING** (permissionless drain path) → RED vs v3 / GREEN vs v4 |
| `ClaimDisputeTimeout` (559, permissionless) | timeout payout; deltas asserted | **assertNotPaused MISSING** (permissionless drain path) → RED vs v3 / GREEN vs v4 |
**Extra invariants:** the dispute/cancel interplay never double-pays (assert `newlyRefunded`+`newlyReleased` together); multi-send release ordering is state-before-interaction.

## 2. `agent_registry_v2` — credit ledger (v1→v2 dropped the funded-deposit suite)
| Entrypoint | POS (assert) | NEG (avl-risk branch) |
|---|---|---|
| `DepositCredits` | `GetCredits(depositor)==deposited`; realm balance += amount | non-user-call rejected (guard test exists) |
| `UseCredit` (497, creator/admin-only, 508) | credits −= n; earnings += n (delta pair asserted) | non-creator/non-admin rejected; **credit-existence read** ("no credits" guard ~503-515) still panics when absent |
| `RefundCredits` (623) | depositor refunded; earnings/credits adjusted; realm balance −= refund | refund without credits rejected |
| `WithdrawEarnings` (585) | creator paid earnings; realm balance −= earnings | withdraw without earnings rejected |
| `RemoveAgent` (at `MaxDepositorsPerAgent` cap) | **every** depositor refunded (loop) — assert each delta | unauthorized remove rejected |
| **read getters** `GetCredits`/`GetUsage`/`GetEarnings` (559/569/577) | absent key returns the **zero sentinel**, NOT a panic | **nil-vs-zero trap (GNO1-2):** a mechanical `.Get(k).(int64)` on an absent key panics → converts a pure read into a tx-aborting getter. **Positive-control every int64 read getter.** |
**Solvency:** Σ(credits + earnings liabilities) ≤ realm balance — as a **monitored read/emit, never a hard panic** on a withdrawal path (red-team: a panic there = self-inflicted fund-lock).

## 3. `memba_token_otc_v2` — `Fill` swap body completely unexercised today
| Entrypoint | POS (assert) | NEG (avl-risk branch) |
|---|---|---|
| `ListTokens` (48-98) | listing stored; balance+allowance checked at list time | invalid symbol/amount rejected |
| `Fill` (121-235) | **full** fill: buyer token += qty, seller proceeds += payment−fee, treasury += fee, listing consumed; **partial** fill: remaining qty correct; CEI (195-201); int64-overflow guard (171); fee-on-transfer delta guard (221) | **IsUserCall (132)**; **listing-existence** `listings.Get` (103/142/248) → missing listing panics; **exact-OriginSend** (190-193): `sumUgnot(OriginSend()) != price` panics |
**Phantom-liquidity (OTC-002):** an over-committed listing (approve(N) backing N listings) **reverts cleanly on Fill** — assert fund-safe revert (buyer pays gas to fail; document as accepted non-custodial risk unless committed-amount tracking is added in the cut).

## 4. `tokenfactory_v2` — ZERO test files today (canonical $MEMBA mint realm, in continue-on-error CI)
| Entrypoint | POS (assert) | NEG (avl-risk branch) |
|---|---|---|
| `New` / `NewWithAdmin` | instance created; `applyFee` mint split asserted | duplicate symbol rejected; `instances.Get` (422) missing → panics |
| `Mint` / `Burn` | supply delta correct | **admin auth** rejects non-admin; `tokenMetas.Get` (170) |
| faucet claim | cooldown enforced | **nil-vs-zero trap:** `faucetCooldowns.Get` (266) can legitimately store **height 0** → the migration must not treat stored-zero as absent. **Boundary-test height 0.** |
| `DropInstanceOwnership` | ownership cleared | unauthorized rejected |

## 5. Cross-cutting invariant suite (the drain-gate net)
- **Drain-gate (CSO-1 canonical avl site):** `registeredMarkets.Get` in `transfer.gno:50-52` (`v, ok := ...; return ok && v.(bool)`) gates the only token-movement path. **NEG test:** an unregistered/unauthorized market's `MarketTransfer` still **panics** — a dropped `ok` here turns the drain gate into an open door.
- **`RegisterMarket`:** unauthorized caller rejected; only the drain admin can register.
- **Ownership / `saleSeedSealed`:** the seal latch holds (`SeedSale` blocked after `FinalizeSaleSeed`); ownership 2-step accept holds.
- **avl equivalence + fuzz:** the vendored `p/samcrew/avl` passes insert/get/remove/iterate parity vs the stdlib avl under the pinned mainnet VM — **this runs the immutable `memba_collections`, so a divergence is permanent.** Gate the vendored fork on this before it's trusted.

## 6. CI wiring (which leg per suite — extend, don't duplicate)
| Suite | CI leg |
|---|---|
| escrow_v3/v4, agent_registry_v2 (self-contained, `revive()`) | the existing `p0-fund-guard-gate` self-contained legs (`test.yml:170`) |
| otc_v2 (real `r/` import deps) | the **vendored-dep-closure** leg (`test.yml:204-242`) |
| **tokenfactory_v2** | **move OUT of the continue-on-error INFO block (`test.yml:73-74`) INTO a gating leg** |
| avl equivalence/fuzz | the Phase-1.5 mainnet-parity leg |
| Structural: per-file `*_guard_test.gno` existence assertion + OriginSend auto-enroll | so a new custody realm can't skip the gate |

## The gate (hard precondition on the avl cut)
1. **All suites GREEN at `f3d5a5d13` (pre-avl)** BEFORE any migration diff is written.
2. avl migration lands → **re-run the identical suites at the pinned mainnet-candidate ref** → **all GREEN** (zero behavioral drift) + every NEG control still rejects.
3. Pause-coverage test flips **RED-vs-v3 → GREEN-vs-v4** (proves the `escrow_v4` pause fix landed).
4. Only then is the avl cut allowed to proceed to the freeze/ceremony.

> **Status:** implementer-ready matrix from the completed audits. Authoring the suites needs the gno toolchain + a `samcrew-deployer` worktree branch (source-only, no auto-deploy) — ready to execute the moment Bash/the toolchain is available; the avl migration itself is gated on the owner's VM-pin. No realm code written here.
