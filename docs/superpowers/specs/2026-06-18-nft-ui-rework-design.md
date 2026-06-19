# NFT Feature UI/UX Rework — Design Spec

_Status: DESIGN (2026-06-18). Brainstormed + approved direction. Frontend-only; on-chain realms are frozen. Drives a phased, subagent-driven TDD build._

## 1. Why

The NFT feature works end-to-end on-chain (launchpad → mint → v3 trading → Phase-0 indexer), but the **UI/UX does not meet an "AAA elegant" bar** and is actively causing bugs and confusion. A read-only audit of `frontend/src` found the problems are **systemic, not local**:

- **Fragmented surfaces.** Separate "gallery" vs "marketplace" tabs (`NFTGallery.tsx`), plus legacy `/nft/create/advanced` (`NFTLaunchpad.tsx`, ~1000 lines) and legacy v1 `/nft/:realmPath` (`NFTCollectionView`). No clear creator-vs-collector separation.
- **Triplicated trade modals.** `BuyNFTModal`/`V3BuyNFTModal`, `ListForSaleModal`/`V3ListForSaleModal`, `MakeOfferModal` — near-duplicate code per engine version. Inconsistent price-breakdown layouts.
- **Bolted-on aesthetic.** NFT pages introduce a purple (`#8b5cf6`) and green (`#4caf50`) accent set that exists nowhere else in Memba (which is teal `#00d4aa` / JetBrains Mono / Kodera tokens). Hardcoded px spacing instead of `--space-*`.
- **Cramped admin panel.** The collection "Manage" panel (`CollectionDetail.tsx`) crams 5–6 mini-forms (phase, mint config, admin-mint, allowlist, withdraw) into one block.
- **Unlabeled units → a real bug.** The mint-price field takes a raw **ugnot** integer with **no client-side validation** and no displayed range. The realm accepts `0` (free) or `[MIN_MINT_PRICE=1000, MaxPriceUgnot]` ugnot (`launchpad.ts:31`, `:149`); a value of `1` (a user thinking in *GNOT*) sends 1 ugnot and the chain rejects it with a cryptic `mint price out of range` in the wallet popup.
- **Empty media.** NFT art frequently renders as blank/"empty" tiles — no robust IPFS/gateway media component.

A spot-polish cannot reach "AAA elegant." This rework re-architects the feature holistically.

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| **Scope** | The **whole NFT feature** — creator + collector + marketplace + profile — designed as one coherent system. |
| **Depth** | **Full overhaul** — information architecture / flows **and** AAA visuals (not a reskin). |
| **Aesthetic** | **Editorial calm** — minimal, type-led, generous whitespace, a single teal accent. Memba's existing design language, elevated. No dramatic art hero, no dense "trader cockpit." |
| **IA** | **Studio + Market split** — a creator-facing Studio (launch + manage) separated from a collector-facing Marketplace (browse + buy). |
| **Constraint** | **Frontend-only.** On-chain realms (`memba_collections`, `memba_nft_market_v3`) are deployed/immutable; we redesign around the existing ABIs. No contract changes. |

## 3. Goals / Non-goals

**Goals**
- One coherent, elegant NFT experience aligned to Memba's design system (teal/Kodera tokens, JetBrains Mono, `--space-*`).
- Clear separation of the **creator** journey (launch + manage) from the **collector** journey (discover + buy).
- Eliminate the unit/validation class of bug: human-friendly inputs with inline validation and on-chain bounds surfaced before signing.
- Consolidate the v1/v2/v3 trade modals into **one** engine-aware component set.
- Robust media rendering (no more "empty" NFTs).
- Consistent empty / loading / error / connect-wallet states.

**Non-goals**
- No on-chain realm/ABI changes (frozen).
- No new trading engine (floor-offers etc. remain a separate, parked effort).
- No points/rewards UI surface (separate roadmap item).
- Not adding new marketplace capabilities beyond what the realms already expose (list/buy/offer/accept on v3).

## 4. Information Architecture

Two clearly separated areas. Routes below are **illustrative** (final routes are pinned in the implementation plan); today's routes that they replace are noted.

