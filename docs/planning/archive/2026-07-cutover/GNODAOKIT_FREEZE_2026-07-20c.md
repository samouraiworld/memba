# gnodaokit pre-freeze — P0-A/P0-B closed, and what the freeze still has to decide

> 2026-07-20 evening. Continues `SESSION_PREP_VERIFICATION_2026-07-20b.md`.
> Everything below was verified in this session against source, the VM, or a running test —
> not inherited. Where an earlier document is contradicted, the correction is called out.

---

## 0. What shipped — four stacked PRs, all green

**Merge order is `#69 → #70 → #71 → #72`.** Each is stacked on the one before, so squash-merging a
base orphans the next — use a merge commit or retarget, exactly as recorded for #65/#66.

| PR | Branch | What |
|---|---|---|
| **[#69](https://github.com/samouraiworld/gnodaokit/pull/69)** | `fix/dao-caller-identity` → `feat/topaz-v2-rename` | P0-A + P0-B, one interface change, realm-to-realm tests under `gno/r/daoidentity/` |
| **[#70](https://github.com/samouraiworld/gnodaokit/pull/70)** | `freeze/exported-surface` → `fix/dao-caller-identity` | #66 taken minus its blocker; three permanent surface mistakes; empty role names; the docs |
| **[#71](https://github.com/samouraiworld/gnodaokit/pull/71)** | `chore/repin-gnoversion-topaz` → `freeze/exported-surface` | `GNOVERSION` → `fc4052651`, `vendored/` regenerated |
| **[#72](https://github.com/samouraiworld/gnodaokit/pull/72)** | `fix/proposal-lifecycle-and-extension-gate` → `chore/repin-gnoversion-topaz` | the five outstanding expert recommendations, and the three defects two further reviews found **in those fixes** |

All four are `CLEAN` — every check green, including the `vendored-provenance` byte-comparison, which
reported `checked 118 file(s) … drift 0, deleted 0` at `GNOVERSION=fc4052651`.

The WIP branch `fix/dao-realm-identity` @ `c618485` is left untouched as a record; nothing was
force-pushed.

At the tip: **10 packages ok · lint clean · `fmt -diff` clean · zero `gno: downloading` · README
fixtures match · deployer `assert_gnodaokit_source_form topaz-1` passes**.

**Nothing is merged, and no PR was closed.** Closures should follow merges, not precede them — see §6.

---

## 1. The one design change on top of the WIP: `IsCurrent()`

The WIP gate compared pkgpaths only. That is defeatable, and it was **reproduced end to end**.

Every realm the DAO crosses out into during an action receives the DAO's own realm value as its
`cur.Previous()`. It can hand that value straight back inside the same transaction — same pkgpath,
but a frame that is no longer executing. With a pkgpath-only gate a callee re-entered `Propose`
under the DAO's own identity and was accepted (`Reentered() == true`).

`rlm.IsCurrent()` is frame identity rather than name (`realmIsCurrentOnMachine`, `uverse.go:591` —
HIV pointer comparison against the topmost crossing frame's `Cur`). Verified by probe that it:

- **survives the `/p/` hop** — `rlm.IsCurrent()` is `true` when a realm threads its `cur` into a
  `/p/` package method, which is exactly basedao's shape; and
- **holds during a realm's own `init`** — so it cannot brick construction, which would have been
  strictly worse than the hole it closes.

This is gno's own documented discipline (`AGENTS.md`: *"In crossing functions, always use
`cur.IsCurrent()` before calling `cur.Previous()`"*). One line.

---

## 2. ✅ FIXED in #72 — the Render-brick P0

**Found by review, reproduced, pre-existing, freeze-permanent. Fixed in #72.**

- `daokit/proposals.gno:92` — `GetProposals` calls `prop.UpdateStatus()` on **every** proposal.
  The code's own comment says `// XXX: costly and probably insecure`.
- `daokit/proposals.gno:104` — `UpdateStatus` flips `Open → Passed` once the condition is met.
- `daokit/daokit.gno:93` — `Core.Execute` panics `"proposal is not open"` for any status but `Open`.
- `Render(path)` is on the **cross-realm** `daokit.DAO` interface and reaches `GetProposals`.

Measured:

```
status after the yes vote      = Open
status after a foreign Render  = Passed
Execute                        → panic: proposal is not open      (forever)
```

`Vote` never calls `UpdateStatus`, so a proposal sits at `Open` after reaching its threshold. Anyone
calls `Handle().Render("proposals")` inside a transaction and it flips to `Passed` — permanently
unexecutable. Cost: one cheap tx. Repeatable after every re-vote.

**⚠️ Coupling — do not fix naively.** That same `!= Open` guard is currently the *only* thing
blocking re-entrancy on the same proposal (verified: `UpdateStatus()` moves it to `Passed` before
the handler runs). A fix must set an explicit executed/executing marker **before**
`Handler.Execute` at `daokit.gno:102`, not after at `:103`.

**How #72 fixes it.** Reading no longer writes: `DisplayStatus()` computes what to show, and `Status`
is written **only** by `Execute`, so a stored proposal is `Open` until it is `Executed` and `Passed`
exists purely as a rendered state. `Execute` is gated on the condition and nothing else, with
`Executed` the only disqualifier.

The executed marker moved **before** the handler. Mutating it back does not fail the suite — **it
hangs**, recursing without bound, which is worth knowing as a CI failure mode.

**The coupling bit me exactly as warned.** Relaxing `Execute` while leaving `Core.Vote` demanding
`Open` did not fix the bug, it *inverted* it: with `UpdateStatus` still exported, persisting `Passed`
stopped bricking a proposal and started **locking it in** — votes frozen, support unwithdrawable,
execution guaranteed. `UpdateStatus` is now gone (no consumer outside gnodaokit; verified across
Memba and the deployer), and `Vote` and `Execute` share one terminal state: a ballot stays live until
the proposal executes.

**⚠️ `Execute` is not retry-safe.** gno's `recover()` does not roll back realm state, so a host realm
that recovers around a failing `Execute` keeps the marker and burns the proposal permanently. The
ordering is worth more than the retry, so this is documented rather than reverted — but **any
consumer that recovers around DAO execution needs checking.**

---

## 3. Corrections to earlier plans

| Earlier claim | Reality, measured |
|---|---|
| `unsafe.PreviousRealm()` stack-walks to the outermost crossing frame, so `EOA → intermediary → DAO` names the EOA | **False as stated.** Measured `driver → mid → target`: `cur.Previous()`, `unsafe.PreviousRealm()` in a crossing fn, and in a non-crossing `/p/` helper **all** return `mid`. The walk only misreports in the shape where a caller invokes the DAO methods *through the handle*, so no DAO realm frame exists — which the gate now rejects first. |
| Init-time `InstantExecute` "fails closed with an empty caller id" | **Harness artifact.** `buildOriginRealm` (`uverse.go:399`) sets `{OriginCaller, ""}`, so `IsUser()` holds and a root-of-chain call resolves to the **signing account**. `gno test` leaves `OriginCaller` unset, which is the only reason `""` appears. My own first test asserted this and was wrong; corrected. |
| The security content is in the identity derivation | **It is entirely in `assertRealmIsOwn`.** Swapping `rlm.Previous()` back to `unsafe.PreviousRealm()` leaves all tests green, because the gate has already established the DAO's frame is live. The threaded form is kept because it does not depend on the gate having run first — but the comments claiming otherwise were corrected. |

Also established: **realm values cannot be persisted** (`cannot persist realm value: realm values
are ephemeral and tied to a call frame`), which bounds every donation/capture attack to one
transaction. And `testing.SetRealm` is worse than recorded — *before* `SetRealm`, `cur.PkgPath()`
is empty and `cur.Previous()` **panics**.

---

## 4. Freeze decisions still open

The exported surface was enumerated in full. These are the items where the window closes at publish.

### 4a. Mechanical, low risk — recommend doing in one cleanup PR

| Item | Why now |
|---|---|
| `basedao/members_extension.gno:9` — `MembersViewExtensionPath = "gno.land/p/demo/basedao.MembersView"` | Module is `p/samcrew/basedao`. This is the extension **registry key**, frozen forever. Nothing depends on the literal but a doc comment. |
| `daokit/proposals.gno:51` — `Proposal.ExecutorID` exported, **never written** anywhere | Freezes a permanently-`""` field. `Execute` computes exactly this value and discards it. Recommend **removal**; populating it needs `Core.Execute`'s (also frozen) signature. |
| `daocond/daocond.gno:44-48` — `VoteYes/No/Abstain` are **untyped** despite `type Vote string` at `:41` | Typing them breaks exactly **one** call site (`view_proposal_detail_page.gno:47`, fix with `string(...)`) and removes a redundant conversion at `daokit.gno:83`. |
| `basedao/members.gno:184` — `AddMember("")` succeeds | This is #66's guard. Take it. |
| READMEs document forms that **no longer compile** — `basedao/README.md:127,148,155-159,244,249,291,358,410`, root `README.md:124-126,224`, `realmid/README.md:44-47` | Docs ship with the frozen package. Also fold in #64's "unexport `localDAO`" intent, which is security-relevant guidance. |

### 4b. Resolved in #72 — how each was decided

| Item | Decision taken |
|---|---|
| **Cross-realm `InstantExecute` / sub-DAOs** | **Documented as same-realm-only, and pinned by a test.** Not given a delegated-entry API: the cross-realm form only ever worked *because of* the vulnerability — it is the donation shape — and inventing a new frozen API the day before a freeze is the riskier call. The supported path (reach the child through the child realm's own crossing function, and make the parent a member) works today and is documented at both `InstantExecute` and `NewInstantExecuteAction`. |
| **`daoPublic.Extension`** | **Changed to `Extension(path string, rlm realm)`**, gating **private extensions only** — gating public ones would break `MembersViewExtension`, the documented cross-realm membership check, and the suite catches that mutation as well as the reverse. The lax half closes by construction: an `ExecuteLambda` callback receives no realm, so it cannot produce one. |
| **`MigrateFn` threshold + opaque `String()`** | **Own `Config.MigrationCondition` + a required label.** Two wrong turns on the way, both caught: *replacing* a role-gated condition with a members threshold **dropped the role gate** (a ballot that failed "add a member" **passed the takeover**), and *conjoining* one can make migration permanently unreachable for role-governed DAOs — unrepairably, since changing the rule needs a migration. Final: a DAO that chose its own governance keeps it, with docs telling it to set `MigrationCondition`; only default 60% governance is raised to 80%. |
| **`p/samcrew/realmid`** | **README fixed; still published.** It now carries a "not for caller authentication" warning and shows the threaded-realm form. **Dropping it from the deployer's publish set remains an owner call** — it is a deployer change with ceremony sequencing implications, and the package is harmless with correct docs. |

### 4b-bis. Still owner-only

- **Should `realmid` ship at all?** See above. Zero consumers.
- **`UpdateStatus` was REMOVED** from the exported surface in #72. No consumer exists outside gnodaokit
  (verified across Memba and samcrew-deployer — only planning docs mention it), and it was the trap
  that inverted the lifecycle fix. But it *is* an API removal on a package with a live test13
  deployment, so overrule if you would rather keep it.
- **`Execute` is not retry-safe** (§2). Any consumer realm that recovers around DAO execution needs
  checking.

### 4c. Verified and accepted as-is

- **`Core.Vote`/`Core.Propose` bypass is NOT reachable cross-realm.** `Core` hangs off `DAOPrivate`,
  obtainable only as `New`'s second return; `daokit.DAO` exposes no path to it. The demos use it for
  in-`init` seeding. The risk is entirely "a realm chooses to export `daoPrivate`", already warned at
  `basedao.gno:53`.
- **`d.Realm` is anchored safely** — `New` uses `unsafe.CurrentRealm()`, not the threaded `rlm`. The
  VM independently hard-refuses constructing with a foreign realm
  (`cross: rlm is not the current cur (stale capture or sibling frame)`).
- **Sub-realm tokens cannot pass the gate** — `Sub` synthesizes `host#subpath` and `#` is reserved in
  package paths, so a sub-token's `PkgPath()` can never equal a `#`-free DAO pkgpath. `Sub`'s own
  entry guard is strict receiver-HIV identity, so no foreign realm can mint one bearing the DAO's path.
- `ExtensionsStore.Tree` being a value while siblings are pointers, and `SetImplemRaw` vs
  `SetImplemFn` — cosmetic. Accept and note.

---

## 5. ⚠️ Process hazard for the freeze: the review toolchain is older than the chain

`GNOVERSION=2c7f1abe` (2026-06-01). topaz-1 runs `fc4052651` (2026-07-17).

The offline toolchain **has no sub-realm support at all** — `cur.Sub("x")` fails preprocessing with
`missing field Sub in .uverse.realm`, and `realmSubpathOf` / `topmostCrossingFrameCurHIV` are absent
from the binary. The pinned clone at topaz-1's genesis base **has** them.

So none of the current tests can exercise the sub-realm semantics the design reasons about, and the
harness has an empty `OriginCaller` — which is exactly what produced the wrong init-time conclusion
in §3. **This is the concrete argument for the GNOVERSION repin**, beyond the ~15 vendored packages
that already differ from the chain.

**✅ DONE in #71.** The vendored `p/nt/avl/v0.Get` is now single-value, matching the chain, so the
skew that gate existed to contain is gone and a green build corresponds to what `AddPackage` sees —
for the stdlib deps; `p/samcrew/*` still exists on no chain until the ceremony publishes it.

⚠️ **Regenerating, if it is ever done again:** a `--filter=blob:none` clone fetches blobs lazily and
takes *hours*. I read "13 packages missing upstream" off a half-finished checkout before catching it.
Use the codeload tarball — `curl -sSL https://codeload.github.com/gnolang/gno/tar.gz/<sha>`, ~46 MB,
seconds. macOS `tar` has no `--wildcards`; take the root directory from `tar tzf | head -1`.

---

## 6. Remaining lanes

**Done and awaiting review:** #69, #70, #71, #72 (§0), all `CLEAN`. Between them they close
P0-A/P0-B, take #66's substance, settle §4a in full, resolve every §4b item, fix the §2 P0, absorb
#64's entire residual delta, and supersede #63.

**⛔ And [samcrew-deployer #127](https://github.com/samouraiworld/samcrew-deployer/pull/127) — ceremony-blocking, `CLEAN`.**
`memba_dao` is the only realm coupling to gnodaokit and **does not compile** against the new
interface. The failure mode is the bad one: the ceremony publishes gnodaokit successfully, then fails
`AddPackage` on `memba_dao` *after* the immutable packages have landed. Found by compiling it by
hand — nothing in either repo's CI would have. Its ACL suite was also already rotted (v1 bare `cross`,
old `uassert` arity), verified against gnodaokit *before* the interface change, so that part is rot
rather than fallout. All 9 tests now pass against the freeze stack.

**Still open, in priority order:**

1. **Merge `#69 → #70 → #71 → #72`**, in that order, with a merge commit or retarget rather than a
   squash — squashing a base orphans the next PR in the stack. **Then deployer #127**, which does not
   compile against gnodaokit before #69: the two repos have to move together.
2. **Two things I decided that you may want to overrule** (§4b-bis): removing exported
   `UpdateStatus`, and leaving `realmid` in the publish set.
3. **Close the seam in CI, once the stack is merged.** Ready-to-apply recipe below.

### ✅ Retry-safety exposure — audited, all clear

`Execute` is not retry-safe (§2), so the question is whether anything recovers around it. Audited:

- **Zero** `recover()` / `revive()` in any non-test realm source across the whole deployer tree. The
  same grep finds **26** test files, so it is working — this is a real zero, not a broken pattern.
- **Exactly one** DAO execution call site in any realm: `memba_dao.gno:87`, with no recover around it.

So the hazard has **no live exposure today**. It is a constraint on future consumers, and it is
documented at `Core.Execute`.

### ✅ Ceremony path — dry-run verified against the freeze stack

`SAMCREW_GNODAOKIT_DIR=<stack tip> SAMCREW_GNODAOKIT_COMMIT=6d29025 ./projects/gnodaokit/deploy.sh
test14 --dry-run`:

```
[  OK]  gnodaokit source form is valid for topaz-1
[  OK]  Source provenance verified: 6d29025 (clean tree)
        7 artifacts, unsuffixed paths (PKG_SUFFIX and DEMO_PREFIX both empty — correct for topaz-1)
```

Negative-controlled, so the guards are not passing vacuously — each refuses:

| Control | Result |
|---|---|
| no `SAMCREW_GNODAOKIT_COMMIT` on an enforced lane | `FAIL: No expected source commit pinned … Publishing is immutable on this lane` |
| wrong commit (`7a18b35`) | `FAIL: Source provenance mismatch … expected 7a18b35, tree is at 6d29025` |
| dirty tree | `FAIL: … has uncommitted changes — refusing to publish` + names the file |

### The seam gap, and how to close it

`memba_dao` sits in `test.yml`'s `continue-on-error: true` INFO block (line ~111), whose handler
literally logs `WARN: non-gating failure`. So a breaking interface change in gnodaokit reaches the
ceremony path with CI green on both sides.

The machinery to fix it **already exists**: the `p0-fund-guard-gate` job builds a v2-capable gno at
`GNO_REF` and has a `run_gated()` helper (line ~353) with anti-drift and anti-vacuous guards, already
applied to `memba_dao_candidature_v3` and `agent_registry_v2`. The job also already vendors a
dependency closure into `examples/` for `memba_token_otc_v2`.

So closing it is: check out `samouraiworld/gnodaokit` at a pinned commit, copy its
`gno/p/{realmid,daocond,daokit,basedao}` into `$VENDOR_P/samcrew/`, then add
`run_gated projects/memba/realms/memba_dao "$VENDOR_R/memba_dao"`.

**Do it AFTER the gnodaokit stack merges, pinned at the merged commit.** Adding it now would pin CI
to an unmerged branch, and pinning to today's `feat/topaz-v2-rename` would test against the old
interface and fail #127.

**Backlog — close only AFTER the replacements merge, not before:**

| PR | Disposition | Why |
|---|---|---|
| **#64** | close | Residual delta was exactly 3 files. Both READMEs are handled in #70; its Makefile bump to `ba9da8eb` is superseded by #71's `fc4052651`. Nothing of it is left. |
| **#63** | close | Proposes `5111dbc2`, older than the chain. Superseded by #71. |
| **#62** | close | Tested-and-failing; its P0-C/P0-D content already landed in #67. |
| **#25** | **owner's call, not mine** | 11 months stale, CONFLICTING, blocked on a private Pinata gateway gnoweb will not authorize. It is a community contribution — closing it is a relationship decision, not a technical one. Keep issue #22. |
| **#65** | **owner's call** | It is the integration back to `main`, and its branch now carries the whole stack. Its title still describes the obsolete `/v2` rename. Either retarget/retitle it, or accept that the ceremony publishes from the branch and `main` stays behind. |

---

## 7. Ceremony state — unchanged

`samcrew` authorized · deploy 2-of-2 holds 10,000 GNOT at `sequence: 0` · topaz-1 live · `r/samcrew`
empty · `p/samcrew/avl` absent (the deployer publishes it first; hard prerequisite).

The hold is still correct: §2 alone is a reason not to publish today.

**Owner items still open and not mine:** `VITE_ENABLE_ICO_ANNOUNCEMENT` flip · $MEMBA supply
disclosure · ToS/Privacy · `QUEST_ADMIN_ADDRESSES`.

---

## 8. Lessons worth keeping

- **Two reviewers in one worktree contaminate each other.** Both ran mutations against the same tree
  concurrently; one caught it and flagged that close calls may be unreliable. I re-verified the
  load-bearing claims myself in a clean tree. **Give each reviewer its own worktree.**
- **A test that infers its expectation from the harness is not a test.** My first init-time
  assertion pinned `gno test`'s unset `OriginCaller`, not the code. Assert on controlled input.
- **Cross-realm panics are aborts**, not panics — `urequire.AbortsWithMessage`, not
  `PanicsWithMessage`. A realm-boundary test using the wrong one fails confusingly.
- **`/p/` package-level vars are immutable post-init**, so test state must live per-fixture.
