# EVM Contracts — Security Findings

> Raw output of the security tooling, plus the findings tooling cannot reach.
> Updated whenever Slither or a review pass runs. Entries here are the source of
> truth for KNOWN_ISSUES.md.

---

## 1. Slither — first run, 2026-07-24

Plan §11.5 Gate 3 has specified `slither` since the plan was written. **It had never
been run**: slither was not installed and `slither.config.json` did not exist. A
self-graded "AI security audit: 0 critical, 0 high" was recorded in its place,
evidenced by a five-line edit to PROGRESS.md.

First real run — `slither . --config-file slither.config.json`:

```
76 contracts analyzed (98 detectors) — 58 results
```

| Severity | Count |
|---|---:|
| High | **0** |
| Medium | **0** |
| Low | 16 |
| Informational | 42 |

### Low (16)

| Count | Detector | Assessment |
|---:|---|---|
| 6 | `calls-loop` | **Not noise.** External `.call{value:}` inside the milestone loops of `MembaEscrow.cancelContract` and `resolveDispute`. This is the static-analysis shadow of a real DoS: one hostile recipient reverting in `receive()` aborts the whole loop and freezes every other milestone in that contract. Tracked as a blocking fix (pull payments). |
| 4 | `reentrancy-events` | Events emitted after external calls. Benign — ordering only, no state impact. |
| 4 | `timestamp` | `block.timestamp` comparisons in voting deadlines and the auto-refund clock. Expected and acceptable at these time scales (days), but note `updateTimeouts` applies retroactively to already-funded milestones — tracked separately. |
| 1 | `shadowing-local` | `MembaDAO.propose(...).description` shadows the `description()` getter. Cosmetic; rename the parameter. |
| 1 | `reentrancy-benign` | `MembaDAOFactory.createDAO` — state written after the proxy call. No exploitable path (factory holds no value). |

### Informational (42)

| Count | Detector | Assessment |
|---:|---|---|
| 15 | `missing-inheritance` | Corresponds to a real hygiene defect: `MembaCandidature` and `MembaChannels` each declare their **own local duplicate** of `IMembaDAO` rather than importing `src/interfaces/IMembaDAO.sol` (which is itself unused). Three declarations of one interface will drift. |
| 14 | `assembly` | The ERC-7201 `_getStorage()` slot assignment in each namespaced contract. Expected and correct. |
| 11 | `low-level-calls` | The `.call{value:}` push-payment sites. Expected today; superseded once payouts move to a pull pattern. |
| 1 | `cyclomatic-complexity` | `MembaEscrow.cancelContract`. |
| 1 | `unindexed-event-address` | An address event parameter is not indexed — hurts indexer filtering. |

### What this result does and does not mean

**0 High / 0 Medium is a genuine but narrow result.** Slither found no
pattern-detectable high-severity issue, and that is worth having.

It is **not** evidence the contracts are safe. Every critical finding from the
independent review is invisible to static analysis, because each is a business-logic
or authorization defect rather than a code pattern:

- **A seller can take 100% of escrowed ETH** by calling `completeMilestone` on every
  funded milestone (a unilateral seller assertion) then `cancelContract`, whose
  `Completed` branch pays the seller in full with no fee. Slither cannot know that
  `completeMilestone` should require buyer acceptance.
- **`claimAutoRefund` never reads `sc.status`**, so a buyer can drain funds out of an
  active dispute and nullify arbitration. Slither cannot know the freeze is required.
- **All 14 ERC-7201 storage constants were fabricated** rather than derived. Slither
  cannot know what a namespace *should* hash to. (Fixed; now pinned by
  `test/StorageSlots.t.sol`.)
- **`MembaCollections.mintNFT` can never succeed** — the proxy is not the creator of
  the `MembaNFT` sub-collection it mints into. Slither cannot know the intent.

The prior session's "0 critical, 0 high" claim happens to coincide with what Slither
reports. That coincidence is precisely the hazard: the number looked right while the
actual exploitable bugs sat untouched, and it was produced without running the tool
at all. **Static analysis is a floor, not a verdict.**

---

## 2. Findings from independent review (not tooling-detectable)

These come from the six-lens expert audit on 2026-07-24. Severity is ours, not a
tool's. Each is tracked in KNOWN_ISSUES.md.

| ID | Severity | Location | Status |
|---|---|---|---|
| C-1 | 🔴 Critical | `MembaEscrow.sol:207-225`, `:375-385` — seller self-completes then cancels, takes everything | open |
| C-2 | 🔴 Critical | All 14 `STORAGE_LOCATION` constants fabricated | ✅ **fixed** — derived + pinned by test |
| H-1 | 🟠 High | `MembaEscrow.claimAutoRefund` ignores `sc.status` | open |
| H-2 | 🟠 High | Push payments + no pull escape hatch → hostile recipient freezes funds | open |
| H-3 | 🟠 High | `MembaBadges`/`MembaQuests` `_authorizeUpgrade` gated on the backend hot key; no rotation on 13 of 14 contracts | open |
| H-4 | 🟠 High | No timelock anywhere (§17.2 made it mandatory) | open |
| H-7 | 🟠 High | `MembaCollections.mintNFT` unreachable | open |
| H-8 | 🟠 High | `Deploy.s.sol` never grants `ADMIN_ROLE` to `MembaCandidature` → `markApproved` always reverts | open |
| H-9 | 🟠 High | `MembaTokenOTC` shared pool + fee-on-transfer tokens → cross-listing drain | open |
| M-* | 🟡 Medium | Stranded deposits, fee evasion on both sides, OTC decimals, unbounded fee at init, overpayment confiscation, retroactive timeout | open |

---

## 3. Reproducing

```bash
cd contracts/evm
pip install slither-analyzer
slither . --config-file slither.config.json
```

CI runs this on every PR touching `contracts/evm/**` (`.github/workflows/evm.yml`),
failing on HIGH. MEDIUM/LOW are reported and uploaded as SARIF but do not block yet —
that threshold should tighten once the open findings above are closed. This is a
deliberate, recorded choice, not a silent cap.
