# Marketplace v2 — Cross-Perspective Audit & Unification Plan

**Date:** 2026-06-27 · **Status:** 🟡 DRAFT for review (no code — review before "go")
**Predecessor:** `MARKETPLACE_UNIFIED_AUDIT_AND_DELIVERY_PLAN_2026-06-26.md` (the original unified plan, now partly shipped)
**Method:** 4 grounded code/realm audits (UX/UI · feature-completeness · unification-architecture · on-chain) + CTO synthesis (product/growth/economics + a Gno-user panel).

---

## 0. Executive summary

**The unified marketplace was always the plan, and the scaffold for it is genuinely built** — a discriminated-union asset model (all 4 lanes), a lane registry with dual-gate `isLive()`, a safety-asserting multi-engine router, and a DAO-owned per-lane fee spine. **We shipped v1 = the NFT lane** of that vision; it works end-to-end on test13 (deploy → register → buy/list/offer/accept/cancel, fee→DAO treasury verified on-chain).

But two things are true at once:

1. **The live NFT lane is _correct but un-merchandised_.** It reads as an engineer's admin panel, not an AAA product: monospace monoculture, NFT art demoted to 48px (often empty) thumbnails, a stats strip that shows four em-dashes, and a create page styled in a **different, off-brand design language** (purple/green, hardcoded hex). The user's instinct ("not really good UI & UX") is correct and specific.

2. **It's not yet "one marketplace" — it's the NFT page wearing a lane-registry coat.** The genuinely-shared surfaces (one front door at `/marketplace`, cross-lane discovery/search, a unified activity feed, "Sell anything") are the largest unbuilt gap. Services and Agents already have live realms + working UIs + builders — they need _integration_ (adapter + router branch + shell content), not invention. Only **Token-OTC is a real new on-chain build**.

**Recommended path (the CTO option):** **polish before breadth.** Make the NFT lane genuinely excellent (design-system rework + the dead-but-ready features that are already coded), then build the true shared shell, then plug in Services (cheap — escrow exists) and Token-OTC (the real build). A beautiful single lane that converts beats three mediocre lanes that don't. Each phase is independently shippable and gated.

---

## 1. Where we are (grounded current state)

| Layer | State |
|---|---|
| **Fee spine** `memba_market_config` | ✅ LIVE. Seeds nft 200 / service 200 / token 50 bps; `GetFeeBPS(lane)` pure + non-failing; treasury = DAO 2-of-2 multisig; `MaxFeeBPS=500`; no Pause by design. **Ready for all 3 lanes today.** |
| **Shared math** `memba_market_core_v2` | ✅ LIVE. `SplitProceedsBPS` + frozen event schema. The reusable settlement template. |
| **NFT engine** `memba_nft_market_v3_1` | ✅ LIVE + registered (sole market). `resolveFee()` + CEI banker payout — the copy-ready pattern for every future lane. |
| **Frontend asset model** `lib/marketplace/types.ts` | ✅ Built. `UnifiedListing` discriminated union — **all four** variants (nft/service/token/agent) modeled. |
| **Lane registry** `lib/marketplace/lanes.ts` | ✅ Built. `LANES`=[nft, service]; dual-gate `isLive()`; `getLiveLanes()`. Only NFT renders. |
| **Router** `lib/marketplace/router.ts` | ✅ Built (NFT). Asserts allowlist before any tx; throws "not wired" for service/token/agent. |
| **NFT lane UI** | ✅ Live — hub (collections grid + search + activity), collection page (items/activity/about + trade modal). |
| **Services** | 🟡 Live realm `escrow_v2` + standalone page `FreelanceServices.tsx` + builders — **not a shell lane; fee not routed to DAO**. |
| **Token-OTC** | 🔴 Only token _creation_ exists (`tokenfactory_v2`, `CreateToken.tsx`). **No trading engine at all.** |
| **Agents** | 🟡 Live realm `agent_registry` + standalone page `Marketplace.tsx` + partial on-chain credit path — not a shell lane. |
| **Unified shell surfaces** | 🔴 Hub is mounted at `/:net/nft`, not `/:net/marketplace`; no cross-lane discovery, no unified activity, no "Sell anything", no redirects. |

