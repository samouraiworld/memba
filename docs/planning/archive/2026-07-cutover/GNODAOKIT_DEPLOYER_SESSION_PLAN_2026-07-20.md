# gnodaokit × samcrew-deployer — Audit, Cross-Check & Session Plan
**Date:** 2026-07-20 · **Scope:** `gnodaokit` + `samcrew-deployer` (Memba read-only for coupling)
**Status:** PROPOSAL — owner review pending. **Nothing was coded, committed, merged, or deployed.**

---

## 0. TL;DR

**The topaz-1 ceremony is infrastructurally GO. I verified all four gates live on-chain today.
The blocker is not the chain — it is the state of the gnodaokit source.**

Three things you need to decide, in this order:

1. **gnodaokit is not freeze-ready.** Two independent expert reviews — one already sitting on PR #65
   as `CHANGES_REQUESTED`, one fresh this session — both find a **caller-identity/authorization
   defect** in the interrealm-v2 port that PR #66 does *not* fix and that is **only fixable by a
   public interface change**. Publishing immutably now forecloses the fix forever.
2. **A one-line guaranteed panic** (`ufmt` arity) ships on the freeze path in exported public API.
   One line to fix; permanent if frozen.
3. **Zero PRs are eligible for merge** under your stated gate. gnodaokit CI has been red since
   **2025-11-12** for environmental reasons, so "CI all green" is currently *unsatisfiable* there.
   I did not merge anything. Breaking that deadlock is task #1 of the next session — and the fix is
   **proven end-to-end** (§7 Lane 1): vendor the dep closure, `lint exit 0` / `test exit 0` fully
   offline. Note that the *obvious* fix everyone reached for — bumping the toolchain pin — is
   **refuted**; it fixes neither failure class.

**Recommended sequence:** repair gnodaokit CI → land the P0 hardening → *then* #65 → #66 → freeze.
Not the other way round.

---

## 1. Verified live state (queried today, not inherited from docs)

Every row below I confirmed by direct RPC query or file read this session.

| Fact | Value | Method |
|---|---|---|
| Chain live | `network=topaz-1` on **both** official + samourai RPC | `/status` |
| Namespace enforcement | `IsEnabled()=true`, `IsPaused()=false` | qeval |
| **`samcrew` authorized** | `IsAuthorizedAddressForNamespace(g1x7k4628…,"samcrew")` = **`true`** | qeval |
| CLA | enforcement **DISABLED**; `HasValidSignature(deploy)`=`true` anyway | qrender + qeval |
| Deploy 2-of-2 balance | **10,000 GNOT** (`10000000000ugnot`) | `bank/balances` |
| `r/samcrew` | **EMPTY** — nothing deployed | qpaths |
| `p/samcrew` | `{piechart, tablesort, urlfilter}` only (genesis) | qpaths |
| `p/samcrew/avl` | **absent** — must be published in the ceremony | qpaths |
| `r/demo/profile` | **IS in topaz-1 genesis** | qfile |
| `p/nt/avl/v0.Get` on topaz-1 | `func (tree *Tree) Get(key string) any` — **single-value** | qfile |
| gno upstream drift | `git log fc4052651..master` = **0 commits** | local repo |

**⇒ All four ceremony gates pass. The prior #1 blocker (namespace authorization) is CLOSED.**
**⇒ No upstream breaking-change exposure right now.** The deployer's `GNO_REF=fc4052651` is correct.

### Docs now contradicted by the chain (must be corrected before the ceremony)
1. `config/networks.toml:68-73` — *"`samcrew` is NOT yet authorized … the refusal is EXPECTED"* → **now false.**
2. `config/networks.toml:75-77` — *"samourai sentry … maintenance page"* → now serving topaz-1 fine.
3. `CHANGELOG.md:25` — *"14 genesis-daokit ABI errors"* → premise disproven; there is **no** genesis daokit.
4. `NEXT_SESSION_PROMPT_…_2026-07-17.md` — `chain_id "dev"` / samourai-RPC-primary → now `topaz-1` / official primary.
5. `Makefile:18` — `NETWORK ?= test12` stale vs the active test14 lane.

These are not cosmetic: an operator reading (1) at ceremony time would conclude the ceremony is still blocked.

---

## 2. The central finding — gnodaokit is not freeze-ready

