# Session prep — independent verification of the 07-20 plan

> Written 2026-07-20 midday, **after** the interrupted session. Local doc, not for git.
> Method: re-verified the plan's load-bearing claims from source / live chain / GitHub, in parallel,
> without trusting the plan doc. Read-only throughout — **nothing coded, merged, or deployed.**
> Verifies: `GNODAOKIT_DEPLOYER_SESSION_PLAN_2026-07-20.md` + `MEMBA_STATUS_OVERVIEW_2026-07-20.md`.

---

## 0. Verdict on the plan

**The plan holds up. Its central conclusion — gnodaokit is not freeze-ready — survives verification
and got stronger.** Every ceremony-infrastructure claim re-verified true on-chain, including the
load-bearing one, with negative controls.

But I found **one new defect in the plan's own recommended fix (Lane 1)** that would have produced a
false green, plus 6 factual corrections. Details below.

---

## 1. NEW FINDING — Lane 1 as written manufactures a false green ⛔

This is the most important thing in this document. **Lane 1 must not be executed as specified.**

Lane 1 says: vendor the dep closure from `examples/` at the pinned GNOVERSION, and it was "verified
end-to-end: lint exit 0, test exit 0." **I reproduced that from the raw artifacts and it is true** —
7/7 lint clean, 6 ok / 1 no-test-files / **0 FAIL**, `gno fmt` zero diff, zero `downloading` lines.
The vendoring works exactly as claimed.

**The problem is what it compiled against.**

| | `Get` signature |
|---|---|
| Vendored avl used by the green build (`herm2/vendored/gno.land/p/nt/avl/v0/tree.gno:51`) | `Get(key string) (value any, exists bool)` — **two-value** |
| **topaz-1 live** `p/nt/avl/v0` (verified on chain) | `Get(key string) any` — **single-value** |

gnodaokit imports `p/nt/avl/v0` at **8 sites** and calls two-value `Get` at **18** sites. It imports
`p/samcrew/avl` **zero** times — it sits entirely outside the vendored-fork safety net the deployer
built in `deps/avl`.

**So:** vendoring `examples/` at the pin makes the *current, unrepointed* gnodaokit compile green —
against an avl ABI **that is not the one on the chain it publishes to.** That is precisely the P0-E
false-green failure mode, reproduced one layer up, in the very gate meant to restore signal.

> **Consequence:** Lane 1 must vendor **what the code will actually resolve to on-chain after #65**
> (`p/samcrew/avl`, the two-value fork being published in the ceremony) — not `p/nt/avl/v0` from
> `examples/`. Otherwise "CI green" would mean *less* than nothing: it would actively mask the one
> failure the ceremony most needs caught. **Lane 1 therefore depends on #65, inverting the plan's
> stated order** (`Lane 1 → #65`).

---

## 2. Verified TRUE (re-checked independently, not inherited)

**Live chain — all 8 claims CONFIRMED.** Primary `rpc.topaz.testnets.gno.land`, cross-checked
against the samourai sentry at identical height/hash.

- `IsAuthorizedAddressForNamespace(g1x7k4628…, "samcrew")` → **`true`**. Survived **3 negative
  controls** (wrong ns / wrong addr / one-char-mutated addr all → `false`) **and** a second node.
  The old "#1 blocker" is genuinely closed.
- Deploy 2-of-2 = **exactly 10,000 GNOT**, `sequence: 0` — the multisig has **never transacted** on
  topaz-1. Nothing has been spent; no ceremony step has run.
- `r/samcrew` empty · `p/samcrew/avl` absent · `r/demo/profile` in genesis · chain `topaz-1` live.

**Source defects — confirmed, with sharper mechanisms than the plan states:**

| ID | Verdict | Note |
|---|---|---|
| **P0-C** ufmt arity panic | ✅ **CONFIRMED exactly** | `%%` correctly *not* miscounted. gno panics (`ufmt.gno:198`), Go wouldn't. **Bonus: found why CI never caught it** — `daocond_test.gno:175` only calls `RenderWithVotes` inside the *failure* branch, so a passing suite never executes it. Still the best value-to-risk fix in the audit. |
| **P0-E** deployer false green | ✅ **CONFIRMED + worse** | Guard's `grep -vqE '/v[0-9]'` inversion lets `/v0` through — reproduced in a sandbox. Also: guard scans only `gno/p`, **never `gno/r`**; passes *vacuously* on zero imports; provenance capture at `lib/deploy.sh:207` is **log-only, never compared**. |
| **P0-F** topaz-1 unclassified | ✅ **CONFIRMED + root cause found** | Originating commit `dd76280` renamed `_deps`→`deps` **in the publisher only**; **6 consumers** still say `_deps`. Latent because test-13 takes the `elif`; **topaz-1 is the first chain to reach the else.** |
| **B1** avl equivalence | ✅ **CLOSED** — 213 lines, exactly 3 tests, CI byte-identity guard vs `f3d5a5d13` | plan correct |
| **B3** Execute re-entrancy | ✅ **ALREADY GUARDED** — verified the `UpdateStatus()` mutation lands on the *stored* pointer, so the guard is real, not cosmetic | plan correct; T-5 is a non-task |
| P1 ceremony driver / P2 probe | ✅ CONFIRMED | P2 is **unreachable dead code** — hazard is a future "fix" turning it blocking |

