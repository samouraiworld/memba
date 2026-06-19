# NFT Creator Studio (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a creator-facing "Studio" — a single, elegant home for launching and managing NFT collections — that replaces the cramped admin panel and designs out the `mint price out of range` bug.

**Architecture:** New routes `/nft/studio`, `/nft/studio/new`, `/nft/studio/:creator/:slug` under the existing `/:network` layout. Pure validation/units helpers (new, TDD) sit in front of the existing, frozen `launchpad.ts` builders. The manage workspace reorganizes the logic currently crammed into `CollectionDetail.tsx`'s `ManagePanel` into discrete, labelled sections. Collector-facing pages are untouched this phase (Phase 2). Frontend-only — no on-chain ABI changes.

**Tech Stack:** React + TypeScript + React Router (`react-router-dom`), Vite, Vitest + `@testing-library/react`, Adena wallet via `useAdena`/`doContractBroadcast`. Styling via Memba's `tokens.css` (teal/Kodera) CSS variables.

## Global Constraints

- **Frontend-only.** On-chain realms (`memba_collections`) are frozen. Never change a builder's arg order in `lib/launchpad.ts` — the arg arrays are the ABI.
- **Reuse existing builders** verbatim: `buildCreateCollectionMsg`, `buildSetMintConfigMsg`, `buildSetMintPhaseMsg`, `buildMintPublicMsg`, `buildMintAllowlistMsg`, `buildAdminMintMsg`, `buildWithdrawProceedsMsg` (signatures in the task interfaces).
- **Mint price unit rule:** users enter price in **GNOT**; convert to ugnot for the builder. Valid = `0` (free) **or** `≥ MIN_MINT_PRICE` (1000 ugnot = 0.001 GNOT). Validate client-side and show the rule; never let a sub-minimum value reach the chain.
- **Aesthetic:** editorial-calm. Use only Memba teal + `tokens.css` CSS variables (`--color-*`, `--space-*`, `--radius-*`, `--font-mono`). No purple `#8b5cf6`, no green `#4caf50`, no hardcoded px for spacing.
- **Collection IDs are `creator/slug`** (contain a slash). Route param is split `:creator/:slug` and rejoined `${creator}/${slug}`.
- **Wallet address** is `adena?.address || ""` from `useOutletContext<LayoutContext>()`; an empty string means disconnected.
- **Branch:** `feat/nft-creator-studio` (never commit to `main`). **Commit messages:** concise subject only — no `Co-Authored-By`, no "Generated with Claude", no trailers.
- **Tests:** Vitest. Component tests wrap in `<MemoryRouter>` and mock libs with `vi.mock()` (pattern in `components/ui/QuestProgress.test.tsx`).

---

## File Structure

**Create:**
- `frontend/src/lib/mintPrice.ts` — pure GNOT↔ugnot conversion + mint-price validation. The bug fix lives here.
- `frontend/src/lib/mintPrice.test.ts` — unit tests for the above.
- `frontend/src/pages/studio/StudioHome.tsx` — `/nft/studio`: the connected creator's collections + launch CTA.
- `frontend/src/pages/studio/StudioManage.tsx` — `/nft/studio/:creator/:slug`: sectioned manage workspace shell + section router.
- `frontend/src/pages/studio/sections/MintSection.tsx` — admin-mint + public/allowlist mint.
- `frontend/src/pages/studio/sections/SettingsSection.tsx` — mint config (price/denom/supply/caps/start/cooldown) with the GNOT price input.
- `frontend/src/pages/studio/sections/PhasesSection.tsx` — set mint phase.
- `frontend/src/pages/studio/sections/AllowlistSection.tsx` — allowlist builder + compute root + set allowlist phase.
- `frontend/src/pages/studio/sections/WithdrawSection.tsx` — withdraw proceeds.
- `frontend/src/pages/studio/useCollectionAdmin.ts` — shared hook: load a collection, derive `isAdmin`, expose `run(msg, memo)`.
- `frontend/src/pages/studio/studio.css` — editorial-calm styling on Memba tokens.
- Test files alongside each component (`*.test.tsx`).

