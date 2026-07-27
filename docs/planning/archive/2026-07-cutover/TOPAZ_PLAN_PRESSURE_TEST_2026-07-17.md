# Topaz Migration Plan — Independent Pressure-Test (2026-07-17)

**What this is:** a fresh 3-reviewer red-team of `MEMBA_TEST14_TOPAZ_MIGRATION_AAA_PLAN_2026-07-17.md` (+ its avl / custody-oracle / API-freeze companions), commissioned *after* the plan's own §10 (3 CTO reviews). This is a **review artifact, not a competing plan** — findings for the plan authors + owner to fold in. Reviewers verified against **live Topaz** (`rpc.topaz.samourai.live`) and **real compilation** (gno built @ `67a0bb333`, `gno lint` run), not the plan's prose. Full reports: `scratchpad/topaz-pressure-test/{protocol-verify,deploy-econ-verify,holistic-redteam}.md`.

## Consensus verdict: **APPROVE-WITH-CHANGES** (3/3)

The protocol/economic spine **holds and is now empirically grounded**. Residual risk is small in count but concentrated on the **immutable realms**, where a defect is permanent. The plan is not a rework — it needs a focused set of pre-freeze corrections.

## A. Empirically CONFIRMED (this de-risks the plan — several are de-riskers the plan doesn't state)

