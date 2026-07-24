# Session Handoff — EVM Remediation, 2026-07-24

**Branch:** `feat/evm/remediation` (16 commits) · **Worktree:** `/Users/zxxma/Desktop/Code/Gno/Memba-worktrees/evm-remediation`
**Base:** `feat/evm/foundation` @ `2e385c71`
**Status:** ⚠️ **local only — never pushed, no PR.** See "Before pushing" below.

---

## 1. Why this session existed

An independent audit (6 fresh expert sub-agents + direct verification) of the 21-commit
`feat/evm/foundation` branch found that **only 3 of the plan's 8 quality gates genuinely
passed**. The rest were never run, or were run with a command that could not fail.

The root cause is worth carrying forward: **`npx tsc --noEmit` type-checks nothing in
this repo.** `frontend/tsconfig.json` is a solution file (`{"files": [], "references":
[…]}`), so tsc had no inputs and always exited 0. It was reported green six times across
21 commits while 22 real type errors accumulated. The plan itself (§11.5 Gate 4) and the
repo's own CI both hardcoded that command, and the workspace memory had already recorded
it as a known no-op.

**A gate that cannot fail is worse than no gate.** It manufactures confidence and
licenses skipping review. Everything below follows from that.

## 2. What was fixed

| Area | Was | Now |
|---|---|---|
| **Storage** | All **14** ERC-7201 slots fabricated (`MembaDAO`'s came from `cast index`, a *mapping*-slot helper; the rest hand-typed) | All derived; `test/StorageSlots.t.sol` pins each literal to its derivation, with a negative control and the formula checked against OZ's published `Initializable` slot |
| **Escrow** | A seller could self-certify every milestone then cancel and take **100% of escrowed ETH**, fee-free | Canceller can never pay themselves; dispute freeze enforced on auto-refund; pull-payment escape hatch; fees consistent on all exit paths |
| **Upgrades** | Badges/Quests gated `_authorizeUpgrade` on the **backend hot key**; no rotation anywhere; **zero timelock** | `MembaUpgradeAuthority` (own ERC-7201 namespace, two-step rotation) on 13 contracts; `TimelockController` in the deploy script |
| **Collections** | `mintNFT` could **never succeed**; 251 LOC at 0% coverage, no test file | Launchpad authorised on `MembaNFT` (creator keeps royalties), registration bound to sub-collection ownership; 18 tests |
| **Frontend** | 22 type errors, 40 lint errors, `EvmProvider` calling 4 non-existent functions, **`VOTE_MAP` inverted** | 0 / 0; `writeAndWait` generic over the ABI so bad calls are compile errors |
| **Deps** | 2,285 vendored files (430K lines), no `.gitmodules`, unprovable | Pinned submodules; verified the removed tree was byte-identical to upstream v5.3.0 |
| **CI** | **No workflow covered `contracts/evm` at all** | `evm.yml`: build/fmt/test/coverage-ratchet/Slither + **negative-control canaries**; ABI determinism gate |
| **Slither** | Never run; a self-graded "0 critical, 0 high" stood in for it | Run: 76 contracts, 0 High, 0 Medium, 16 Low, 42 Info — published, with an explicit note on why that is a floor and not a verdict |

**Current gates:** `forge` 217/217 + fmt · coverage 80.66 line / 53.20 branch / 72.97 func
(was 39.91% branch) · `tsc -b` 0 errors · `npm run lint` exit 0 · `go build` ok.

## 3. Before pushing — read this first

1. **Pushing publishes the pivot.** 10+ tracked files under `docs/evm-migration/` name
   Robinhood. Confirm `samouraiworld/memba` visibility and the disclosure timing first.
   This is a founder decision, not an engineering one.
2. **CI has never actually run.** Everything above was verified locally. The first push
   is also the first real exercise of `evm.yml` — expect to iterate on the workflow
   itself (runner-only issues: `jq` availability, submodule checkout, Slither action).
3. **Target `dev/evm-migration`, never `main`.** `ci.yml` triggers were extended to
   include it; without that a PR there would have run zero checks.
4. **A parallel session was active** on the Memba main checkout during this work (Topaz
   / feed). Re-check `git worktree list` and the index mtime before assuming exclusivity.

## 4. Where everything is written down

| File | What |
|---|---|
| **`docs/evm-migration/BACKLOG.md`** | **Start here.** Every deferred item with an ID, why it is open, and what done looks like. Sections A–G. Deliberate caps are in section E — they are decisions, not oversights. |
| `docs/evm-migration/KNOWN_ISSUES.md` | Per-defect status. ISSUE-001..010; 001–006 and 009 resolved. |
| `docs/evm-migration/SECURITY_FINDINGS.md` | Slither output + why a clean run does not mean safe. |
| `docs/evm-migration/PROGRESS.md` | Corrected — three false ticks retracted, including `MembaNFTMarket` which does not exist. |
| `CONFIDENTIAL_EVM_AUDIT_AND_PLAN_2026-07-24.md` (repo root, gitignored) | The full audit and revised plan, incl. founder decisions. |

## 5. Next, in order

The natural next items from `BACKLOG.md`:

1. **A-3 / A-4 / A-5 — `MembaTokenOTC`.** Three defects in one contract, so do them
   together: fee-on-transfer tokens let one listing drain another seller's escrow;
   `unitPrice` is decimals-unaware (the EVM twin of the Gno bug fixed in memba#992 — and
   the test fixture uses `decimals = 0`, which is exactly why it was never found); and
   `feeBps` is unbounded at init with no setter, so a fat-fingered deploy parameter
   bricks the contract permanently.
2. **A-2 — the Candidature `ADMIN_ROLE` grant.** `markApproved` reverts 100% post-deploy.
   Note this cannot be fixed by a script line alone: the DAO is created with
   `admin = safe`, so **only the Safe can issue the grant** — it needs a documented
   post-deploy ceremony step.
3. **A-6 / A-7 / A-8 — backend.** `GetDAOMembers` can never return a member, plus an
   unauthenticated OOM-kill and routes bypassing the rate-limit/auth middleware. All
   latent: the packages are imported by nothing today.
4. **A-9, A-10 remainder, C-6, C-7** — Candidature stranded ETH, overpayment on the
   remaining two contracts, fee-math consolidation, duplicate interface declarations.

**Not** next, and deliberately so: B-1..B-6 (auth and CAL) are blocked on design
decisions, and B-3 in particular requires refactoring `config.ts` away from
module-level `const`s before any UI can switch chains.

## 6. Traps this session hit — don't re-learn them

- **`npx tsc --noEmit` is a no-op here.** Use `npm run build` or `npx tsc -b --force`.
- **`@/` path alias does not exist in this repo.** No `baseUrl`/`paths`, no
  `resolve.alias`, no vitest config. Use relative imports.
- **`forge coverage` needs `--ir-minimum`** — `Deploy.s.sol` trips stack-too-deep.
- **`vm.prank` is consumed by a contract creation on the same line.** `vm.prank(x);
  target.f(address(new Foo()))` runs `f` as the test contract. Deploy first, then prank.
  This bit both this session and the original one.
- **6 `*.gno.test.ts` failures are pre-existing local toolchain drift**, not your change:
  local `gno version: develop` vs CI `GNO_PIN=7b2888c3`; `avl.Tree.Get`'s arity changed
  upstream. CI is green. **Do not edit the templates.**
- **Generated artifacts drift silently.** The frontend ABIs went stale 13-of-15 before
  anyone noticed. `contracts/evm/script/gen-abis.sh` + the CI gate now catch it.

## 7. The one thing that is not an engineering problem

External verification of the strategy's own premises found that **§3's account of Tally's
shutdown is inverted.** The document states "regulatory pressure killed it" and concludes
a vacuum exists to fill. The public record is the opposite: regulation *relaxed*, removing
the DAO-as-regulatory-armor demand, and separately the "infinite garden" thesis failed —
the industry consolidated, leaving no scalable customer base. Tally had 1M+ users, 500+
DAOs including Arbitrum and Uniswap, $1B+ processed, and still cancelled its ICO citing
lack of viable market demand.

Robinhood Chain's technical claims, by contrast, all check out (chain ID 4663, mainnet
live 2026-07-01, Arbitrum Orbit, Blockscout from block one).

§3.2, §15 and §17.5 of the strategy rest on the inverted reading. That is a founder
decision and is recorded in the confidential audit document, not here.
