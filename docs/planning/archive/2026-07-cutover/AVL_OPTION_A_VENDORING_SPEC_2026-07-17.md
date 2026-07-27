# avl Option-A Vendoring Spec — the master mainnet-compat fix
### Phase-5 deliverable · vendored `p/samcrew/avl` with ZERO call-site change · 2026-07-17

> **The problem.** gno master (#5314/#5644) changed the stdlib `gno.land/p/nt/avl/v0` `Get` from two-value `(value any, exists bool)` to single `any`. Memba realms call the **two-value** form at **~407 non-test sites across 37 realm dirs**, `avl` is **unvendored**, and #5891/#5893 make the type-check **consensus state** → on any post-#5314 mainnet the realms are **deterministically rejected at `AddPackage`**. The immutable `memba_collections` ledger and the forked `grc721` both import it, so this **paces the entire cut**.
>
> **Option A (RECOMMENDED — this spec).** Vendor the **whole** avl module under a samcrew path, **keeping the two-value `Get` signature frozen**, so every realm import path changes but **not a single call site** does. The stdlib change only affected `p/nt/avl/v0`; a samcrew-owned copy is immune. Minimal, auditable diff on the immutable realm.
> **Option B (post-cut cleanup).** Mechanically migrate all ~407 sites to single-value `Get` + `Has()`. Larger blast radius on the append-only ledger, and the nil-vs-zero trap risk (see custody-oracle matrix). Defer to after the cut.

---

## 1. The vendored module
- **Path:** `gno.land/p/samcrew/avl` (or the samcrew namespace the ceremony owns). **Package name stays `avl`.**
- **Source:** copy the **entire** module from the **pinned pre-avl ref** — `tree.gno`, `node.gno`, `pager.gno`, `rotree.gno` (+ any siblings; `tokenfactory_v2` uses `pager`/`rotree`). *Confirm the exact file list against the pinned ref at author time.*
- **Freeze the API:** keep **every exported identifier byte-identical**, and critically keep **`func (tree *Tree) Get(key string) (value any, exists bool)`** — the two-value form. This is the whole point: importing realms compile unchanged.
- Copy the module's own `*_test.gno` too (so the vendored package is self-tested), plus add the equivalence/fuzz suite below.

## 2. Import repoint (path-only, zero call-site change)
Repoint `import "gno.land/p/nt/avl/v0"` → `import "gno.land/p/samcrew/avl"` in:
- **The Memba realm set** (~407 sites, 37 dirs): `memba_collections`, `memba_nft_market_v3_2`, `memba_market_config`, `memba_nft_v2`, the forked `grc721`, `escrow_v4`, `agent_registry_v2`, `memba_token_otc_v2`, `tokenfactory_v2`, `memba_reviews_core_v1` (+ wrapper), `memba_dao_candidature_v3`, `memba_dao_channels_v2`, etc.
- **The forked gnodaokit** (`p/samcrew/basedao` + `daocond` + `daokit`, ~18 internal sites) — `memba_dao`'s dep is **quarantined** on master, so it must be forked AND repointed onto `p/samcrew/avl` in lockstep.
- **The forked `grc721`.**
> Because the API is identical, this is a **mechanical `sed`-scale path substitution** — no logic edits. Every `v, ok := t.Get(...)` stays exactly as-is. That is the safety of Option A.

## 3. Verification gates (BEFORE it's trusted on the immutable ledger)
1. **Compiles under the pinned mainnet-candidate gnovm.** The old avl source must survive the A6 type-check strictenings (#5739 embedded-type identity, #5920 blank `_` decls, #5932 cross-pkg method qualification). If any is rejected, apply the **minimal** fix that **preserves the two-value `Get` signature** — never change the API.
2. **Equivalence + fuzz vs the stdlib avl** (insert / get / remove / iterate parity, randomized): the vendored fork must behave **identically** to the current stdlib avl. It runs the **immutable `memba_collections`**, so a divergence is **permanent**. This is a hard leg of the Phase-1.5 mainnet-parity CI.
3. **Custody oracles green at BOTH refs** (see the custody-oracle matrix): the realm suites, unchanged, pass at the pre-avl ref AND at the pinned mainnet ref after the repoint — proving the path swap introduced zero behavioral drift.
4. **Deploy-gas (#5892):** the vendored module's source bytes are charged **up front** at `AddPackage` (1250/source-byte) — budget it in the ceremony gas-wanted; strip `_test.gno` from the deployed mempackage.

## 4. Publish ordering (into the ceremony runbook)
1. **`p/samcrew/avl` is published on-chain + type-checked FIRST** — before any dependent.
2. Then the forked `gnodaokit` packages (basedao → daocond → daokit) and forked `grc721`.
3. Then the realms in dependency order (grc721 → memba_collections → market_config/core → nft_market_v3_2 → tokenfactory_v2 → the daokit closure → memba_dao → consumers).
> A dependent published before `p/samcrew/avl` exists on-chain fails its own `AddPackage`. This ordering is a hard row in `MAINNET_READINESS.md`.

## 5. CI wiring
- The **non-gating "compile at gno head" leg** (Phase 5) builds the full closure against the pinned ref with `p/samcrew/avl` vendored into `examples/` — lets each realm verify incrementally **without** flipping the shared `p0-fund-guard-gate` `GNO_REF`.
- The **equivalence/fuzz leg** gates the vendored fork.
- The **atomic `GNO_REF` flag-day** (Phase 9) flips only after **every** gated realm is migrated + green on the non-gating leg — one named owner, revertible in one commit.

## 6. Watch-items / risks
- **gnodaokit is quarantined on master** → the fork is **permanent maintenance debt**: add a canary leg that recompiles the fork against gno master at each bump, and budget a re-pin/upstream-merge story.
- **Two-value `Get` on an unvendored transitive dep**: audit that no realm reaches the stdlib `p/nt/avl/v0` transitively after the repoint (e.g. via an un-forked package) — a single missed transitive import re-introduces the break.
- **Freeze coupling:** the vendored avl + the API-surface freeze + the custody oracles all land in the **same coordinated cut**; the avl repoint must not precede the freeze sign-off.

> **Status:** design spec from the audits. Execution (copy the module, `sed` the imports, run the verification legs) needs the gno toolchain + a `samcrew-deployer` worktree (source-only, no auto-deploy); the migration is gated on the owner's **VM-pin** (which fixes the "pinned mainnet-candidate ref" the whole spec references). No code written here.

---
### The source-only cut-prep design is now complete
Three implementer-ready artifacts define the whole Phase-5→7 track:
1. **[avl Option-A vendoring]** (this doc) — the master compat fix, zero call-site change.
2. **[Custody-oracle test matrix]** — the pre-migration regression net (green-at-both-refs gate).
3. **[Immutable API-surface freeze]** — the per-realm must-land-in-the-cut enumeration + sign-off gate.

Everything past design is **execution**, gated only on **(a) gno-toolchain/Bash availability** and **(b) the owner's VM-pin.**