- **Option A works, lint-proven.** gno built @`67a0bb333`; `gno lint` on grc721 → 9 real "Get returns 1 value" errors; vendoring the two-value avl as `p/samcrew/avl` with an **imports-only repoint (zero call-site edits)** → **lint clean**.
- **The Topaz VM == master `f306ab6e7`.** The 3 commits over the merge-base are **gnogenesis/deploy tooling only — zero VM changes**. So the "mystery fork" framing is unwarranted; the target VM is a known master commit.
- **Fork-rename (Path B / Q13) is correct.** The genesis↔fork daokit/basedao ABI drift is real and total (verified vs live on-chain source): `NewActionHandler` arity (1 vs 2), `basedao.New` return arity (1 vs 2), `Config.PrivateVarName`/`SetImplemFn` absent in genesis, InstantExecute removed. **`memba_dao.gno` cannot compile against genesis basedao.** `realmid` absent from genesis (live `InvalidPackageError`); only `memba_dao` uses the closure in non-test code.
- **Storage deposits:** `storagePriceDefault="100ugnot"`, cap `600 GNOT` — LIVE. Charged on **realm-object state-growth delta** (`RealmStorageDiffs`), **not source bytes** (the source blob is *never* deposit-charged — fully decoupled, stronger than the plan's "0.27–2.23×"). `gnokey --simulate only` is sound.
- **Namereg model:** enforcement is **DARK today** (`r/sys/names.IsEnabled()=false`); `samcrew` is unregistered + **not self-registrable** (`RegisterUser` is controller-whitelist-gated); self-serve `Register` is **nym-locked** (`^nym-[a-z]{5,13}\d{3}$`). Genesis prereg is the clean path.

## B. BLOCKING before any immutable diff / the flag-day (new — missed by all 4 prior reviews)

1. **The pre-migration gate protects the wrong thing.** The custody-oracle matrix hunts dropped-`ok` branches + nil-vs-zero traps — both of which **Option A eliminates by construction** (zero call-site change). Meanwhile the *actual* Option-A risk (does the vendored avl behave identically under the Topaz VM?) has **no gate**: the **avl equivalence/fuzz suite doesn't exist** (§11.6 concedes out-of-scope), and the immutable `memba_collections` has **no gate-eligible oracle** (its tests use `uassert`, which can't preprocess @`67a0bb333`). → **Build the avl equivalence/fuzz suite + a `uassert`-free `memba_collections` oracle, and gate a full-realm-set `gno lint` @`67a0bb333` (with vendored avl in place), BEFORE any immutable diff or the flag-day.** (Converged by all 3 reviewers.)
2. **`deploy.sh` dep-check FALSE-PASSES against the genesis daokit.** `gnodaokit/deploy.sh` applies the `/v2` suffix only for test11, and `memba/deploy.sh`'s dependency preflight verifies the **base** daokit path — which genesis *satisfies*. So the preflight would green-light wiring `memba_dao` to the **wrong, ABI-incompatible genesis daokit** on an immutable path. → **Fix the preflight to verify the renamed `p/samcrew/daokit_v2` (+`realmid`) path.**
3. **`daokit.Core.Execute` has no re-entrancy guard** (genesis documents the gap + prescribes the fix). Don't *permanently* freeze `daokit/v2` with a known self-documented vuln. → **Add the (API-compatible) guard before the freeze.** Exposure is currently low (memba_dao registers only first-party handlers).
4. **Namereg authorization is an unrecoverable timing footgun.** Enforcement is off today, so a cut done now *looks* healthy — but when `Enable()` flips, **all `r/samcrew/*` deploys lock out** unless `samcrew` was genesis-preregistered first. Also `memba/deploy.sh` **fails-closed on chain_id `dev`** (Topaz's id) → deployer won't run as-is. → **Genesis prereg must precede enforcement; unblock the chain_id gate for Topaz.**

## C. CORRECTIONS to plan claims (over/under-scoped — tighten before execution)

- **"Genesis daokit's `RemoveMember` bug breaks Memba's live member surfaces" is FALSE.** The bug is real but corrupts only the per-role index; `quest_verify_phase3.go` + the frontend parser read the **primary** member store (genesis `render.gno`/`GetMembersJSON` iterate it). **Keep Path B on its real merits (self-upgrade `SetImplemFn`, re-entrancy, experimental-label), drop this rationale.**
- **`PreprocessGasPerByte=1250` is NOT in Topaz** (#5892 lands post-`f306ab6e7`; real per-byte costs are amino 3 / KV 14–17). The gas-budgeting *figure* is wrong for the Topaz ref — re-derive from `gnokey --simulate` at the pin. (Qualitative "strip `_test.gno`" point still stands.)
- **`_test.gno` stripping is already done on the production multisig path** (`lib/deploy.sh:217-221`) — the actual cut path; only single-sig lacks it.
- **#5739 does NOT reject grc721** (lint-proven) and **#5932 is not in Topaz** (post-pin) — remove from the at-cut re-validate scope.
- **`#960` is broken on Topaz 3 ways** (worse than "copy needs a rewrite"): it calls `r/sys/users.Register` (absent), sends `200000ugnot` (namereg requires `OriginSend==0` → panic), and uses arbitrary-username regex (needs nym-format). WS-C4 must rewrite the flow, not just the copy.

## D. Program-level should-fix (holistic)

- **The API-surface freeze is the real long-lead item, not the external asks** — it enumerates getters for an *undesigned* Phase-11 roadmap, and its "sibling-realm" escape hatch **cannot recover private-state getters** (verified: `GetProceeds`/`SaleSeedSealed` absent; `proceeds` is a private `*avl.Tree`). WS-F re-seed entrypoints aren't in the freeze at all.
- **`escrow_v4`** — a new *immutable* custody realm — doesn't exist yet, its oracle rows are unauthored, and it must be perfect first-try.
- **WS-F user re-seed is unrehearsable by construction** (source test13 sunsetting + rehearsal Topaz-`dev` resetting are both transient) and collides with the freeze's anti-fabrication seal; only Points has a re-seed path (migration realms). Get a **signed wipe-vs-reseed decision per non-Points surface** (NFT/DAO/badges).
- **"External asks are the critical path" inverts the risk** — irreversible engineering paired with an unbounded third-party testnet date; the "do it ONCE" thesis is oversold (Q12 concedes the ref isn't final → a different final mainnet ref risks a second immutable re-cut).
- **The fork is permanent with no exit for the immutable set** (Option B "cleanup" can't touch already-deployed immutable realms; no avl merge-back possible). Owner should **ratify the permanent-fork posture as strategy**, not absorb it as a line-item.
- **Lane-B is directed to import `p/samcrew/avl` before it exists** — resolve with an early published stub or a feed-authoring freeze, not a note in a doc.

## E. Single most-likely failure mode (reviewer consensus)

**A defect lands on an immutable realm and is found post-cut, because the gate meant to catch it doesn't cover the immutable realms** — via (a) the false-passing daokit preflight wiring `memba_dao` to genesis daokit, (b) a vendored-avl behavioral drift with no equivalence suite, or (c) a second non-avl type-check rejection surfacing at flag-day. All three are closed by the Section-B pre-freeze gates. Deferred namereg prereg is the runner-up (silent today, unrecoverable at `Enable()`).