---

## 3. Corrections — things the plan gets wrong

Ordered by how much they change a decision.

1. **⛔ Lane 1 false green** — §1 above. Changes the execution order.

2. **#64's pin is `ba9da8eb`, not `2c7f1abe`.** The stack carries **three** distinct toolchain pins,
   not two: `4e80c37e` (main, #62) · `5111dbc2` (#63) · `2c7f1abe` (#65, #66) · `ba9da8eb` (#64).
   The plan read #64's *branch point* (`15dbc83`), not its head — #64 bumped the pin at its second
   commit. **Any merge-order reasoning built on "#64/#65/#66 all carry 2c7f1abe" is unsound.**

3. **P0-A: both competing review mechanisms are WRONG.** The plan's headline open question — "run a
   tie-break experiment: empty-string vs tx.origin" — is a **false dichotomy**. Neither is what the
   source does. `realmid.Previous()` returns the caller's **pkgpath** for a realm caller, so
   *"a DAO cannot identify a cross-realm caller" is refuted as stated.* The real defect is documented
   in gno's own stdlib (`unsafe.gno:19-25`): `unsafe.PreviousRealm()` **stack-walks to the outermost
   crossing frame, not the immediate caller.** So the hazard is specifically the A→B→DAO shape.
   ⇒ **The planned tie-break experiment would answer the wrong question.** Redesign it as a
   three-shape test (EOA→DAO; A→DAO; A→B→DAO). Consistent with the earlier sibling-auth all-clear.

4. **"CI red since 2025-11-12" is wrong, in a way that matters.** `main` last ran **2025-11-12 and
   was GREEN** — it has *never* been red; it simply stopped running (8 months). PR CI went red on
   **2026-06-04**, after a green run the same day. The defensible statement is "**CI red since
   2026-06-04; main not exercised since 2025-11-12**". Also: there is no README badge.

5. **#66 does not target `main`** — it is stacked on `feat/topaz-v2-rename` (#65), the PR carrying
   `CHANGES_REQUESTED`. **#64 is a fork PR** (`davd-gzl/gnodaokit`); its branch doesn't exist in our
   repo. And **#62 is not "untested"** — its CI ran and *failed*, which is a worse state.

6. **Counting nits:** `MAINNET_READINESS.md` §4 has **11** checkboxes, not 10 (all unchecked ✓);
   sentry comment is `networks.toml:76-78`, not 75-77; `RemoveMember` starts at `members.gno:206`.

7. **P0-D bricks earlier than stated.** Guard absence confirmed, NaN arithmetic confirmed
   (gno's float64 div has no zero guard → `0/0` = NaN, *not* a panic). But a 0-member DAO panics
   first at `assertCallerIsMember` — every entry point. NaN is a real *second* brick. Impact
   unchanged, mechanism secondary.

8. **P0-B's deletion was deliberate.** `crossing.gno`'s removal is documented in `15dbc83`'s own
   commit message as a redesign ("the realm is threaded only down the Execute path"). "Nothing
   replaced it" is misleading — the `rlm` threading *is* the replacement. The security delta (caller
   supplies the realm, not the DAO) is still real, and still latent-only because demos keep
   `localDAO` unexported.

---

## 4. Two live state hazards not in either doc

**(a) `gnodaokit` working tree is on branch `pr-64`.** The deployer resolves `source_dir` to this
exact sibling tree. A ceremony run today publishes **`15dbc83`** — the unrepointed, two-value-`Get`
source — and the guard says `OK for topaz-1`. This is P0-E **armed right now**, not theoretical.

**(b) `Memba` main checkout is detached at `e8834f3c`, 3 commits behind `origin/main`.** `main`
is held by the `barricade-deepening` worktree (clean, at tip `4a67feb4`). Harmless if known, a
footgun if someone branches from the detached checkout. **12 planning docs sit untracked** — they
exist only on this disk and are one `git clean` from gone.

---

## 5. The unresolved contradiction between the two plan docs

They disagree about what this session is for, and **neither acknowledges the other**:

| `MEMBA_STATUS_OVERVIEW` | `GNODAOKIT_DEPLOYER_SESSION_PLAN` |
|---|---|
| "Next work session = **the WS-E ceremony**" | "**gnodaokit is not freeze-ready**… fix P0-A/P0-B *before* publishing" |
| gnodaokit#65 = "merge **or deploy-from-branch at ceremony time**" | #65 is a "**hard ceremony prerequisite**", and #65 alone isn't enough |

Both were written by the same interrupted session, ~30 min apart. **This is the decision to make
before any work starts** — it is owner decision #4 in the plan, unanswered.

My read: **the ceremony should not run today.** Publishing is immutable; P0-A/P0-B are
authorization-grade and interface-breaking, so they are now-or-never. The infrastructure being GO is
an argument that we *can* run it, not that we *should*. Also note David declined the
interface-breaking scope on #66 — Lane 2 needs coordination with him, not a unilateral PR.

**Cheap, high-value, and uncontested regardless of that call:** P0-C (one line) and P0-D (three
lines) are permanent-if-frozen and coupled to nothing else.

---

## 6. ⏰ Time-critical and owner-only — today is ICO day

Independent of everything above:

1. **Flip `VITE_ENABLE_ICO_ANNOUNCEMENT`** in Netlify env + rebuild when the sale opens. Vite folds
   the flag at build ⇒ **state is not remotely detectable — verify visually.**
2. **$MEMBA supply disclosure** — still absent at sale open.
3. **ToS / Privacy** — same.

(2) and (3) were flagged "last call" this morning and are still open. Nothing in the gnodaokit /
ceremony track blocks or is blocked by these.

---

## 6b. Work completed this session (owner chose **fix-first, hold ceremony**)

Four branches, all TDD, all committed locally. **Nothing pushed, nothing merged,
nothing deployed.** Shared checkouts left untouched (`git status` clean, 0 changes).

| Branch | Repo | What |
|---|---|---|
| `fix/daocond-render-arity-panic` | gnodaokit | P0-C — the missing `ufmt` argument |
| `fix/basedao-removemember-min-guard` | gnodaokit | P0-D — minimum-member guard |
| `fix/topaz-dep-classification` | samcrew-deployer | 3a — P0-F + widened predicate |
| `fix/gnodaokit-source-guard` | samcrew-deployer | 3b — P0-E + provenance gate |

**All four merge cleanly** against each other and against David's #66 (`merge-tree` verified).

### Empirical results — the defects reproduced, then closed

- **P0-C** is no longer inferred. The failing test produced
  `panic: ufmt: not enough arguments` at `ufmt.gno:199` from
  `cond_role_treshold.gno:59`. Fixed by supplying the third argument, matching the
  behaviour the doc comment at `:56` already documented.
- **P0-D** reproduced as `Panic value: nil` — the last member was removed silently.
  The control case (removal with others remaining) passed before *and* after, so the
  test discriminates rather than blanket-refusing.
- **3a** root cause was duplicated classification logic that drifted. Both call sites
  now use one `classify_chain_deps` in `lib/network.sh`. Mutation-tested: removing
  `topaz-1` from the classifier makes the assertion fail.
- **3b** validated against the *real* trees, not fixtures: the new guard **refuses
  `pr-64`** — the tree the deployer would have published this morning, which the old
  guard passed as `"OK for topaz-1"` — and **accepts `feat/topaz-v2-rename`**.

### §1 recommendation is now demonstrated, not just argued

The P0-C/P0-D work ran on `feat/topaz-v2-rename` with `p/samcrew/avl` vendored from
the deployer's `deps/avl`. Result: **6/6 packages `ok`, lint clean, zero `downloading`
lines** — fully offline. That is Lane 1 done the corrected way, and it works.

It also **empirically confirms the §1 defect**: the existing vendor set contains
*only* `/v0`-suffixed packages (`gno.land/p/nt/ufmt/` holds nothing but `v0`), so it
cannot build `main` at all, and on its own it would have compiled gnodaokit against
the **two-value** stdlib avl that topaz-1 does not have. **Lane 1 must vendor the
fork, and therefore lands after #65.**

### Two findings that were not in any plan

1. **The hermetic bash suites are not wired into CI.** All 6 (now 8) suites in
   `projects/memba/tests/*_test.sh` are documented "Run: bash …" and invoked by **no
   CI job** — `test.yml` has only `gno-test`, `p0-fund-guard-gate`, `shellcheck`,
   `scripts-syntax`. Every ceremony-safety guard they cover is unprotected against
   regression. All currently pass, so wiring them is low-risk.
2. **A pre-existing assertion in `deploy_safety_test.sh` was checking a string that
   had moved.** Caught by running the suite, not by reading. Updated to assert the
   guard, the widened predicate, and the delegation — three checks where there was one.

### State hazards from §4, cleared

- Memba reattached to `origin/main` tip (`4a67feb4`); 26 planning docs backed up to
  `.planning-docs-backup-2026-07-20/` before anything moved.
- `gnodaokit` shared checkout moved off `pr-64` to `feat/topaz-v2-rename` — the only
  branch coherent with topaz-1. Reversible; 3b now makes the hazard impossible anyway.

---

## 6c. Second cycle — review, fix, re-review, ship

Owner directive: take the lead solo, deep review + second CTO check + deep verify at every step.
Two full adversarial review rounds ran **before** anything was pushed. Both found real defects.

### Round 1 — on the four original branches

| Finding | Outcome |
|---|---|
| **P0-D guard is at the wrong layer** | `voteRatio` divides by the electorate size; at zero holders that is `0/0 = NaN`, reachable with `MembersCount() >= 2` so the `<=1` guard never fires. Four paths, incl. `RemoveRoleFromMember`, a *default-registered* governance action. Fixed at the condition layer, matching the guard `gnolovDaoCondThreshold.voteRatio` already carried. |
| **B1 — fork gate defeatable** | It asked *"does any file import the fork"*, which a single **comment** satisfied, and which a **partially repointed tree** also passed — the realistic ceremony failure. Inverted. |
| **B2 — a third classification copy** | In `projects/gnodaokit/deploy.sh`, the *producer* of on-chain paths, with a fourth variable (`DEMO_PREFIX`) the shared classifier didn't model. My "cannot drift again" claim was false. |
| S3–S11, N3, N6 | Dirty tree, non-root repo, short pin, fail-OPEN for future chains, `set -e` counters, unset-var fallthrough, scan scope, test-file publishing, spaces in filenames, and a vacuity hole in **my own test**. |

### Round 2 — on the fixes themselves

The important half. Fix-induced regressions are the common failure mode of a review cycle, and there were two:

- **My `((errors++))` fix missed the five sibling `((warnings++))` sites in the same file** — and those abort `samcrew-verify.sh` on the *exact* ceremony starting state (multisig key, `MULTISIG_SIGNERS` not yet set). The fix silently voided itself. A repo-wide sweep found the same idiom in **ten more files**, including `lib/deploy.sh` and `lib/preflight.sh` on the ceremony path.
- **The vacuity check was whole-tree, not per-directory.** Three ways through, all reproduced; the **symlinked package directory** is a true false green with a bad publish, because `[[ -d ]]` and `gnokey addpkg --pkgdir` both follow symlinks while `find` without `-L` does not.

Also closed: backtick raw-string imports evaded both regexes (Go's `ImportPath` admits `raw_string_lit`).

### Shipped

| PR | Repo | Base |
|---|---|---|
| [#126](https://github.com/samouraiworld/samcrew-deployer/pull/126) | samcrew-deployer | `main` |
| [#67](https://github.com/samouraiworld/gnodaokit/pull/67) | gnodaokit | `feat/topaz-v2-rename` (#65) |

Deployer CI: ShellCheck, Bash Syntax and the **new Hermetic Regression Suites** job all green.
gnodaokit CI is red for the known environmental reason, not this branch.

**Base choice matters:** the gnodaokit branch sits on #65, not `main`, because `main` is
pre-interrealm-v2 — its unsuffixed `p/nt/*` imports cannot resolve on topaz-1 at all, and the
vendored set holds only `/v0` packages, so `main` is not even locally buildable.

### One thing I built and deliberately reverted

`cond_gnolovedao.gno:112` panics for a voter holding no tier role — reachable by an ordinary
member's ordinary vote, and permanent. I had a passing fix. **Reverted**, because
`cond_gnolovedao_test.gno:253` asserts that panic *on purpose*
(`panic: true, // a user with T3 when T3 is abstaining should panic`). That makes it a design
decision, not a defect, and flipping documented+tested semantics immediately before an immutable
freeze is not a call to make silently. It is the one open owner decision from this session.

---

## 6d. Lane 1 — built the corrected way

The plan's Lane 1 said: vendor the closure from `examples/` at the pin, land it on `main` first, then
rebase the stack. **Both halves were wrong**, for the reason in §1.

Built instead on `feat/topaz-v2-rename` (#65), with the avl role vendored from the **fork**:

- 23 packages, 100 `.gno` files, ~1 MB, at repo root.
- With the network unavailable: **lint clean · 6/6 packages `ok` · `gno fmt` zero diff · zero
  `gno: downloading` lines.**
- **Provenance proven, not asserted:** all 118 non-fork files are byte-identical to
  `gnolang/gno@2c7f1abe`; the fork is byte-identical to the deployer's `deps/avl`.
- Verified `gno fmt -w` touches zero vendored files, so the existing no-diff gate still passes.

Two CI guards added so it cannot rot: a **hermeticity** guard failing on any `gno: downloading` line,
and a **provenance** job re-deriving the byte-comparison against `gno@GNOVERSION` on every run —
which refuses to pass vacuously if it ever checks nothing, and asserts the fork still exposes the
two-value `Get`.

> Caught by a hook while writing that workflow: `GNOVERSION` is read from the *checked-out tree*, so
> on a fork PR it is attacker-controlled. Interpolating it into a `run:` block would have been a
> command-injection vector. It is now validated as a bare hex sha and passed through `env:`.

→ [gnodaokit #68](https://github.com/samouraiworld/gnodaokit/pull/68). This is what makes the
"CI all green" merge gate **satisfiable again** — it is currently unsatisfiable, so no gnodaokit PR
can legitimately land, including #65/#66/#67.

---

## 6e. Final state at session end

**Merged:** samcrew-deployer `main` @ `c32a5f2` (#126) · gnodaokit `feat/topaz-v2-rename` @ `7a18b35`
(#68 vendoring as a merge commit, #67 safety fixes squashed on top). gnodaokit CI green for the first
time since 2026-06-04. All repos in sync, 0 tracked changes, no dirty shared checkout.

**In flight:** gnodaokit `fix/dao-realm-identity` @ `c618485` — pushed to preserve it, **no PR**,
labelled WIP. The P0-A/P0-B interface change: compiles, `daocond`/`daokit` pass, `basedao` + demo
realms fail for a reason that is a finding rather than a bug (below).

**Handoff:** `NEXT_SESSION_PROMPT_gnodaokit_freeze_2026-07-20.md` at the workspace root.

### David's PRs — reviewed, and the outcome changed the plan

- **#64 must NOT be merged.** Its head does not compile on topaz-1 (two-value `Get` at ~19 sites), and
  merging over the ceremony branch would revert the avl repoint, delete the vendored closure, drop the
  provenance guard and undo #67/#68. Its substantive commit is already in the stack; the entire
  remaining delta is **3 files**. Cherry-pick and close.
- **#66 needs one blocker fixed** — `New()` accepting a caller-supplied realm lets a caller forge the
  DAO's own identity (demonstrated). Its empty-id guard is worth keeping but is a typo-catcher.
- **P0-A/P0-B are proven with a working PoC**, which retires the plan's "tie-break experiment" — both
  mechanisms it proposed to choose between were wrong.

### The finding that stopped the interface change

`testing.SetRealm` fabricates a `cur` with **no frame beneath it**. Probed: `cur.Previous().PkgPath()`
returns `gno.land/p/samcrew/basedao` — the package itself, not a caller. So **no `SetRealm`-based test
can validate caller identity in either direction**, which is exactly why the original defect *and*
#66's regression both passed CI. Finishing needs real realm-to-realm test packages under `gno/r/`.

Making the existing tests pass by weakening them was the available shortcut and the wrong move on a
package about to become immutable, so the work is checkpointed instead.

---

## 7. Recommended session shape

Sequencing changed by §1 and §3.3:

- **Gate 0 — owner call:** ceremony now, or fix-first? (§5)
- **Safe to start immediately, no dependencies:** P0-C + P0-D as TDD PRs. Permanent if frozen,
  ~4 lines total, uncontested.
- **Before Lane 1:** re-scope the vendor set to `p/samcrew/avl`, ⇒ Lane 1 lands *after* #65.
- **Before any P0-A fix:** redesign the tie-break as a three-shape realm test (§3.3).
- **Deployer 3a/3b** (P0-F predicate + P0-E chain-aware guard + provenance pin) are independent of
  gnodaokit and safe to do now. **3b removes hazard §4(a).**
- **Do not** apply old plan **T-4** (obsolete, would introduce a bug) or **T-5** (non-task).