**Verdict on "was unification planned?"** Unequivocally yes — the predecessor doc is literally titled *UNIFIED*, decision #1 set "v1 = NFT + Services, Token-OTC → v1.1, Agents → v1.2," and the shell was architected around the lane registry for exactly this. We're mid-vision, not off-plan.

---

## 2. Cross-perspective audit

### Lens A — UX / UI (the "admin panel" problem) 🔴 weakest area

**Root cause:** correct + honesty-clean, but stylistically split-brained and un-merchandised.

- **Monospace monoculture.** Nearly every element is `--font-mono` at `--text-xs/-sm`, never climbing above `--text-xl`. The app _has_ Inter + a full type scale + the AAA Home as a reference; the marketplace uses none of it. **This is the #1 reason it "looks like an admin panel."**
- **Art is an afterthought.** Hub collection cards render art at **48×48px with a hardcoded `uri=""`** → every card shows the broken-image placeholder _by design_. The artwork _is_ the product; it should be the hero unit.
- **The four em-dashes.** The collection stats strip renders `—` for Floor/Volume/Listed when the indexer read is null — four bare dashes read as "broken," not "loading." (This is the exact symptom the user keeps hitting.)
- **Accent-color sprawl.** Three accents on one surface: teal (brand), green (`#1a7f4b`/`#4caf50` for accept/offer), purple (`#8b5cf6` legacy launchpad). `nft-launchpad.css` is a **different design language** — purple/green gradients, hardcoded px, `!important` — violating the very token discipline `marketplace-v2.css` documents.
- **Debug-dump moments at peak trust.** TradeModal and the About tab show raw, untruncated `g1…` addresses and `collectionID`; the buy modal shows **no token image** (you buy `#123` sight-unseen).
- **Missing primitives** (why bugs recur): no shared `StatStrip`-with-skeleton (so "—" is hand-rolled per page), no `Skeleton` grid, no `Address` (truncate+copy+resolve), no single CTA scale (four exist), no `EmptyState`, no accessible `Tabs`/`Modal` (tablists lack `tabpanel`/`aria-controls`; modal lacks focus trap).
- **Create page** is a flat single-column form costing 1 permanent GNOT with no live preview, no review step, emoji-as-design (`🚀`/`🎉`), and a developer-facing slug regex as the error message.

### Lens B — Feature completeness 🟡 (lots of dead-but-ready code)

The biggest finding: **infrastructure is built and unused.**

| Already coded, NOT wired | Where |
|---|---|
| **Delist** + **Cancel-offer** UI (builders + router cases exist) | `router.ts:91-93` — a listed owner is **stuck** (no remove/reprice); a bidder couldn't reclaim until #623 |
| **Portfolio** ("My NFTs") — endpoint fully implemented, zero call sites | `nftApi.fetchNFTPortfolio` |
| **Traits/attributes** — `nftMetadataUrl` built, never consumed | `nftApi.ts:126` |

**Structurally missing (table-stakes):** a **per-token detail page + deep link** (no shareable token URL today), **in-collection search/sort/filter** (tokens render in raw mint order), **"my offers / my listings"** aggregation, **unique-owners** stat, **offer-expiry countdown** (`createdBlk` fetched but never shown as time), watchlist, price-history charts, trade notifications.

**Data-layer:** two parallel paths (on-chain RPC + backend indexer) used inconsistently. Stats show "—" because `fetchNFTCollection` returns null on any indexer miss with **no on-chain fallback** — floor could be derived live from `GetListingsPage` (min price) instead of a dash.

### Lens C — Unification architecture 🟢 scaffold real; integration, not invention

The unification skeleton is faithful to the plan and is _real code_. What remains:

- **Services** → needs a `servicesAdapter` + a `routeService` branch + lane-native content in the shell + a `/services`→`/marketplace?lane=service` redirect. The page, builders, and realm all exist. **Caveat:** services is a milestone _state machine_ (fund/release/dispute), not a single priced tx — the router's `TradeAction`/single-`amountUgnot` shape must be extended per-lane.
- **Token-OTC** → essentially everything trade-related is new (see Lens D).
- **Agents** → adapter + router + lane content; has a _partial_ on-chain credit engine already (further along than the plan implied); lowest priority (v1.2).
- **The shared shell is the real gap:** one front door at `/marketplace`, a cross-lane discovery grid rendering mixed lane-typed cards, a multi-substrate unified activity feed (NFT=RPC, Services/Agents=REST), a shared stats strip, and a "Sell anything" chooser. The lane registry also needs richer states (read-only/paused, not just live/absent) and a single "register a lane" seam (today adding a lane edits the registry + router + `MarketplaceHub` separately).

### Lens D — On-chain feasibility 🟢 fee spine ready; 2 new engines needed

- **Fee spine + core: ready for all 3 lanes, no changes.** The NFT engine's `resolveFee()` + `SplitProceedsBPS` + CEI-banker payout is a copy-ready template.
- **Services:** `escrow_v2` has the full milestone lifecycle but **routes its 2% to a hardcoded legacy single-key, not the DAO treasury** — and Gno realms are immutable. Fix = a **new `escrow_v3`** fork that imports the config + pays `cfg.GetTreasury()`. Low complexity, mechanics proven, 0 funds in v2 so migration is clean.
- **Token-OTC:** nothing exists. Recommend a **new `memba_token_otc_v1`** = fixed-price OTC escrow (seller approves+lists grc20 at a GNOT price; buyer fills; fee→treasury via the shared math). Chosen over an on-chain orderbook (too heavy on Gno) and an AMM (out of scope — that's GnoSwap's niche; the 0.5% fee was set for OTC). Medium complexity; the real new build.
- **Governance hygiene to fix-forward:** the new engines should adopt the **real 2-of-2 multisig** as admin from day one (escrow_v2/v3.1/collections still hardcode the legacy single-key) — close the gap rather than copy it.

### Lens E — Product strategy / growth / economics (CTO synthesis)

- **Is "one marketplace" right for Memba? Yes — more than for a generic marketplace.** Three Memba-specific reasons: (1) **the fee flywheel** — every lane routes its fee to _one_ DAO treasury, so breadth compounds protocol revenue; (2) **one identity** — a member who launches an NFT, offers a service, and issues a token is _one_ reputation/XP/quest profile (Memba already spans these); (3) **co-located liquidity & discovery** — one front door, one activity feed, cross-sell. Unification is a genuine moat, not a vanity merge.
- **But cold-start is THE risk.** The fee→DAO flywheel needs volume to mean anything, and three half-built lanes split attention and liquidity. Near-term, **a polished NFT lane that converts is worth more than lane count.** Seed liquidity from the existing community (creators, validators, the DAO treasury itself can list), keep fees low to bootstrap (the spine already does: 2%/2%/0.5%).
- **Anti-wash already designed in:** zero XP for trade volume, volume shown net-of-self-transfer. Keep this — it's what lets the marketplace feed reputation without becoming a farm.
- **Sequencing implication:** polish + the shared shell first (compounding UX value), then lanes by _real demand signal_, not all at once. "No dead tabs" (a lane appears only when live) is the right discipline — extend it to "no dead lane until there's a reason."

### Lens F — The Gno-user panel (5 voices, grounded in the findings)

1. **NFT creator:** "Launching cost 1 GNOT and felt like filling a tax form — no preview of what I'm minting, purple buttons that don't match the rest of the app, and then my collection card shows a broken image."
2. **NFT collector:** "Four dashes where the floor price should be. I can't search or sort inside a collection, there's no page I can link to a friend for a single NFT, and the buy modal doesn't even show me the art."
3. **Freelancer (services):** "There's a whole services page but it's a different site from the NFT marketplace — why are they separate if it's 'one Memba'?"
4. **Token issuer:** "I can mint a token but there's nowhere to actually trade it. The 'token' fee exists in the config but the feature doesn't."
5. **DAO member / power user:** "I get the vision — one marketplace, all fees to our treasury. But right now it's the NFT page with extra plumbing. Make the one lane we have feel premium, then add the rest."