**Modify:**
- `frontend/src/App.tsx:203-213` — add two `/nft/studio*` routes (home + manage). Leave `/nft/create` as-is (the existing working create flow, linked from Studio Home). A bespoke guided multi-step create (`StudioCreate`) is a Phase-1 fast-follow — see self-review.
- `frontend/src/pages/CollectionDetail.tsx` — remove the inline `ManagePanel` render (admin tools now live in Studio); replace with a "Manage in Studio →" link shown to the admin. (Public view otherwise unchanged this phase.)
- `frontend/src/pages/CreatorProfile.tsx` — point the per-collection "manage" affordance at `/nft/studio/:creator/:slug`.

---

## Task 1: Mint-price validation + GNOT/ugnot helpers

**Files:**
- Create: `frontend/src/lib/mintPrice.ts`
- Test: `frontend/src/lib/mintPrice.test.ts`

**Interfaces:**
- Consumes: `MIN_MINT_PRICE` (= 1000) from `./launchpad`.
- Produces:
  - `gnotToUgnot(gnot: number): number`
  - `ugnotToGnot(ugnot: number): number`
  - `MAX_MINT_PRICE_UGNOT: number`
  - `validateMintPrice(input: string): { ok: boolean; ugnot: number; error?: string }`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest"
import { gnotToUgnot, ugnotToGnot, validateMintPrice, MAX_MINT_PRICE_UGNOT } from "./mintPrice"
import { MIN_MINT_PRICE } from "./launchpad"

describe("mintPrice — conversions", () => {
    it("gnotToUgnot multiplies by 1e6 and rounds", () => {
        expect(gnotToUgnot(1)).toBe(1_000_000)
        expect(gnotToUgnot(0.001)).toBe(1000)
        expect(gnotToUgnot(0.0015)).toBe(1500)
    })
    it("ugnotToGnot divides by 1e6", () => {
        expect(ugnotToGnot(1_000_000)).toBe(1)
        expect(ugnotToGnot(1000)).toBe(0.001)
    })
})