### 4.1 Marketplace (public, collector-facing)
- **`/nft` — Discovery hub.** One elegant browse that merges today's split "gallery" + "marketplace" tabs (`NFTGallery.tsx`): verified/featured collections, recent activity, search. Replaces the tabbed gallery.
- **`/nft/c/:creator/:slug` — Collection page.** Editorial-calm. Collection identity + understated stats (floor / volume / owners / listed), a clean **token grid with real media**, and sections: **Items · Activity · About**. Inline **buy / make-offer** for listed tokens. **Zero admin chrome** — this page is collector-facing only. Replaces the public half of `CollectionDetail.tsx`.
- **`/nft/creator/:address` — Creator profile.** A creator's collections + verified status. Refines `CreatorProfile.tsx`.

### 4.2 Creator Studio (gated to the connected owner)
- **`/nft/studio` — Studio home.** "Your collections" + a prominent "Launch new collection" CTA.
- **`/nft/studio/new` — Guided create flow.** A short, labelled, validated multi-step flow (identity → royalty/custody → review & deploy), replacing the cramped single form in `CreateCollectionLaunchpad.tsx`.
- **`/nft/studio/:creator/:slug` — Manage workspace.** A properly **sectioned** admin surface (tabs or anchored sections), each with real space:
  - **Mint** — Admin-mint (mint straight to a wallet; works in any phase; promoted as the quickest path) **and** public/allowlist mint configuration.
  - **Phases** — set mint phase (Draft / Allowlist / Public / Closed) with plain-language explanations.
  - **Allowlist** — address-list builder + Merkle root compute, with validation and copy feedback.
  - **Withdraw** — pull collected mint proceeds to the custody address.
  - **Settings** — denom, supply caps, per-wallet caps, cooldown, start block.
  This replaces the crammed `ManagePanel` in `CollectionDetail.tsx`.

### 4.3 Legacy retirement
- `/nft/create/advanced` (`NFTLaunchpad.tsx`, code-gen wizard) — **retired / redirected** to the Studio create flow.
- `/nft/:realmPath` (`NFTCollectionView`, v1 compat) — **retired / redirected**; v1 collections surface read-only in the hub if still needed, otherwise dropped.
- Decision to fully delete vs. redirect-and-soft-hide is settled in Phase 2 (depends on whether any v1 collections still need a viewer).

## 5. Component system

The redesign introduces a small, shared component layer and deletes the duplication.

### 5.1 Trade modals → one engine-aware set
Consolidate `BuyNFTModal`+`V3BuyNFTModal`, `ListForSaleModal`+`V3ListForSaleModal`, and `MakeOfferModal` into **one** `<TradeModal>` set driven by the existing `tradeEngineFor(source)` router (`lib/tradeEngine.ts`), which already returns `{marketPath, collectionPath, marketAddr, feeBps}` per engine (v2/v3). The modal reads the engine from the collection's source registry — no per-version components.
- Shared **`<PriceBreakdown>`** — price, platform fee (per-engine: v2 250 bps, v3 200 bps), royalty, seller proceeds, with a **live preview** as the price input changes. Replaces the three divergent breakdown layouts.

### 5.2 Design-system alignment
- **Remove** the NFT-only purple (`#8b5cf6`) and green (`#4caf50`). Everything uses Memba's teal primary and the Kodera/`tokens.css` variables; spacing via `--space-*` (no hardcoded px).
- **One** card component, **one** button family (`.btn-primary`/`.btn-secondary`/`.btn-danger`), **one** modal shell — replacing the bespoke `.nft-modal__*` / `.mp-*` / `.nft-launchpad.css` duplicates.
- Consolidate `nft-launchpad.css` + `nft-gallery.css` into a coherent, token-based stylesheet (or CSS modules per component); delete dead/duplicated selectors.

### 5.3 Media
- A real **`<NFTMedia>`** component: IPFS/gateway URL resolution + graceful fallback (placeholder, not a broken image) + lazy load. Used by every token card and the token detail. Fixes the "NFTs look empty" problem.