Publishing to topaz-1 is **immutable**. Everything below becomes permanent at that moment.

### P0-A · Caller identity is broken for cross-realm callers — **NOT fixed by #66**

Two independent reviews reach the same conclusion by different routes:

- **Review already on PR #65** (davd-gzl, `CHANGES_REQUESTED`, round 2 @ `60c4bf0`, with runnable
  adversarial realms): a DAO cannot identify a cross-realm caller; `CallerIDFn` takes no realm; the
  resolved value *tracks call shape, not the caller*. Empirically reproduced a foreign realm that
  **proposed, voted and executed**.
- **Fresh review this session**: the same gate resolves to **tx.origin** — `assertCallerIsMember`
  ends up comparing against the *signing EOA*, so a member induced to sign one transaction to an
  attacker realm lets that realm act **as the member**. Solidity tx.origin phishing, verbatim.

> **⚠️ Unresolved contradiction — do not paper over this.** The two reviews agree the defect is real,
> agree it is authorization-grade, and agree #66 does not fix it. They **disagree on the mechanism**
> (`""` empty-id vs. tx.origin fallthrough). One ran fixtures; one read the VM source at `chain/topaz`.
> The fix differs depending on which is right. **Next session must run a tie-break experiment before
> writing any fix.** The tx.origin variant is strictly more severe — it needs no pre-existing empty member.

Both agree the real fix is **interface-breaking**: `CallerIDFn` must take a realm, and
`Propose`/`Vote` must become crossing. There is also **no `realmid` helper** to derive an id from a
realm value — so every integrator open-codes it, and (see P0-C) the README gets it wrong.

**Corroboration:** gnodaokit **issue #15** (2025-08-14) — *"exposing the DAO interface allows to
execute DAO methods in the context of the caller"* — describes exactly this and was **never analyzed**.
It has been open for a year.

### P0-B · `Execute` hands callers a forgeable realm capability — **NOT fixed by #66**

`daokit.gno:17` — `Execute(id, rlm)` takes the realm from its caller, so a DAO action crosses under
*whichever realm invoked it*, not the DAO's own. Reproduced: a foreign realm's `EditProfile` recorded
the write under `r/test/caller`, while the DAO's own init recorded `r/test/daorlm`. Propagates through
`InstantExecute` — a parent DAO executing on a sub-DAO makes the sub-DAO's writes land on the parent.

The deleted `crossing.gno` used to route this through the DAO's own `crossFn`. **Nothing replaced it.**

gno's own upstream audit harness (gnolang/gno#5835) flags this shape as `interface_realm_param` on
`daokit.gno:17` and `actions.gno:27`, plus `callback_param` on `actions.gno:62`. Its prescribed fix:
*"pass inert identity data, not a forgeable realm capability."*

Latent in the shipped demos **only** because they keep `localDAO` unexported — while
`basedao/README.md:412` documents the **opposite** pattern to integrators.

### P0-C · One-line guaranteed panic in exported API

`gno/p/daocond/cond_role_treshold.gno:59`:
```gno
s += ufmt.Sprintf("%g%% of %s members with role %s must vote yes\n\n", c.threshold*100, c.role)
```
**Three consuming verbs (`%g`,`%s`,`%s`), two arguments.** I verified against topaz-1's own
`p/nt/ufmt/v0` that gno **panics** here (`ufmt.gno:198-199` → `panic("ufmt: not enough arguments")`) —
this is *not* Go's cosmetic `%!s(MISSING)`.

Reachable from `view_proposal_detail_page.gno:61` → `RenderWithVotes`, propagated through `And`/`Or`.
**Any DAO whose condition contains a `RoleThreshold` panics on every proposal-detail render — forever.**
Undetected because `RoleThreshold` is unused in the in-repo demos, but it is exported public API.

### P0-D · `RemoveMember` has no minimum-member guard

`members.gno:210` checks only `IsMember`. A 1-member DAO can remove itself (1/1 = 100% ≥ 60%), reaching
zero members. Every threshold then evaluates `0/0 = NaN`, `NaN >= threshold` is false, so **no proposal
can ever pass again — including `AddMember`.** Permanent, unrecoverable brick, inherited by every
downstream DAO. Three lines to fix.

### P1 · #66's fix is incomplete and its description is wrong

