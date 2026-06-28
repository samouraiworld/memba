# Client-Side Deploy Regression — `runtime.PreviousRealm` Undefined on test13

**Audit + Implementation Plan Proposal**
Date: 2026-06-27 · Owner: CTO · Status: AWAITING APPROVAL (no code written yet)

---

## 1. Symptom

User-initiated **Create-a-DAO** ("Paris Surf Club") fails at the Adena signing step with a
**compile error**, before broadcast:

```
ERROR: gno.land/r/g1747…x59c/paris_surf_club/paris_surf_club.gno:475:20:
       undefined: runtime.PreviousRealm
```

Line 475 is `caller := runtime.PreviousRealm().Address()` inside `Propose()`. The transaction
never reaches the chain — `m.addpkg` type-checks the package on the validator and rejects it.

## 2. Root Cause (confirmed against deployed source)

test13's gno (interrealm-v2, live since 2026-06-16) **relocated the realm-introspection
symbols** out of `chain/runtime` into `chain/runtime/unsafe`:

| Symbol | Old (pre-upgrade) | test13 NOW |
|---|---|---|
| `PreviousRealm()` | `chain/runtime` | **`chain/runtime/unsafe`** |
| `CurrentRealm()` | `chain/runtime` | **`chain/runtime/unsafe`** |
| `OriginCaller()` | `chain/runtime` | **`chain/runtime/unsafe`** |
| `OriginSend()` | (various) | **`chain/runtime/unsafe`** |
| `ChainHeight()` | `chain/runtime` | `chain/runtime` *(unchanged)* |

**Proof — two generations of realms in `samcrew-deployer` side by side:**

- **Migrated `_v2`/`_v1` realms (compile + deployed on test13):** import `chain/runtime/unsafe`,
  call `unsafe.PreviousRealm()`, `unsafe.CurrentRealm()`, `unsafe.OriginSend()`, and keep
  `runtime.ChainHeight()`. e.g. `memba_dao_candidature_v2`, `escrow_v2`, `agent_registry`,
  `gnobuilders_badges_v2`, `memba_reviews_v1`, `tokenfactory_v2`, `memba_nft_market_v3_1`.
- **Old un-suffixed realms (stale, would NOT compile today):** still call `runtime.PreviousRealm()` —
  `escrow/`, `gnobuilders_badges/`, `memba_dao_candidature/`, `memba_dao_channels/`, `nft_market/`.

The server-side deployer realms were migrated to the new stdlib layout. **The frontend
code-generation templates were never migrated.** Every client-side deploy still emits
`runtime.PreviousRealm()`.

> This is a **regression introduced by the test13 gno upgrade**, not a new code defect. These
> templates worked on pre-interrealm-v2 chains; the upgrade silently broke all of them.

## 3. Blast Radius — ALL client deploy flows are broken, not just DAO

Every realm template under `frontend/src/lib/*Template.ts` emits the dead symbol. Confirmed via
source-only inventory (excludes tests):

| Template | `PreviousRealm` | `CurrentRealm` | `ChainHeight` | `banker.OriginSend` | User-facing flow |
|---|---:|---:|---:|---:|---|
| `daoTemplate.ts` | 9 | – | 4 | – | **Create a DAO** |
| `channelTemplate.ts` | 9 | – | 4 | – | DAO channels |
| `agentTemplate.ts` | 7 | 1 | 2 | 1 | Agent registry |
| `escrowTemplate.ts` | 7 | 3 | 3 | 1 | Escrow |
| `nftTemplate.ts` | 5 | – | – | 1 | NFT collection |
| `grc1155Template.ts` | 5 | – | – | – | GRC1155 |
| `boardTemplate.ts` | 4 | – | – | – | Board |
| `candidatureTemplate.ts` | 2 | – | – | – | Candidature |

There is **no other emission site** in the frontend (grep over `src/**/*.ts{,x}` is clean outside
these 8 files). Five `*.test.ts` snapshot suites assert the broken string and will need updating:
`agentTemplate`, `boardTemplate`, `daoTemplate`, `escrowTemplate`, `nftTemplate`.

## 4. Why our tests didn't catch it (the systemic gap)

