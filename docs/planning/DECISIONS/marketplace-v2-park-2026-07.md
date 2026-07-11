# Decision: Park Marketplace v2 (dark rearchitecture) — 2026-07

**Status:** ACCEPTED · **Date:** 2026-07-11 · **Owner:** zxxma
**Relates to:** #851 (Marketplace v2 unified lane pipeline — merged **dark**), `docs/planning/MARKETPLACE_V2_DEEP_AUDIT_AND_AAA_PLAN_2026-07-08.md` (the E.1–E.4 rearchitecture plan).

## Context

PR #851 merged a full **dark** Marketplace v2 pipeline (unified lane engine, `MarketCard` system, adapters, founding-supply seed) **beside** the LIVE marketplace, gated behind `VITE_ENABLE_MARKETPLACE_V2` (default **off**; enabled only in `.env.e2e`). The v2 rearchitecture plan (E.1–E.4: mobile trade BottomSheet, AllInPrice/interstitial/copymint, item-level browse) stayed open.

The current strategic frame **de-prioritizes** the marketplace-v2 rearchitecture in favour of the elevated pillars (App Store, reputation/reviews, real-supply/merchandising, points). Leaving v2 ambiguously half-done invites drift — accidental edits, half-cutovers, or confusion about which surface is canonical.

## Decision

1. **Marketplace v2 stays PARKED behind `VITE_ENABLE_MARKETPLACE_V2` (default off).** No cutover this cycle.
2. **We do NOT pursue the E.1–E.4 rearchitecture now** (mobile trade BottomSheet, AllInPrice/interstitial/copymint, item-level browse).
3. **The LIVE marketplace surface gets merchandising polish only** — 375px QA + result-count/skeletons/featured-ordering/empty-state parity (shipped via `feat/marketplace-375-merch`) — **NOT** the v2 components.
4. **The one Wave-E item that remains elevated is real-supply seeding** (founding-supply → on-chain listings), which is an **owner-gated ceremony**, not a frontend cutover.
5. **The v2 cutover (flipping the flag on in prod) remains an explicit OWNER decision**, deferred until Act I priorities are delivered.

## Do-not-drift inventory (the dark v2 tree — leave untouched until a deliberate cutover)

Non-exhaustive; treat the whole `*V2*` marketplace tree as frozen:
- **Components:** `MarketCard.tsx` / `MarketCard.css`, `ListingGrid.tsx`, `LaneView.tsx`, `LaneToolbar.tsx`, `*LaneV2.tsx`, `SellAnythingButton`, and the `MarketplaceV2Preview` page (its route self-gates — redirects out when the flag is off).
- **Data / adapters:** `adapters/{nftToCard,seedToCard,tokenOtcToCard}`, `seed/foundingSupply.seed.ts`, `useMarketFilters` / `marketFilters` / `useLaneQuery`.
- **Flag:** `VITE_ENABLE_MARKETPLACE_V2` (default off; `.env.e2e` only) via `isMarketplaceV2Enabled()` in `lib/config.ts`.

## Re-open criteria

Revisit the cutover only when **all** hold: (a) the Act I deliverables (App Store media/console, reviews-into-listings, points) have shipped; (b) an owner decision greenlights the mobile trade-sheet + merchandising rearchitecture; and (c) the founding-supply seeding ceremony has populated real on-chain listings so the v2 surface isn't empty.

## Consequences

- The live v1 lanes stay canonical; users see no change.
- Future sessions treat the dark v2 tree as frozen — merch/UX work lands on the live lanes only.
- No maintenance cost beyond keeping the dark tree compiling (CI already exercises it via `.env.e2e`).