---

## 3. The unification verdict

We are **~1 of 4 lanes live on a real unified scaffold**, with the _shared shell_ surfaces still NFT-shaped. Closing the gap is two kinds of work: **(a) make the shell genuinely shared** (front door, cross-lane discovery/activity, "Sell anything"), and **(b) plug in lanes** — Services (integration), Token-OTC (new engine), Agents (later). None of it is a rewrite; the model, registry, router, and fee spine were built for exactly this.

---

## 4. Implementation plan (phased, gated)

> Principle: **polish before breadth.** Each phase ships independently behind the existing flag discipline. Realm work goes through security review; UX through an AAA design review; each lane gated on a real demand signal + kill-thresholds (anti-wash KPIs).

### Phase A — NFT lane to AAA (design system + dead-but-ready features) ⭐ start here
*The highest near-term ROI: it's the live revenue surface, the user flagged it, and it builds the primitives the shared shell will reuse.*

**A1 — Design-system foundation (unblocks everything visual)**
- Introduce editorial typography (sans/display for headings + prose, mono for **data only**); climb the type scale.
- Re-skin `nft-launchpad.css` onto tokens — **kill purple/green/hardcoded-hex/`!important`**; collapse the palette to black + teal + one on-brand success token.
- Build the missing primitives: `StatStrip` (with skeleton — kills the "—" class of bug), `Skeleton` grid, `Address` (truncate+copy+resolve), one `CTA` scale, `EmptyState`, accessible `Tabs` + `Modal` (focus trap, `aria-*`).
- A shared **media-forward asset card** (square art is the hero unit) reused by Hub + Collection.

**A2 — Merchandised Hub & Collection**
- Hub: editorial hero / featured strip; real cover art (or intentional generated tile — the `NFTMedia seed` fallback already exists); result count + sort + verified filter; skeleton loading; CTA empty state; unify the two duplicate "Sell/Launch" CTAs.
- Collection: real header (banner + avatar + **honest fetched** verified badge + description); fix the stats (skeleton while loading, real `0`, on-chain floor fallback from `GetListingsPage`); richer token cards (name, listed/unlisted clarity, optional rarity chip); actionable "Connect wallet" button.
- Create page: sectioned form (Identity/Royalty/Supply), **live collection preview**, a `PriceBreakdown` royalty sample, human slug errors, a richer success state.
- TradeModal: token image, truncated addresses, focus trap, don't dismiss on outside-click mid-form.

**A3 — Dead-but-ready features (cheap, high impact)**
- Wire **Delist + reprice** and **Cancel-offer** UI (builders/router already exist) — a listed owner is currently stuck.
- Surface **Portfolio / "My NFTs"** (`fetchNFTPortfolio` is implemented, zero call sites).
- **Per-token detail page + deep link** (`/nft/token/:creator/:slug/:tokenId`) — unblocks share, traits, history.
- **Traits/attributes** (consume `nftMetadataUrl`) + in-collection **search/sort/filter**.
- **"My offers / my listings"** aggregation; **offer-expiry countdown** (resolve `createdBlk`→time); **unique-owners** stat.

**Gate G-A:** AAA design review passes; Lighthouse/a11y clean; live deploy-preview verified; no regression in the working trade flows.

### Phase B — The true shared shell (make it _one_ marketplace)
*Now the registry pays off; build the surfaces every lane plugs into, reusing Phase A primitives.*
- Mount the hub at canonical **`/:net/marketplace`**; redirect legacy `/nft`, `/services`, `/marketplace`(agents), `/tokens` in with a lane filter (preserve URLs).
- **Cross-lane discovery grid** rendering mixed lane-typed `UnifiedListing` cards + shared facets (verified, price, lane).
- **Unified activity feed** — multi-substrate aggregator (NFT=RPC, Services/Agents=REST), net-of-self-transfer.
- Shared **stats strip** (Volume-30d / listings / DAO-fees-30d / traders) — needs the indexer endpoints (W1.6 backend task).
- **"Sell anything"** chooser routing to each lane's create flow.
- Lane-registry upgrades: richer states (live/read-only/paused) + a single "register a lane" seam (one place wires {tab, adapter, content, router-branch}).