The `AddMember("")` guard is cheap and worth keeping, but:
- **Bypasses remain**: `MembersStore.Members` is an **exported `*avl.Tree`** → `Set("", …)` writes
  straight past the guard; `MigrateFn` is proposer-supplied code with full store access; and
  **already-persisted `""` entries are not evicted** — there is no migration.
- **Asymmetric**: `AddRole` (`members.gno:243`) has no empty check, and `""` is *already* a sentinel
  in `RenderRoleLink` (`utils.gno:56,68`).
- **`New()` change is weaker on trust, not stronger.** `Realm: unsafe.CurrentRealm()` →
  `runtime.NewRealm(rlm.Address(), rlm.PkgPath())` replaces a runtime-derived value with an
  **unvalidated caller argument**. gno's own source says a constructed Realm *"carries no
  runtime-validated authority"*, and `New` never calls `rlm.IsCurrent()`. **Required: add that guard.**
  The commit message's rationale (*"`unsafe.CurrentRealm()` returns the borrower"*) is inaccurate for
  this call site — `basedao.New` is a top-level `/p/` function, so no borrow rule applies.
- **The README "fix" preserves a bug**: `cur.Previous().Address()` returns a *derived package address*
  for a realm member, which can never match a **pkgpath-keyed** entry (the whole point of #58). The
  example silently excludes every realm member.
- **PR body asserts a fixture that is not in the diff** (`members_test.gno` has three tests, none
  cross-realm).

**⇒ Keep the guard; rewrite the description; do not ship #66 as "the identity hardening PR" while
P0-A/P0-B stand.** Mislabeling it will read as "the identity issue was handled."

---

## 3. The publish hazard, today (samcrew-deployer)

### P0-E · The deployer would publish the wrong gnodaokit source, and its guard says OK

Verified proof chain, every link:
1. `projects/gnodaokit/manifest.toml` → `source_dir = "../gnodaokit"` — a **sibling working tree**.
2. That checkout is on branch **`pr-64` @ `15dbc83`**.
3. It imports `gno.land/p/nt/avl/v0` at **8 sites**, and calls the **two-value** `Get` at 15+ sites.
4. topaz-1's `p/nt/avl/v0.Get` is **single-value** ⇒ **AddPackage type-check failure.**
5. The branch-form guard (`projects/gnodaokit/deploy.sh:80-92`) only greps for *unsuffixed* `p/nt/*`.
   These imports **are** `/v0`-suffixed ⇒ it logs **`"OK for topaz-1"`** and proceeds.

**⇒ A false green from the exact gate designed to catch source-form mismatch.** It fails closed
on-chain (nothing wrong lands), but it burns a multisig ceremony on an opaque error.

**⇒ PR #65 is a hard ceremony prerequisite, not polish.** Without it gnodaokit cannot be published at all.

There is also **no source-provenance gate**: nothing verifies *which commit* of gnodaokit is about to
be published immutably. Every other risk here is gated; this one is not.

### P0-F · `topaz-1` is unclassified in the memba dependency preflight

`projects/memba/deploy.sh:120-136` branches on chain id: `test11`, `test-13`, `IS_PRODUCTION` →
fail-closed, **else** → `PROFILE_DEP="gno.land/r/samcrew/_deps/demo/profile"`.

topaz-1 is none of the first three (`production=false`, it uses `enforce_fund_safety=true`) → it falls
to the **else** and demands `r/samcrew/_deps/demo/profile`. But `projects/deps/deploy.sh:81` publishes
`r/samcrew/deps/demo/profile` — **no underscore** (interrealm-v2 rejects `_`-prefixed segments). The
path **can never exist**. Meanwhile `r/demo/profile` **is** in genesis (verified) — the correct
classification is the `test-13` form.

**Root cause is sharper than "add a branch":** the fail-closed classification guard keys on
`IS_PRODUCTION` **alone**, while every other enforce-lane gate in the codebase uses
`IS_PRODUCTION || ENFORCE_FUND_SAFETY` (cf. `_ceremony_enforced()`, `preflight.sh:97`). The
`enforce_fund_safety` lane added by #120 slips past it. **Fix the predicate, not just the branch.**

**Same bug, worse:** `samcrew-verify.sh:126-136` has the identical `_deps` else-branch and **no
fail-closed branch at all**.

### P1 · The gnodaokit ↔ memba_dao seam is dark on **both** ends

- gnodaokit's own CI: **red since 2025-11-12** ⇒ no signal.
- `memba_dao` — the **only** realm coupling to gnodaokit — sits in the deployer's
  `continue-on-error: true` INFO block ⇒ **compiled by no gating leg** (CHANGELOG.md:25 confirms).

We are about to publish immutably across an interface that **neither side tests**.

The infrastructure to fix this already exists: the `p0-fund-guard-gate` job builds gno at
`fc4052651` and runs gated legs with vendored deps. It just isn't wired for `memba_dao` — because
that needs the gnodaokit fork source, which is stuck in PR #65. **Merging #65 unblocks CI coverage
of the seam.**

### P1 · No test14/topaz ceremony driver
`samcrew-ceremony.sh` **hard-refuses any network but `test13`**. There is no resumable-state
equivalent of `.ceremony/test13.state` for the topaz sitting.

### P2 · Latent: non-blocking probe is wired as blocking
`preflight_ceremony.sh:369` wires `ceremony_probe_namereg_price || errors=$((errors+1))`, but the probe
is documented (lines 33-35, 203-204) as informational and **always returns 0** — precisely because
*"refusing a deploy over a changed render string would be a false-positive footgun."* Harmless today;
one future edit turns an explicitly-non-blocking probe into a ceremony blocker.

---

## 4. Expert cross-check — contradictions found and resolved

The whole point of running fresh reviewers was to catch each other. Three conflicts surfaced. I
adjudicated each **by reading the code myself**:

| # | Conflict | Resolution |
|---|---|---|
| 1 | Is the avl equivalence suite missing? (pressure-test **B1**) | **RESOLVED — it EXISTS.** `deps/avl/equivalence_test.gno`, 213 lines, 3 tests, written to spec §3.2, landed in deployer #121 **after** the pressure-test doc. Paired with a CI byte-identity guard vs upstream `f3d5a5d13`. Equivalence is proven **by construction** (byte-identity) plus a contract pin run at both VM refs — arguably stronger than a fuzz differential. **B1 is CLOSED.** |
| 2 | Does `Core.Execute` lack a re-entrancy guard? (pressure-test **B3**) | **RESOLVED — it is ALREADY GUARDED.** `daokit.gno:78` panics unless status is `Open`; `:86` `UpdateStatus()` moves it to `Passed` **before** the handler runs at `:91`. Re-entry hits `:78` and panics. **B3 is FALSE; old plan task T-5 is a non-task.** |
| 3 | Caller identity: empty-string vs tx.origin | **NOT RESOLVED — flagged as an open experiment (§2 P0-A).** Both agree the defect is real and #66 doesn't fix it; they disagree on mechanism. Needs a tie-break run before the fix is written. |

**This is why the cross-check was worth it:** two standing "BLOCKING" items in the current plan are
actually closed, and one new CRITICAL is open that no plan document mentions.

---

## 5. Corrections to the standing plan

`NEXT_SESSION_PROMPT_mainnet_cut_gate_building_2026-07-17.md` (T-1…T-7) is materially stale:

| Task | Status now |
|---|---|
| T-1 avl equivalence/fuzz suite | ✅ **DONE** (deployer #121) — plan says missing |
| T-2 uassert-free custody oracle | ✅ **DONE** (deployer #119) |
| T-3 full-realm-set lint gate | ✅ **DONE** (#120/#122/#123, pinned `fc4052651`) |
| T-4 `deploy.sh` daokit dep-check | ⚠️ **PRESCRIPTION OBSOLETE** — it said "verify `daokit_v2`", but #65 stripped the `/v2` rename, so `PKG_SUFFIX=""` is now correct. Applying it as written would **introduce** a bug. The *real* bug is P0-F (profile path + guard predicate). |
| T-5 `Core.Execute` re-entrancy guard | ✅ **NON-TASK** — already guarded (§4 #2) |
| T-6 #960 Topaz rewrite | ⬜ open (Memba frontend, out of this session's scope) |
| T-7 extend `MAINNET_READINESS.md` | ⬜ open — all 10 §4 checkboxes still unchecked |

Also stale: `chain_id "dev"` → `topaz-1`; samourai RPC primary → official RPC primary.

---

## 6. Merge decision — **I merged nothing, and nothing was eligible**

You authorized autonomous merges under a strict gate. Applying it honestly:

| Repo | Open PRs | Verdict |
|---|---|---|
| **samcrew-deployer** | **0** | Nothing to merge. main green at #125. |
| **Memba** | **0** | Nothing to merge. |
| **katana** | **0** | Nothing to merge. |
| **gnodaokit** | 6 (3 live, 3 stale drafts) | **None eligible** — see below |

Gate-by-gate for the three live gnodaokit PRs:

| Gate | #65 | #66 | #64 |
|---|---|---|---|
| Deep + CTO review | ✅ done this session | ✅ done | ⚠️ **zero reviews ever** |
| Tests pass | ❌ | ❌ | ❌ |
| Up to date / no conflicts | ✅ | ✅ | ✅ |
| **CI all green + verified** | ❌ **RED** | ❌ **RED** | ❌ **RED** |
| **Peer reviewed clean** | ❌ **open `CHANGES_REQUESTED`** | ❌ **no reviews at all** | ❌ none |
| No live contention | ❌ **David committed 01:04 today** | ❌ same | — |

**Every one fails on multiple gates.** I did not merge, and I did not use `--admin` to bypass.

Two things worth your attention:
- **gnodaokit `main` has no branch protection.** Red CI does **not** block a merge there — discipline
  is the only guard. I hold admin on that repo.
- **The CI gate is currently unsatisfiable**, not merely unmet. That is a deadlock to break
  deliberately (§7 Lane 1), not a reason to waive the gate.

---

## 7. Proposed plan

Four lanes. Lane 1 gates everything else. **Nothing here deploys on-chain** — the ceremony stays an
owner-attended event.

### Lane 1 — Make gnodaokit CI green *(unblocks every other gnodaokit action)*

> **⚠️ This lane was rewritten after a fourth expert reproduced the failure locally and proved a fix
> end-to-end. The obvious fix — "bump the pin" — is REFUTED. Both PR reviewers recommended it, and so
> did my first draft. It does not work.**

**Corrected root cause.** `gno lint`/`gno test` derive their dep source from the *pkgpath domain*
(`rpcpkgfetcher.go:60`: `https://rpc.%s:443`), and `rpc.gno.land` CNAMEs to **betanet — a mutable
testnet**. So a hermetically-pinned compiler is fed by a live, unversioned dependency source. Any
upstream redeploy retroactively breaks every branch, including already-merged history.

There are **two independent failure classes**:
1. **Syntax skew** — the chain serves *pre*-interrealm-v2 sources (`txlink` calls the relocated
   `CurrentRealm`; `uassert/v0` uses old `cross` marker-arg syntax). The deps are **older** than the pin.
2. **Packages simply gone** — `r/demo/profile` returns a server-side `package … is not available`.
   The failed fetch leaves the cache dir uncreated, which resurfaces as the *misleading*
   `open …/p/onbloc/json: no such file or directory`. That ENOENT is a **masked download failure**,
   not cache corruption.

**Also corrected:** `GNOVERSION` is **not** uniform across the repo —
`main` and #62 = `4e80c37e` · #63 = `5111dbc2` · #64/#65/#66 = `2c7f1abe`.

| Option | Fixes class 1? | Fixes class 2? | Verdict |
|---|---|---|---|
| (a) Bump pin → `fc4052651` | **No** — moves *further* from the chain's older sources | **No** — toolchain-independent | ❌ **fixes nothing on its own** (`fc4052651` still has no `chain/runtime.CurrentRealm`) |
| (c) Restrict lint/test scope | **No** | **No** | ❌ refuted at source — `pkg.Errors` is checked *before* `pkg.Match`, and lint attributes dep errors to the **first-party** package |
| (d) Point resolution at a chain RPC | only with a perfectly-matched chain | only if it hosts every pkg | ❌ **not reachable** — no such flag exists; `load.go` hardcodes `nil` fetcher overrides |
| **(b) Vendor the dep closure** | **Yes** | **Yes** | ✅ **the only option that closes all four error classes — it removes the network from the build** |

- **1a. Land vendoring first, alone, on top of `main`.** Pure-additive: one new `vendored/gno.land/…`
  directory (20 packages, 86 files, 860 KB) populated from `examples/` **at the pinned GNOVERSION**, so
  deps are version-matched to the compiler *by construction*. **Zero code and zero Makefile changes.**
  `load.go:139` short-circuits the fetch on any workspace-local match.
  **Placement at repo root — not under `gno/` — is load-bearing** (tested both ways: under `gno/` the
  vendored packages get linted and tested too).
  **Verified end-to-end on PR #64's tree with the network fully unavailable:**
  `lint exit 0` (7/7 clean) · `test exit 0` (6 ok, 1 no-test-files, 0 FAIL) · `gno fmt` zero diff
  (the no-diff gate passes) · no `gno: downloading` lines at all.
- **1b.** Then rebase #64/#65/#66 onto it, so their real code can finally be reviewed against a working
  signal.
- **1c.** A `GNOVERSION` bump becomes a **separate, now-testable decision** rather than a prerequisite.
  (`examples/` at `fc4052651` also carries every needed package, so vendoring composes with a later bump.)
- **1d.** Add a CI guard asserting `gno: downloading` never appears in build output, so hermeticity
  can't silently regress.

**Control experiment already run (no push needed):** PR #62 pins `4e80c37e` — *byte-identical to
`main`'s* toolchain — and still fails; the only package that passes is `realmid`, the one with **zero
chain-hosted deps**. That is as close to a `main` control as exists. `main`'s green badge is a
**2025-11-12 fossil**; it has not run in 8 months.

**Incidental (fix deliberately, not incidentally):** `make gno-mod-tidy` is a **silent no-op** — it
does `find gno -name gno.mod`, but the repo uses `gnomod.toml`, so it matches 0 files. Repairing it may
immediately produce a diff and fail the no-diff gate.

### Lane 2 — Make the fork freeze-ready *(the substance)*
Each its own TDD PR, on top of #66:
- **2a. Tie-break experiment** for P0-A (empty-string vs tx.origin). Run the adversarial realms from
  `gno-agent-workspace : reviews/gnodaokit/65-topaz-v2-rename/tests/`. **Prerequisite to 2b.**
- **2b. P0-A + P0-B fix** — `CallerIDFn(rlm realm)`, crossing `Propose`/`Vote`, a `realmid.FromRealm`
  helper, and `Execute` carrying an **address** rather than a realm capability.
  ⚠️ **Interface-breaking. This is the now-or-never item** — after an immutable publish it costs a
  new versioned path.
- **2c. P0-C** `ufmt` arity + regression test *(one line; highest value-to-risk in the whole audit)*.
- **2d. P0-D** `RemoveMember` minimum-member guard + test *(three lines)*.
- **2e. Complete #66** — `rlm.IsCurrent()` in `New`; correct the README id-derivation; `AddRole("")`
  guard; unexport/`rotree`-wrap `MembersStore.Members`/`Roles`; honest PR description.
- **2f. Multi-realm test harness** — nothing in the suite exercises a second realm today, which is
  exactly why both defects survived. Without this, 2b cannot be verified.
- **2g. Triage issue #15** (resolve or explicitly refute) and **issue #13** (action-interface
  description spoofing — an API-shape footgun, so *before freeze or never*).

### Lane 3 — Deployer ceremony hardening
- **3a. P0-F** — classify `topaz-1` (`r/demo/profile`, suffix `""`) **and** widen the fail-closed
  predicate to `IS_PRODUCTION || ENFORCE_FUND_SAFETY`. Same fix in `samcrew-verify.sh`.
- **3b. P0-E** — make the gnodaokit branch-form guard chain-aware (on topaz-1 require
  `p/samcrew/avl`, reject stdlib avl), and add a **source-provenance gate**: pin/echo the gnodaokit
  commit being published and refuse an unexpected one.
- **3c. P1** — wire `memba_dao` into a gating CI leg once #65 lands (vendor the fork the way
  `deps/avl` is vendored). Closes the dark seam.
- **3d. P1** — a test14/topaz ceremony driver with resumable state.
- **3e. P2** — unwire the non-blocking namereg probe from the error counter.
- **3f.** Correct the five stale doc sites in §1; tick off the `MAINNET_READINESS.md` §4 items that
  are now verifiably true.

### Lane 4 — Backlog hygiene *(cheap, do last)*
- **Close #63** — it proposes `5111dbc2` (2026-05-11), **older** than the `2c7f1abe` the live stack
  already carries; its root cause (upstream #5357) is already an ancestor. Nothing to salvage.
- **Close #25** — 11 months stale, conflicting, hardcodes a private Pinata gateway that gnoweb won't
  authorize. Thank the contributor; keep issue **#22** to preserve the intent.
- **Close #62 after harvesting** P0-C and P0-D. Do **not** rebase it wholesale: it is 283 lines of
  **unreviewed, untested** governance logic (its own test plan is nine unchecked boxes) and several
  parts are policy decisions that become permanent (hardcoded 30-day TTL, `MaxOpenProposals = 50`,
  supermajority semantics). Its headline "critical" — infinite recursion in `crossingDAO.Render` — is
  already resolved: the v2 port **deleted `crossing.gno`**. *(Rebase itself is easy — `merge-tree`
  shows only 2 of 10 files conflict — the risk is the content, not the merge.)*
- **#64 vs #65** — they share `15dbc83` and do **not** conflict. #64's unique content is a *newer*
  Makefile pin (`ba9da8eb`) plus READMEs. **Decide deliberately which pin the frozen release builds
  against** rather than letting merge order pick it. (Lane 1b likely supersedes both.)
- **Triage the `proxy-patterns` branch** — carries `fix: remove unsafe Transfer func` and
  `fix: protect object extension` that never landed anywhere. ~30 min to confirm they touch only
  `gno/r/` demos and not frozen `p/` code.
- Delete ~10 stale merged/orphan branches.

### Merge order
`Lane 1 (CI green)` → `#65` → `#66` → `2c` + `2d` → `2b` + `2e` + `2f` → **freeze** → ceremony.

**Merge mechanics for the stack:** #66 stacks on #65. **Squash-merging #65 orphans #66's base** and
makes it re-propose all of #65's changes. Use a **merge commit or rebase** for #65, or immediately
`git rebase --onto main 60c4bf0 fix/realm-identity-hardening` and force-push #66.

---

## 8. Owner decisions I need from you

1. **Freeze-readiness call (the big one).** Fix P0-A/P0-B before publishing (interface-breaking, adds
   time), or publish now and accept that repairing an authorization defect later costs a **new
   versioned path**? My recommendation: **fix first.** These are exactly the defects an immutable
   publish must not lock in, and gno's own audit harness prescribes the fix.
2. **Who owns the interface change?** PR #66 is David's and he explicitly declined the interface-
   breaking scope. This needs coordination with him, not a unilateral PR from me.
3. **Merge authority under a red-CI repo.** gnodaokit `main` has no branch protection. Do you want me
   to keep treating "CI green" as hard-blocking there (my default, and what I did), or to define a
   documented exception once Lane 1a *proves* the failure is environmental?
4. **Ceremony sequencing** — do we hold the ceremony for Lane 2, or run a partial ceremony (deps/avl
   + non-daokit realms) now and publish gnodaokit + `memba_dao` after the fix?
5. **`#64` pin decision** (Lane 4) — which gno ref the frozen release is built against.

---

## 9. What I did **not** do

- **No code, no commits, no pushes, no merges, no deploys.** Read-only throughout, per your instruction.
- Did not use `--admin` anywhere, despite holding it on gnodaokit.
- Did not edit any file in `gnodaokit` or `samcrew-deployer`. The only file I wrote is this document.
- Did not touch the four planning docs owned by the parallel Topaz session.
- **Live contention noted:** David committed to gnodaokit at 20:34 yesterday and **01:04 today**
  (`gno/p/basedao/*`). Coordinate before any Lane 2 work. samcrew-deployer has been quiet since
  Jul-18 14:11; Memba since Jul-18. No deployer/Memba contention.

### Repos pulled this session
All `Gno/*` repos fetched. `Memba` is detached (its `main` is checked out in
`Memba-worktrees/barricade-deepening`, clean and level with origin). `gno-agent-workspace` and
`gno-docs` have **diverged from origin** (426 behind / 392 ahead — an upstream force-push); they were
left untouched pending your call, since resolving them rewrites local history.

---

## Appendix — evidence
Full query-by-query evidence, including every command and its raw output, is in the session scratchpad
(`verified-evidence.md`). The external review that blocks #65 is at
`samouraiworld/gno-agent-workspace : reviews/gnodaokit/65-topaz-v2-rename/2-60c4bf0/review_claude-fable-5.md`,
with runnable adversarial realms alongside it in `.../tests/`.