describe("mintPrice — validateMintPrice", () => {
    it("empty or 0 is a valid free mint", () => {
        expect(validateMintPrice("")).toEqual({ ok: true, ugnot: 0 })
        expect(validateMintPrice("0")).toEqual({ ok: true, ugnot: 0 })
    })
    it("accepts a price at or above the 0.001 GNOT minimum", () => {
        expect(validateMintPrice("0.001")).toEqual({ ok: true, ugnot: MIN_MINT_PRICE })
        expect(validateMintPrice("1.5")).toEqual({ ok: true, ugnot: 1_500_000 })
    })
    it("rejects a non-zero price below the minimum (the bug)", () => {
        const r = validateMintPrice("0.0001") // 100 ugnot < 1000
        expect(r.ok).toBe(false)
        expect(r.error).toMatch(/0\.001 GNOT/)
    })
    it("rejects negatives and non-numbers", () => {
        expect(validateMintPrice("-1").ok).toBe(false)
        expect(validateMintPrice("abc").ok).toBe(false)
    })
    it("rejects an absurdly large price above the sanity ceiling", () => {
        const r = validateMintPrice(String(ugnotToGnot(MAX_MINT_PRICE_UGNOT) + 1))
        expect(r.ok).toBe(false)
    })
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd frontend && npx vitest run src/lib/mintPrice.test.ts`
Expected: FAIL — `mintPrice` module / exports not found.

- [ ] **Step 3: Implement `mintPrice.ts`**

```typescript
import { MIN_MINT_PRICE } from "./launchpad"

/** Sanity ceiling for a mint price (1e9 GNOT). The realm enforces the true max;
 *  this only catches fat-finger / overflow input client-side. */
export const MAX_MINT_PRICE_UGNOT = 1_000_000_000_000_000

export function gnotToUgnot(gnot: number): number {
    return Math.round(gnot * 1_000_000)
}

export function ugnotToGnot(ugnot: number): number {
    return ugnot / 1_000_000
}

/**
 * Validate a user-entered mint price (in GNOT) against the realm's rule:
 * 0 (free) or >= MIN_MINT_PRICE (0.001 GNOT), <= sanity ceiling.
 * Returns the ugnot value to pass to buildSetMintConfigMsg.
 */
export function validateMintPrice(input: string): { ok: boolean; ugnot: number; error?: string } {
    const trimmed = input.trim()
    if (trimmed === "" || trimmed === "0") return { ok: true, ugnot: 0 }

    const gnot = Number(trimmed)
    if (!Number.isFinite(gnot) || gnot < 0) {
        return { ok: false, ugnot: 0, error: "Enter a number in GNOT (e.g. 1.5), or 0 for a free mint." }
    }

    const ugnot = gnotToUgnot(gnot)
    if (ugnot > 0 && ugnot < MIN_MINT_PRICE) {
        return { ok: false, ugnot, error: "Minimum paid price is 0.001 GNOT. Use 0 for a free mint." }
    }
    if (ugnot > MAX_MINT_PRICE_UGNOT) {
        return { ok: false, ugnot, error: "That price is too high." }
    }
    return { ok: true, ugnot }
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cd frontend && npx vitest run src/lib/mintPrice.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mintPrice.ts frontend/src/lib/mintPrice.test.ts
git commit -m "feat(nft): GNOT/ugnot mint-price helpers + validation"
```

---

## Task 2: Studio routes + connected-wallet gate

**Files:**
- Modify: `frontend/src/App.tsx:203-213`
- Create: `frontend/src/pages/studio/StudioHome.tsx` (stub for this task), `frontend/src/pages/studio/StudioManage.tsx` (stub)
- Test: `frontend/src/pages/studio/StudioHome.test.tsx`

**Interfaces:**
- Consumes: `useOutletContext<LayoutContext>()` (for `adena.address`), `useNetworkPath()` from `hooks/useNetworkNav`.
- Produces: route-mounted `StudioHome`, `StudioCreate`, `StudioManage` components; a `<ConnectGate>` pattern reused by all three (renders a connect prompt when `adena?.address` is empty).

- [ ] **Step 1: Write the failing test** (Studio Home shows a connect prompt when disconnected)

```tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { StudioHome } from "./StudioHome"

function renderWithCtx(address: string) {
    return render(
        <MemoryRouter initialEntries={["/test13/nft/studio"]}>
            <Routes>
                <Route path="/:network/nft/studio" element={<StudioHome />} />
            </Routes>
        </MemoryRouter>,
    )
}

vi.mock("react-router-dom", async (orig) => {
    const mod = await orig<typeof import("react-router-dom")>()
    return { ...mod, useOutletContext: () => ({ adena: { address: "" } }) }
})

describe("StudioHome — gating", () => {
    it("prompts to connect when no wallet", () => {
        renderWithCtx("")
        expect(screen.getByText(/connect/i)).toBeInTheDocument()
    })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd frontend && npx vitest run src/pages/studio/StudioHome.test.tsx`
Expected: FAIL — `StudioHome` not found.

- [ ] **Step 3: Create the stubs + the shared connect gate**

In `StudioHome.tsx` (and an analogous stub for `StudioManage` returning a heading), implement the connect gate:

```tsx
import { useOutletContext } from "react-router-dom"
import type { LayoutContext } from "../../App" // match the existing LayoutContext import used by CollectionDetail

export function StudioHome() {
    const { adena } = useOutletContext<LayoutContext>()
    const me = adena?.address || ""
    if (me === "") {
        return (
            <div className="studio-page">
                <p>Connect your wallet to open the Studio.</p>
            </div>
        )
    }
    return <div className="studio-page"><h1>Studio</h1></div>
}
```

(Use the same `LayoutContext` type source that `CollectionDetail.tsx` imports — verify its path before writing.)

- [ ] **Step 4: Add the routes** in `App.tsx`, immediately after the `nft/create` route (before `nft/:realmPath`):

```tsx
<Route path="nft/studio" element={<Suspense fallback={<PageLoader />}><StudioHome /></Suspense>} />
<Route path="nft/studio/:creator/:slug" element={<Suspense fallback={<PageLoader />}><StudioManage /></Suspense>} />
```

Add lazy imports next to the other NFT lazy imports. Keep `nft/:realmPath` LAST (the ordering comment at `App.tsx:203` is load-bearing).

- [ ] **Step 5: Run the test + typecheck**

Run: `cd frontend && npx vitest run src/pages/studio/StudioHome.test.tsx && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/studio/ frontend/src/App.tsx
git commit -m "feat(nft): studio routes + connect gate"
```

---

## Task 3: Studio Home — your collections

**Files:**
- Modify: `frontend/src/pages/studio/StudioHome.tsx`
- Test: `frontend/src/pages/studio/StudioHome.test.tsx`

**Interfaces:**
- Consumes: `fetchCollectionList(rpcUrl?, path?)` → `CollectionListRow[]` from `lib/launchpadReads`; `CollectionListRow` = `{ name, id, creator, slug, phase, minted }`; `useNetworkPath()`.
- Produces: a list, filtered to `row.creator === me`, each linking to `/nft/studio/:creator/:slug`, plus a "Launch new collection" link to `/nft/studio/new`. Loading + empty states.

- [ ] **Step 1: Write the failing test** — when connected with collections, renders the owned ones + the launch CTA; empty state otherwise. (Mock `fetchCollectionList` via `vi.mock("../../lib/launchpadReads", ...)` returning two rows, one owned by `me`, one not; assert only the owned row renders and `getByText(/launch new collection/i)` exists.)

- [ ] **Step 2: Run, verify fail.**
Run: `cd frontend && npx vitest run src/pages/studio/StudioHome.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — on mount (`useEffect`), `fetchCollectionList()`, `setRows(list.filter(r => r.creator === me))`; render loading → list/empty. Each item: name, phase label, minted count, `<Link to={np(\`nft/studio/${row.id}\`)}>`. Header CTA `<Link to={np("nft/create")}>Launch new collection</Link>` (the existing, working create flow). Use `studio.css` classes (Task 12) — plain semantic markup for now.

- [ ] **Step 4: Run, verify pass** (both connected-with-collections and empty cases).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/studio/StudioHome.tsx frontend/src/pages/studio/StudioHome.test.tsx
git commit -m "feat(nft): studio home lists your collections"
```

---

## Task 4: `useCollectionAdmin` hook

**Files:**
- Create: `frontend/src/pages/studio/useCollectionAdmin.ts`
- Test: `frontend/src/pages/studio/useCollectionAdmin.test.ts`

**Interfaces:**
- Consumes: `fetchCollectionDetail(id, rpcUrl?, path?)` → `CollectionDetail | null` (`launchpadReads`); `doContractBroadcast(msgs, memo)` (`lib/grc20`); `friendlyError(e)` (`lib/errorMessages`); `adena.address`.
- Produces:
  - `useCollectionAdmin(id: string): { col: CollectionDetail | null; isAdmin: boolean; me: string; loading: boolean; notice: string | null; error: string | null; run: (msg: AminoMsg, memo: string) => Promise<void>; reload: () => void }`
  - `run` broadcasts one msg, sets `notice` on success / `error: friendlyError(e)` on failure, then `reload()`.

- [ ] **Step 1: Write the failing test** — mock `launchpadReads.fetchCollectionDetail` to return `{ id, admin: ME, ... }`; render the hook via a test component (or `@testing-library/react`'s `renderHook`); assert `isAdmin === true` when `me === admin`, `false` otherwise; assert `run` calls `doContractBroadcast` (mocked) and sets `notice`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the hook. `me = adena?.address || ""`. `isAdmin = me !== "" && col?.admin === me`. `run` mirrors `CollectionDetail.tsx:113-126` (try `doContractBroadcast([msg], memo)` → `setNotice(\`${memo} ✓\`)` + reload; catch → `setError(friendlyError(e))`). Use `friendlyError` (not the raw message) so chain panics become plain language.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/studio/useCollectionAdmin.ts frontend/src/pages/studio/useCollectionAdmin.test.ts
git commit -m "feat(nft): useCollectionAdmin (load + isAdmin + run)"
```

---

## Task 5: Manage workspace shell + section nav

**Files:**
- Modify: `frontend/src/pages/studio/StudioManage.tsx`
- Test: `frontend/src/pages/studio/StudioManage.test.tsx`

**Interfaces:**
- Consumes: `useParams<{creator; slug}>()`, `useCollectionAdmin(id)`.
- Produces: a shell that reads `:creator/:slug` → `id`, loads via `useCollectionAdmin`, gates to admin (`isAdmin === false` → "Only the collection owner can manage this." + a link back to the public page), and renders a section nav `Mint · Phases · Allowlist · Withdraw · Settings` with the selected section below. Sections are rendered by Tasks 6–10; here they are placeholder panels keyed by a `section` state.

- [ ] **Step 1: Write the failing test** — non-admin sees the gate message; admin sees the five section labels and defaults to "Mint".
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the shell: `id = \`${creator}/${slug}\``; loading → spinner; not found → message; `!isAdmin` → gate; else header (collection name + phase + a "View public page →" link to the existing public route `nft/collection/${id}`) + nav buttons setting `section` + the active section component (placeholders until Tasks 6–10 land).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio manage shell + section nav"`

---

## Task 6: Settings section — mint config with the GNOT price fix

(Sequenced before the other sections because it carries the bug fix and the most logic.)

**Files:**
- Create: `frontend/src/pages/studio/sections/SettingsSection.tsx`
- Test: `frontend/src/pages/studio/sections/SettingsSection.test.tsx`

**Interfaces:**
- Consumes: `validateMintPrice(input)` (`lib/mintPrice`); `buildSetMintConfigMsg(caller, NFT_COLLECTIONS_PATH, id, MintConfigParams)` where `MintConfigParams = { mintPrice, payDenom, maxSupply, maxPerWallet, mintStartBlock, mintCooldownBlocks }` (all numbers/strings); `NFT_COLLECTIONS_PATH` (`lib/nftConfig`); `run` + `caller` + `id` from props.
- Produces: `<SettingsSection id caller run />`.

- [ ] **Step 1: Write the failing tests**
  - Entering `0.0001` (below min) shows the inline error and the Save button is disabled / no broadcast fires.
  - Entering `1.5` enables Save and calls `run` with a msg whose `args[1] === "1500000"` (price converted to ugnot). (Spy on `run`; assert the built msg via `buildSetMintConfigMsg` arg order `[id, mintPrice, payDenom, maxSupply, maxPerWallet, mintStartBlock, mintCooldownBlocks]`.)
  - Entering `0` (free) is valid and sends `args[1] === "0"`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** Labelled fields (each `<label className="form-group"><span>…</span><input/></label>` with a `form-hint`): **Mint price (GNOT)** — hint "0 for a free mint · minimum 0.001 GNOT"; **Pay denom** (blank = native GNOT); **Max supply** (0 = unlimited); **Max per wallet** (0 = unlimited); **Mint start block** (0 = now); **Cooldown blocks** (0 = none). Compute `const priceCheck = validateMintPrice(price)`; show `priceCheck.error` inline when present; disable Save when `!priceCheck.ok`. On Save:

```tsx
run(
    buildSetMintConfigMsg(caller, NFT_COLLECTIONS_PATH, id, {
        mintPrice: priceCheck.ugnot,
        payDenom: denom.trim(),
        maxSupply: num(maxSupply),
        maxPerWallet: num(maxPerWallet),
        mintStartBlock: num(startBlock),
        mintCooldownBlocks: num(cooldown),
    }),
    `Set mint config ${id}`,
)
```

where `const num = (s: string) => Math.max(0, parseInt(s, 10) || 0)`.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio settings section — GNOT mint price, validated"`

---

## Task 7: Mint section (admin-mint + public/allowlist mint)

**Files:**
- Create: `frontend/src/pages/studio/sections/MintSection.tsx`
- Test: `frontend/src/pages/studio/sections/MintSection.test.tsx`

**Interfaces:**
- Consumes: `buildAdminMintMsg(caller, path, id, to, tokenURI)`; `buildMintPublicMsg(caller, path, id, tokenURI, nativePriceUgnot)`; `buildMintAllowlistMsg(caller, path, id, proof, maxQty, tokenURI, nativePriceUgnot)`; `parseAllowlistText`, `getAllowlistProof` (`lib/allowlistMerkle`); `col.mintPrice` (ugnot) + `col.payDenom` for the price to attach.
- Produces: `<MintSection id caller col run />`.

- [ ] **Step 1: Write the failing test** — admin-mint calls `run` with `buildAdminMintMsg` args `[id, to, uri]`; the "Admin mint" control is presented first (promoted) with copy "Mint straight to a wallet — no payment, works in any phase."
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — port `MintPublicForm` (props `{id, priceUgnot, caller, onRun}`) and `AllowlistMintForm` from `CollectionDetail.tsx:287-301,459-508` and the admin-mint control from `ManagePanel` (lines 332-341), unchanged in logic, into this section. Admin mint is the top card; public/allowlist mint below under a clear heading. `priceUgnot = isNative ? col.mintPrice : 0` where `isNative = col.payDenom === "" || col.payDenom === "ugnot"`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio mint section (admin + public/allowlist)"`

---

## Task 8: Phases section

**Files:**
- Create: `frontend/src/pages/studio/sections/PhasesSection.tsx`
- Test: `frontend/src/pages/studio/sections/PhasesSection.test.tsx`

**Interfaces:**
- Consumes: `buildSetMintPhaseMsg(caller, path, id, phase, allowlistRoot)`; `Phase` enum (`{Draft:0, Allowlist:1, Public:2, Closed:3}`) from `lib/launchpad`.
- Produces: `<PhasesSection id caller col run />`.

- [ ] **Step 1: Write the failing test** — selecting "Public" and saving calls `run` with `buildSetMintPhaseMsg` args `[id, "2", ""]`. Each phase shows a plain-language description.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — a phase selector (Draft / Allowlist / Public / Closed) with one-line descriptions; for non-allowlist phases pass `allowlistRoot = ""`. (Allowlist root is set from the Allowlist section, Task 9.)
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio phases section"`

---

## Task 9: Allowlist section

**Files:**
- Create: `frontend/src/pages/studio/sections/AllowlistSection.tsx`
- Test: `frontend/src/pages/studio/sections/AllowlistSection.test.tsx`

**Interfaces:**
- Consumes: `parseAllowlistText(text)` → `AllowlistEntry[]`; `computeAllowlistRoot(entries)` → `Promise<string>`; `buildSetMintPhaseMsg(...)` with `Phase.Allowlist` and the computed root.
- Produces: `<AllowlistSection id caller run />`.

- [ ] **Step 1: Write the failing test** — pasting two `g1…,qty` lines and clicking "Compute root" shows the entry count and a non-empty root; "Set allowlist phase" calls `run` with `buildSetMintPhaseMsg(caller, path, id, Phase.Allowlist, root)`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — port `AllowlistBuilder` (`CollectionDetail.tsx:511-552`) logic: textarea → `parseAllowlistText` → `computeAllowlistRoot`; show count + root; download JSON; "Set allowlist phase" button. Add labels + hints; validation message when the list is empty.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio allowlist section"`

---

## Task 10: Withdraw section

**Files:**
- Create: `frontend/src/pages/studio/sections/WithdrawSection.tsx`
- Test: `frontend/src/pages/studio/sections/WithdrawSection.test.tsx`

**Interfaces:**
- Consumes: `buildWithdrawProceedsMsg(caller, path, id, denom)`.
- Produces: `<WithdrawSection id caller run />`.

- [ ] **Step 1: Write the failing test** — default denom is `ugnot`; clicking Withdraw calls `run` with args `[id, "ugnot"]`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — a denom input (default `ugnot`) + a labelled Withdraw button; hint explains proceeds go to the mint-custody address.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio withdraw section"`

---

## Task 11: Wire sections into the shell; redirect old entry points

**Files:**
- Modify: `frontend/src/pages/studio/StudioManage.tsx` (replace placeholders with the five real sections)
- Modify: `frontend/src/pages/CollectionDetail.tsx` (remove inline `ManagePanel`; add an admin-only "Manage in Studio →" link to `nft/studio/${id}`)
- Modify: `frontend/src/pages/CreatorProfile.tsx` (point manage affordance at `nft/studio/${id}`)
- Test: update `StudioManage.test.tsx`; adjust `CollectionDetail` tests if any assert the old panel.

**Interfaces:**
- Consumes: Tasks 6–10 section components; `useCollectionAdmin`.
- Produces: a fully wired manage workspace; a single admin surface (Studio). (`/nft/create` is left intact and remains the create entry point.)

- [ ] **Step 1: Write/extend the failing test** — `StudioManage` (admin) renders the real Settings section when the "Settings" nav is clicked (assert a Settings-only field, e.g. the GNOT price hint, appears); `CollectionDetail` no longer renders the old config form for the admin but shows "Manage in Studio".
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — render `<MintSection/> <PhasesSection/> <AllowlistSection/> <WithdrawSection/> <SettingsSection/>` by `section` state, passing `{ id, caller: me, col, run }`. In `CollectionDetail.tsx`, delete the `{isAdmin && <ManagePanel .../>}` render (and the now-unused `ManagePanel`/`MintPublicForm`/`AllowlistMintForm`/`AllowlistBuilder` if not otherwise used — verify before deleting) and add `{isAdmin && <Link to={np(\`nft/studio/${id}\`)}>Manage in Studio →</Link>}`. (Leave `/nft/create` untouched — it stays the create entry point.)
- [ ] **Step 4: Run the full frontend suite + typecheck.**
Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors. (Resolves any tests that referenced the removed panel.)
- [ ] **Step 5: Commit** `git commit -m "feat(nft): wire studio sections; route manage to studio"`

---

## Task 12: Studio styling (editorial-calm, Memba tokens)

**Files:**
- Create: `frontend/src/pages/studio/studio.css`
- Modify: the studio page/section components to import it (`import "./studio.css"` / relative).
- Test: none (visual). Verified via dev server in Step 4.

**Interfaces:**
- Consumes: `tokens.css` variables (`--color-*`, `--space-*`, `--radius-*`, `--font-mono`).
- Produces: `.studio-page`, `.studio-list`, `.studio-card`, `.studio-nav`, `.studio-section`, reusing the existing `.form-group`/`.form-hint`/`.btn-primary` conventions. No purple/green; teal accent only; spacing via `--space-*`.

- [ ] **Step 1: Write the CSS** — editorial-calm: generous whitespace, 640–720px max-width page, understated section nav (underline-active), labelled fields stacked, single teal primary button. Mirror the token usage in `nft-launchpad.css` but only with Memba tokens (no `#8b5cf6`/`#4caf50`).
- [ ] **Step 2: Build + typecheck.** `cd frontend && npm run build`
- [ ] **Step 3: Lint.** `cd frontend && npm run lint`
- [ ] **Step 4: Dev-server visual check** — run the dev server, navigate to `/test13/nft/studio` and `/nft/studio/:creator/:slug` (temporarily force `isAdmin` if needed), confirm the sections render cleanly and match the editorial-calm direction; revert any temp hack.
- [ ] **Step 5: Commit** `git commit -m "feat(nft): studio editorial-calm styling"`

---

## Final verification (whole-phase)

- [ ] `cd frontend && npx vitest run` → all green (existing 2135 + new).
- [ ] `cd frontend && npx tsc --noEmit` → no type errors.
- [ ] `cd frontend && npm run lint` → clean.
- [ ] `cd frontend && npm run build` → succeeds.
- [ ] Manual: connect a wallet → `/nft/studio` lists your collections → "Launch new collection" creates one → open it in Studio → Settings rejects `0.0001` GNOT inline, accepts `1.5` → admin-mint a token. (This is the E2E unblock.)

## Self-Review notes (author)

- **Spec coverage:** Studio home (§4.2) → T3; guided create (§4.2) → Phase 1 reuses the existing working `/nft/create` (`CreateCollectionLaunchpad`), linked from Studio Home (T3); manage sections Mint/Phases/Allowlist/Withdraw/Settings (§4.2) → T6–T10; the bug fix (§6) → T1 + T6; design-system alignment (§5.2) → T12; gating → T2/T5. Trade-modal consolidation, `NFTMedia`, discovery hub, collection-page redesign are **Phase 2** (not in this plan, by design).
- **Flagged, not dropped:** the bespoke guided multi-step `StudioCreate` (spec §4.2's "identity → royalty/custody → review") is intentionally NOT in this plan — Phase 1 reuses the existing functional create form to keep focus on the manage workspace + the bug fix. Add it as a Phase-1 fast-follow if wanted.
- **Type consistency:** builder signatures + arg orders taken verbatim from `launchpad.ts`; `MintConfigParams` fields match; `run`/`RunFn` shape matches `CollectionDetail.tsx:113`.