The template `*.test.ts` suites **string-match generated output** — they never compile the gno
against test13's actual stdlib. So a stdlib relocation on-chain is invisible to CI. The deployer
repo *does* have a gno/gnodev compile path (which is why `_v2` realms were migrated); the frontend
has nothing equivalent. **This is the real defect class** — "generated code that is never
type-checked against the target chain."

## 5. The Fix

### 5.1 Migration rule (mirror proven-deployed `_v2` realms exactly)

- `runtime.PreviousRealm()` → `unsafe.PreviousRealm()`
- `runtime.CurrentRealm()`  → `unsafe.CurrentRealm()`
- `runtime.ChainHeight()`   → **unchanged** (stays `chain/runtime`)
- Import edits, per template:
  - **Uses `ChainHeight`** (dao, channel, agent, escrow): **keep** `chain/runtime` **and add**
    `chain/runtime/unsafe`.
  - **No `ChainHeight`** (board, candidature, grc1155, nft): **replace** `chain/runtime` with
    `chain/runtime/unsafe` (leaving it imported-and-unused is a hard compile error in gno).

### 5.2 ⚠️ Must-verify, do NOT hand-guess: `OriginSend`

`agentTemplate`/`escrowTemplate`/`nftTemplate` call `banker.OriginSend()` (from `chain/banker`),
but deployed `escrow_v2` uses `unsafe.OriginSend()`. We do **not** assume `banker.OriginSend`
still compiles on test13 — the compiler only reports the *first* undefined symbol, so a second
breakage could be hiding behind `PreviousRealm`. **The Phase-0 compile gate (below) resolves this
empirically** instead of by guesswork.

### 5.3 Central touch-point

`frontend/src/lib/templates/prologue.ts` — the `GnoImport` union type does not even include
`"chain/runtime/unsafe"`. Add it, fix the doc-comment on line 20, then update each template's
import list + symbol calls.

## 6. "Smarter CTO" framing — fix the bug AND close the gap

A one-line find/replace ships in 30 minutes and unbricks deploys. But the same class of bug will
recur on the **next** chain upgrade (test14, mainnet) unless we add a type-check gate. The proposal
below does both, smallest-blast-radius first.

### Architectural note — `unsafe.*` vs crossing semantics
The templates already declare exported functions with the crossing signature (`func Propose(cur
realm, …)`). The canonical interrealm pattern is crossing-functions + safe `PreviousRealm`. The
deployed `_v2` realms instead use the pragmatic `chain/runtime/unsafe` shim. **For this fix we
mirror the deployed `_v2` realms** (proven to compile *and* run on test13) — adopting full crossing
semantics is a separate, larger refactor and is explicitly out of scope here. Flagged for a future
ADR.

---

## 7. Phased Plan

### Phase 0 — Compile gate (build the safety net FIRST) · gate **G0**
- Add a CI/test harness that takes each template's generated output and **type-checks it against a
  test13-matched gno toolchain** (gnodev or pinned `gno` stdlib). One spec per template.
- This *reproduces the bug red* before we fix anything (TDD discipline) and becomes the permanent
  regression guard.
- **G0 exit:** harness runs in CI, currently failing on all 8 templates for the expected symbol(s).

> If a full gno toolchain in frontend CI is too heavy, fallback: a thin gnodev/RPC "dry-run addpkg"
> smoke test in the deployer repo that imports each generated template. Decide in Phase 0; do not
> skip the gate.