### 5.4 States
- Standard, consistent **empty / loading / error / connect-wallet** states across hub, collection, studio, and modals (replacing ad-hoc handling and the raw event dump in `NFTActivityFeed.tsx`).

## 6. The mint-price bug, designed out

Root cause (§1): raw-ugnot input, no validation, no range shown, no unit clarity.

**Design:**
- Mint price is entered in **GNOT** (the human unit), with the field clearly denominated.
- Converted to ugnot under the hood for `buildSetMintConfigMsg` (`launchpad.ts`).
- **Inline validation** before the user can submit: allow `0` (free) **or** `≥ 0.001 GNOT` (= `MIN_MINT_PRICE` 1000 ugnot), `≤ MaxPriceUgnot`. The valid range and denom are shown next to the field.
- Same treatment for any other raw-unit fields (e.g. amounts elsewhere in mint/withdraw).
- Net effect: the chain's `mint price out of range` can no longer be reached through the UI; errors are caught client-side with a plain-language message.

## 7. Data flow (reuse existing plumbing)

No new data layer. The redesign re-skins/reorganizes on top of the existing libs:
- **Builders:** `lib/launchpad.ts` (create, SetMintConfig, SetMintPhase, mints, withdraw), `lib/nftMarketplaceV3.ts` (v3 list/buy/offer/approvals), `lib/tradeEngine.ts` (engine router), `lib/nftConfig.ts` (paths, addresses, fee bps).
- **Reads:** `lib/v3TokenGrid.ts` (token enumeration + listings), the v2 Render parsers, launchpad reads.
- **Backend reads (stats/activity):** the Phase-0 indexer projections (`nft_sales`, `nft_collections`, `nft_raw_events`) via the existing ConnectRPC surface, where available; otherwise on-chain Render.
- Validation/units helpers are new but pure and unit-tested.

## 8. Error handling

- Client-side validation on every form field with on-chain bounds (price range, supply, caps), surfaced inline before signing.
- Friendly mapping of known chain errors (extend `lib/errorMessages.ts`) so wallet-popup panics become plain-language UI messages.
- Consistent error state per surface; never a blank screen.

## 9. Testing (TDD)

- **Unit (vitest):** unit/format helpers (GNOT↔ugnot, bounds), the `tradeEngineFor` routing, the consolidated builders, price-breakdown math (fee/royalty/proceeds per engine).
- **Component:** the unified TradeModal (per-engine behavior), NFTMedia fallback, validation gates (out-of-range price blocked client-side).
- **E2E (Playwright):** create → admin-mint → list → buy happy path; studio gating (admin-only); collection page renders media + states.
- Aligns with the existing 2135-test suite; new code is TDD-first.

## 10. Phasing (build order)

- **Phase 1 — Creator Studio.** Studio home + guided create flow + sectioned manage workspace (Mint / Phases / Allowlist / Withdraw / Settings), **including the GNOT-unit + validation fix**. Solves the acute admin pain and unblocks the E2E pipeline demo. Highest priority.
- **Phase 2 — Marketplace.** Discovery hub + redesigned collection page + the consolidated `<TradeModal>` set + `<NFTMedia>`. Retire legacy surfaces.
- **Phase 3 — Polish.** Activity feed (human-readable), traits/filters, creator profile refinement, full mobile pass, empty/error-state sweep.

Each phase is its own implementation plan → subagent-driven TDD build → review → PR, with expert-audit checkpoints. Phases ship independently behind the existing NFT surfacing.

## 11. Out of scope
- On-chain realm/ABI changes; the floor-offers engine; points/rewards UI; GRC20 trading desk; trait-scoped offers. (All separate roadmap items.)

## 12. Open questions (resolve in planning)
- Final route names (`/nft/c/...` + `/nft/studio/...` vs. keeping `/nft/collection/...`).
- v1 legacy collections: hard-delete the viewer vs. read-only redirect (depends on whether any live v1 collections remain that users still need to view).
- Studio manage layout: top tabs vs. anchored single-scroll sections (decide during Phase-1 design pass, possibly with a visual mock).