**Gate G-B:** the shell renders ≥1 lane with the new surfaces; redirects verified; no dead tabs.

### Phase C — Services lane (integration; cheap because escrow exists)
- **Realm:** new **`escrow_v3`** — fork `escrow_v2`, import the fee config, route the 2% release fee to `cfg.GetTreasury()`, multisig admin from day one. (0 funds in v2 → clean.) Security review + gnodev settlement test.
- **Frontend:** `servicesAdapter` → `UnifiedService[]`; extend the router with a milestone-aware `routeService` (state-machine, not single tx); re-home `FreelanceServices` as a lane-native milestone panel; `/services` redirect; honest fee labelling (2% release → DAO; 5% cancel → freelancer, **never** labelled "→ DAO").

**Gate G-C:** escrow_v3 security-reviewed + settlement-verified; fee→treasury confirmed on-chain; lane live behind flag → preview verify.

### Phase D — Token-OTC lane (the real new build)
- **Realm:** new **`memba_token_otc_v1`** — fixed-price GRC20 OTC escrow (approve+list / fill), `resolveFee()`+`SplitProceedsBPS`, CEI, per-address caps, expiry+cancel exit, per-engine Pause, exact-payment + `expectedUnitPrice` front-run bind, per-fill min-notional. Optional `TokenSaleArgs` added to `memba_market_core_v2` (re-deployable `p/` package) for one audited event schema. **Adversarial mock-grc20 tests** (fee-on-transfer/reverting/reentrant) before ship.
- **Frontend:** token adapter + `routeToken` + `LANES` entry + lane content + `/tokens` redirect.

**Gate G-D:** realm security-reviewed (escrow-safety checklist) + adversarial tests pass; gnodev settlement; preview verify.

### Phase E — Agents lane (later, v1.2)
- Route the existing credit/deposit path through `memba_market_config` (per-lane fee → DAO); replace `SEED_AGENTS` with real `agent_registry` reads; adapter + router + lane content + redirect.

**Gate G-E:** demand signal present; fee routed; security review.

---

## 5. Recommended sequencing & open questions

**Recommendation:** **A → B → C → D → E**, with **A and B as the near-term focus** (they compound: A's primitives power B's shell, and together they make the _existing_ lane premium + the marketplace genuinely unified). C (Services) is a cheap, high-credibility add once the shell exists. D (Token-OTC) is the headline new capability but the most net-new on-chain work. E is roadmap.

**Open questions for you (these change the plan):**

1. **Priority — polish vs breadth?** My rec is **polish-first (A+B)** before new lanes. Confirm, or do you want a lane added sooner (e.g. Services in parallel) for the "all assets" story?
2. **Scope of "today" vs a program.** This is a multi-week program. Want me to (a) start Phase A now (design rework + quick-win features), (b) produce design mockups for A first (your usual "review mockups before build"), or (c) something narrower?
3. **Token-OTC model** — confirm **fixed-price OTC escrow** (not orderbook/AMM)?
4. **Services unification depth** — fully re-home `FreelanceServices` as a lane (more work, true unification) vs. keep it standalone and just link it from the shell (faster, looser)?
5. **Anything to add to the audit** before I treat it as the spec?

---

*Appendix — source audits (4 grounded lenses) available on request; key files: `frontend/src/lib/marketplace/{lanes,types,router,nftAdapter,v3Reads,builders}.ts`, `frontend/src/pages/{MarketplaceHub,CollectionPublic,CreateCollectionLaunchpad,FreelanceServices,Marketplace,CreateToken}.tsx`, `frontend/src/pages/{marketplace-v2,nft-launchpad}.css`, `samcrew-deployer/projects/memba/realms/{memba_market_config,memba_market_core_v2,memba_nft_market_v3_1,escrow_v2,tokenfactory_v2}`.*