### Phase 1 — Migrate the 4 simple templates · gate **G1**
- `boardTemplate`, `candidatureTemplate`, `grc1155Template`, `nftTemplate` (PreviousRealm-only,
  plus nft's OriginSend).
- Update source + `.test.ts` snapshots. **G1 exit:** Phase-0 gate green for these 4.

### Phase 2 — Migrate the 4 `ChainHeight`/`CurrentRealm` templates · gate **G2**
- `daoTemplate`, `channelTemplate`, `agentTemplate`, `escrowTemplate` (dual import, CurrentRealm,
  OriginSend resolution from §5.2). **G2 exit:** Phase-0 gate green for all 8.

### Phase 3 — Live verification on test13 · gate **G3**
- Real Adena deploy of **DAO** (repro case) + **one money-path realm** (escrow) on test13 from a
  funded test account. Confirm: compiles, broadcasts, renders, and a follow-up call
  (`Propose`/`Vote`) executes (validates the `cur realm` crossing path end-to-end, not just
  compilation). **G3 exit:** on-chain success screenshot + realm path recorded.

### Phase 4 (optional, fast-follow) — Hygiene
- Delete the 5 stale un-suffixed deployer realms (or mark deprecated) so they can't mislead future
  audits. Add an ADR for the `unsafe.*`-vs-crossing decision.

---

## 8. Risk & Rollout

- **Severity:** P0 — *every* client-side realm deploy is bricked on test13 (DAO, NFT, escrow,
  channels, agent, board, candidature, grc1155). High user-visible (the screenshotted failure).
- **Change risk:** LOW — string/import substitution mirroring already-deployed, already-proven code.
- **Blast containment:** Phase-0 gate makes the fix verifiable *before* any user sees it; no schema,
  no on-chain state, no migration of existing realms.
- **Rollback:** trivial revert; templates are pure functions with no persisted state.
- **Branch/PR:** feature branch `fix/client-deploy-runtime-unsafe-api`, standard PR, **no merge
  without explicit approval** (per house rule). Do not deploy frontend via the GitHub Action — prod
  is Netlify-native.

## 9. Open Decisions for Approval

1. **Phase-0 gate mechanism:** in-frontend gno toolchain compile vs. deployer-side gnodev dry-run
   addpkg. (Recommend: deployer-side gnodev smoke test — closest to real validator type-check, and
   the deployer already has the toolchain.)
2. **Scope of this PR:** fix-only (Phases 1–3) vs. fix + hygiene (include Phase 4).
3. **OriginSend:** accept the Phase-0 gate's empirical answer (recommended) vs. pre-emptively switch
   all `banker.OriginSend()` → `unsafe.OriginSend()` to match `escrow_v2` now.

---

## 10. Implementation Log (2026-06-27) — DONE, gate proved the bug was bigger

Branch: `fix/client-deploy-runtime-unsafe-api` (Memba). Templates present on `main` = **6**
(`nft`/`grc1155` live on the unmerged NFT branch — same fix, tracked separately).

**The Phase-0 compile gate immediately justified itself.** Running the real `gno` type-checker
(`gno lint`, the same engine the validator uses) on generated output surfaced **two breakages a
hand find/replace would have missed** — the compiler only reports the *first* undefined symbol, so
these were hiding behind `runtime.PreviousRealm`:

- `banker.OriginSend()` is **also dead** → `unsafe.OriginSend()`.
- `banker.NewBanker(type)` now requires a second arg → `banker.NewBanker(type, cur)`.

**Full migration applied to all 6 templates** (mirrors deployed `_v2` realms exactly):

| Symbol | → | Templates touched |
|---|---|---|
| `runtime.PreviousRealm()` | `unsafe.PreviousRealm()` | all 6 |
| `runtime.CurrentRealm()` | `unsafe.CurrentRealm()` | agent, escrow |
| `banker.OriginSend()` | `unsafe.OriginSend()` | agent, escrow |
| `banker.NewBanker(t)` | `banker.NewBanker(t, cur)` | agent, escrow |
| `runtime.ChainHeight()` | unchanged | dao, channel, agent, escrow |
| import `chain/runtime/unsafe` | added | all 6 (replaced bare `chain/runtime` in board+candidature; kept alongside it where `ChainHeight` is used) |

**Verification:**
- Compile gate `templates.compile.test.ts`: **RED before → GREEN after** (all 6 type-check clean
  against the real stdlib; `gate_dao.gno:202: undefined: runtime.PreviousRealm` was the same root
  cause as the user's line 475).
- Full template + prologue suites: **300/300 pass** (15 stale snapshot assertions that had
  *enshrined* the broken API were corrected to the proven one).
- `prologue.ts` `GnoImport` type + doc-comment corrected (`chain/runtime/unsafe` added).

**Remaining (Bash classifier permitting):** `npm run build` typecheck · deployer
`make verify-client-templates` wiring · Phase-4 hygiene (deprecate 5 stale un-suffixed realms +
ADR) · live test13 deploy verification (G3) · port the same fix to the `nft`/`grc1155` templates on
the NFT branch.

