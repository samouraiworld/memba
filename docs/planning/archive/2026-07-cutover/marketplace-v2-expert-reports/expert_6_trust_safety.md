# Expert 6 — Trust & Safety + Web3 UX Audit — Memba Marketplace

**Lens:** reputation/reviews surfacing, verified/authenticity, scam/phishing protection, price-impact/slippage clarity, tx preview & wallet-connect trust, dispute/escrow safety, moderation, seller identity, P0 fund-drain as trust risk.
**Date:** 2026-07-08. Benchmarks: Fiverr, Upwork, OpenSea, Blur, Magic Eden, Uniswap, Coinbase, MetaMask, Airbnb, Stripe.

**One-line verdict:** Memba built a genuinely good on-chain reputation engine and then never plugged it into the marketplace. Every trust surface a buyer needs at the moment of signing is either missing, fake, or a text span. The listing experience is a cold, anonymous, unauthenticated storefront. This is the #1 thing blocking a tier-1 relaunch — and it's mostly wiring, not new invention.

---

## TOP FINDINGS

### P0-1 — Reputation/reviews exist but are wired to ZERO marketplace surfaces
**What's wrong:** A complete web-of-trust stack ships today — realm `memba_reviews_v1.gno` (ratings, reputation, reactions, flags, moderation), data layer `frontend/src/lib/reviews.ts` (fetchReviews/fetchSummary/**fetchReputation**), and polished UI `ReviewsSection.tsx` + `StarRating.tsx`. It is mounted on exactly two pages: `ValidatorProfile.tsx:670` and `ProfilePage.tsx:373`. It appears on **no** marketplace listing: not `CollectionPublic.tsx` (NFT detail), not `TokenDetail.tsx`, not `AgentLane`/`AgentDetailView`, not App Store `AppDetail`, not the (future) Services lane. `NftLane.tsx` collection cards show floor/volume but no rating, no seller reputation. `TradeModal.tsx` shows a seller **address string** (`TradeModal.tsx:356`) with zero reputation context before you sign.
**Why it matters:** Fiverr's entire conversion engine is seller level + star average + review count on every card and every gig page. OpenSea/Magic Eden surface collection ratings and creator profiles at the buy moment. Amazon puts stars on the card. Memba forces a buyer to sign a value transfer to an anonymous `g1…` with no trust signal whatsoever. The reputation number (`GetReputation`) that the realm already computes is **never rendered anywhere**.
**Recommendation:** Wire `summaryFromReviews` + `fetchReputation` into: (1) every listing card (compact StarRating + count + a seller-level chip), (2) every detail page (full ReviewsSection keyed to the seller/creator/collection subject), (3) the trade modals' seller block. This is the single highest-ROI trust fix and is almost entirely plumbing of code that already exists.

### P0-2 — Reviews are NOT purchase-gated → trivially gameable (fraud-resistance)
**What's wrong:** `PostReview` (`memba_reviews_v1.gno:209`) lets *any* wallet post one review for *any* subject with no proof of a completed transaction. One-per-(author,subject) is the only limit; a fresh wallet is free, so sybil review-farming (self-5-stars, competitor-1-stars) costs only gas. There is no "Verified Purchase" concept and no rate-limit/stake.
**Why it matters:** Fiverr/Upwork/Amazon reviews are anchored to a completed paid order — that's what makes the star average trustworthy. An ungated on-chain review system, once surfaced on listings (P0-1), becomes an *attack surface*: displaying gameable stars is worse than displaying none because it launders fraud as trust.
**Recommendation:** Before surfacing reviews on money-path listings, add a verified-purchase path: the reviews realm (or an adapter) should mark a review as `verified` when the author has an on-chain trade/settlement event with the subject (NFT sale, OTC fill, service release). Show two tiers: "Verified buyer" vs "Unverified." Weight reputation/sort by verified. Sybil-resistance is intrinsically weak on free wallets — lean on purchase-gating + reputation decay, not just one-per-pair.

### P0-3 — Un-guarded OriginSend/IsUserCall fund-drain class is a trust liability, not just a security bug
**What's wrong:** Per the brief, a live P0 class exists where realms read `OriginSend()` without an `IsUserCall()` guard (ref pattern `appstore.gno:125`). Money-path de-gate (Services, Tokens) is blocked on this. `memba_reviews_v1.gno` correctly uses `unsafe.PreviousRealm().Address()` for auth and is non-custodial, so it's clean — but the trading engines are the exposure.
**Why it matters:** A single publicized drain permanently poisons a marketplace's trust brand (see every "rug"/exploit headline). Trust is asymmetric: years to build, one incident to destroy. This gates any credible tier-1 claim.
**Recommendation:** Non-negotiable pre-ship gate (already tracked): all money-path realms guarded, multisig sig-verify enforce flip verified, Litestream restore + fund-recovery e2e drilled. Then publish a plain-language "Security" page (audits, guard model, treasury multisig) — Coinbase/OpenSea convert this into a trust asset.

### P1-4 — Agent lane renders FABRICATED ratings
**What's wrong:** `AgentLane.tsx:73` renders `★ {agent.rating.toFixed(1)} ({agent.ratingCount})` and a `✓` verified tick (`:49`) sourced from `SEED_AGENTS` mock data (brief: `agentRegistry.ts:87`). These are invented numbers shown as real trust signals.
**Why it matters:** Displaying fake stars/verified ticks is a cardinal trust violation — regulators and users treat fabricated reviews as fraud. It also trains users to distrust every badge you show.
**Recommendation:** Until agent ratings are real and purchase-gated, remove the star + verified UI from agent cards (or gate the whole lane off, consistent with the "no coming-soon" rule). Never render mock trust signals in a shipped surface.

### P1-5 — "Leaving Memba" is a text span, not a phishing interstitial
**What's wrong:** Third-party app links render `<a target="_blank" rel="noopener noreferrer">Open app ↗ (leaves Memba)</a>` (`AppStore.tsx:148-150`). The `rel`/iframe hygiene is correct and the inline-vs-newtab reasoning is sound, but there is no interstitial: no destination URL shown, no "Memba does not endorse external apps / never enter your seed phrase / verify the domain" warning, no confirm step.
**Why it matters:** The App Store is a curated-trust surface; users extend Memba's trust to whatever opens. MetaMask/Coinbase and every serious wallet show a full destination + explicit phishing warning before an external hop. Fake-dApp phishing is the #1 web3 attack vector.
**Recommendation:** Add a real leaving-Memba interstitial modal: show the full URL, a "you are leaving Memba — we don't control this site, never enter your seed phrase" warning, and an explicit Continue. Show the app's verified/pending status (see P1-6) on it.

### P1-6 — "Verified" is a single binary curated flag; no authenticity/copymint/impersonation defense
**What's wrong:** `VerifiedBadge.tsx` is a boolean team-curated flag, informational only. `NftLane.tsx:55` filters/searches collections **by name only** (`c.name.toLowerCase().includes(q)`) and never shows the collection address. There is no copymint detection, no "official contract" registry, no impersonation guard. Two collections can share a name; the card gives a buyer no way to tell the real one from a clone. App Store `status` field exists (`appStore.ts:59`) but `AppStore.tsx` renders **no** verified/pending chip on cards or detail — the trust chip the brief expects is absent in the shipped file.
**Why it matters:** OpenSea's post-2022 trust rebuild was largely verified badges + **copymint detection** + listing warnings, precisely because name-collision impersonation drained users. Memba today is where OpenSea was before that.
**Recommendation:** (1) Always display the collection/creator **address** on cards and detail, with a copy/explorer link. (2) Add a copymint/impersonation heuristic (same name as a verified collection but different address → "Unverified — not the official <name>" warning). (3) Render the App Store verified/pending status chip that `status` already supports. (4) Add a "new/unvetted seller" chip (tenure + zero verified reviews) — Airbnb/Fiverr flag new sellers explicitly.

### P1-7 — No price-impact / slippage / minimum-received on token OTC buys
**What's wrong:** `TokenTradeModal.tsx` computes `buyCostUgnot = buyAmountNum * unitPriceUgnot` client-side (`:100`) from `available`/`unitPriceUgnot` loaded earlier. If another buyer partially fills between load and sign, the quote is stale; there is no "you'll pay at most X," no minimum-received, no slippage tolerance, no re-quote, no price-change warning. `PriceBreakdown` shows fee but frames it as seller-side.
**Why it matters:** Uniswap made price-impact + slippage tolerance + minimum-received table stakes because silent bad fills destroy trust. An OTC partial-fill desk without a max-price guard surfaced to the user is a footgun.
**Recommendation:** Surface the on-chain slippage guard in the UI: show "Max you'll pay," "Minimum you'll receive," a price-changed re-quote, and a staleness re-check before broadcast. Warn on large fills relative to `available`.

### P1-8 — Transaction preview shows the seller's split, not what the buyer pays (+ no gas)
**What's wrong:** `PriceBreakdown.tsx` renders Price → Platform Fee → Creator Royalty → **"Seller Receives."** For a *buyer*, fee/royalty come out of the *seller's* proceeds, yet the modal shows them as line items with no "**You pay: X GNOT**" total and no network-fee estimate anywhere in `TradeModal`/`TokenTradeModal`. Offers say funds are "held in escrow" (`TradeModal.tsx:528`) — good — but the buy flow never states the buyer's all-in charge.
**Why it matters:** Coinbase/Stripe put the total charge in the largest type on the screen; ambiguity about "am I paying this fee?" is a top pre-signing anxiety. Web3 users are conditioned to a "You pay / You receive / Network fee" summary (Uniswap, MetaMask).
**Recommendation:** Add an explicit buyer-facing summary: "You pay" (total incl. any buyer-side fee), "Seller receives," "Creator royalty," and an estimated network fee, with the buyer total most prominent. Keep the seller-side breakdown on the list/sell path where it belongs.

### P1-9 — Services lane has no dispute/refund/arbitration design at all
**What's wrong:** `HireServiceModal.tsx` correctly fails closed (honest — good), but the underlying model is milestone-lock only: release (2% fee) or cancel (5% → freelancer). There is **no arbiter, no mediation, no refund adjudication** for a "work delivered but disputed" case — the only outcomes are the buyer releasing or cancelling.
**Why it matters:** Fiverr/Upwork/Airbnb's entire freelance-trust model is dispute resolution + mediation + refund policy. A binary escrow with no arbiter means every disagreement is a standoff; buyers won't fund strangers without recourse.
**Recommendation:** Do not enable Services until `escrow_v3` includes a dispute path: a neutral arbiter/multisig (or staked juror) that can split/refund escrow on evidence, plus a clear refund policy surfaced pre-hire. This is a design prerequisite, not a polish item.

### P2-10 — Moderation exists on-chain but is unreachable from listings, has no auto-hide, and is single-multisig
**What's wrong:** The realm has `Flag`, `HideReview/HideComment`, `Unhide`, and a mod dashboard (`GetFlaggedJSON`). But: no frontend Flag button is wired in a marketplace context; the realm explicitly does **not** auto-hide on flag threshold (`memba_reviews_v1.gno:462` comment — `FlagCount` accumulates but never triggers anything); takedown is a single moderator multisig (`ModeratorAddress`, `:34`) — a scaling/latency bottleneck.
**Why it matters:** Scam content lives until a human multisig acts; brigading does nothing either way. Marketplaces need a threshold-based provisional hide + appeal, not purely manual.
**Recommendation:** Wire a Flag control into surfaced reviews; add a flag-threshold provisional auto-hide (with mod override/Unhide + appeal) in the next reviews realm version; broaden moderators beyond one multisig.

### P2-11 — Wallet-connect trust cues are thin at the sign moment
**What's wrong:** The inline connect-and-post flow (`ReviewsSection.tsx:155-183`) is good UX, and the broadcast layer rejects untrusted RPCs — but the trade modals don't surface *which* wallet/address is acting, or *which* network/RPC they're signing against, before a value transfer.
**Recommendation:** Show the connected address + network ("Signing as g1…ab on test13") in trade modals; it's a cheap, high-confidence anti-phishing cue (Rabby/MetaMask-style pre-sign context).

---

## TRUST-SIGNAL SYSTEM DESIGN (for the new version)

A coherent trust spine, reused across all lanes via the unified shell:

1. **Identity layer (everywhere).** Every seller/creator/collection shows: @username (already resolvable via `attachUsernames`), truncated address + copy/explorer link, and a reputation-derived **seller-level chip** (Fiverr-style: New → Rising → Established → Top, computed from verified-review count + verified volume + tenure). One `<SellerTrust>` component, one subject convention.
2. **Verified-purchase reviews.** Reviews tied to on-chain settlement events; "Verified buyer" tier weighted in reputation and sort. Star summary on every card + full `ReviewsSection` on every detail page — reuse existing components as-is.
3. **Authenticity/anti-impersonation.** Address always visible; verified badge = curated + criteria link (keep `VerifiedBadge`'s honest tooltip); copymint heuristic → "not the official <name>" warning; App Store verified/pending chip driven by the existing `status` field.
4. **Listing-level risk flags.** New-seller chip, unverified-collection chip, price-anomaly flag (listed far from floor), stale-quote warning for OTC.
5. **Pre-transaction clarity.** Buyer-facing "You pay / Seller receives / Royalty / Est. network fee" summary; OTC max-pay + min-received + slippage; escrow explainer with dispute policy for Services.
6. **Leaving-Memba interstitial.** Full URL + no-endorsement + never-share-seed warning + explicit continue, on every external hop.
7. **Reachable moderation.** Flag control on every surfaced review; threshold provisional hide + appeal; multi-moderator.
8. **Wallet-sign context.** Address + network shown at the sign moment.

---

## TIER-1 BAR & THE GAP

**Tier-1 bar (T&S):** a buyer never signs a value transfer to an unknown party. At the point of decision they see: who the counterparty is (identity + reputation + level), whether they're authentic (verified/official-address/no-copymint), what exactly they'll pay (all-in, incl. slippage/gas), and what recourse exists if it goes wrong (dispute/refund). Reviews are purchase-anchored; scam content is flaggable and provisionally auto-hidden; external hops are gated by an explicit warning. (This is the Fiverr + OpenSea + Uniswap + Coinbase union.)

**The gap:** Memba has the *engine* (reputation realm, StarRating, ReviewsSection, verified flag, moderation primitives, honest fail-closed escrow, correct rel/iframe hygiene) but has connected almost none of it to the marketplace. At the buy moment today a user sees an anonymous address, no reputation, gameable-if-shown reviews, fake agent stars, a text-span external link, a seller-centric fee table with no "you pay" total, and no dispute recourse. Closing the gap is ~70% wiring existing pieces onto listing/detail/modal surfaces and ~30% new work (verified-purchase gating, copymint heuristic, dispute arbiter, slippage UI, interstitial).

**Quick wins (days):** wire ReviewsSection + reputation onto detail pages and cards; show seller/collection address; remove fake agent ratings; build the leaving-Memba interstitial; add "You pay" total; render App Store status chip; show sign-time address/network.
**Deeper rework (weeks):** verified-purchase review gating; seller-level tiers; copymint/impersonation detection; OTC slippage/min-received UI; `escrow_v3` dispute/arbitration; flag-threshold auto-hide + multi-mod.

---

## CTO MUST-FIXES (before shipping the new version)

1. **Close the P0 fund-drain class end-to-end** (guards + enforce flip + restore/recovery drill) — hard gate for any money-path de-gate. Ship a public Security page.
2. **Surface reputation/reviews on every listing + detail + trade modal** — but **only after** adding verified-purchase gating, or you're merchandising gameable trust.
3. **Kill fabricated trust signals now** — remove mock agent stars/verified ticks from any shipped surface.
4. **Real leaving-Memba interstitial** + always-visible counterparty address + copymint/impersonation warning.
5. **Buyer-facing "You pay" total + OTC slippage/min-received**; no anonymous, ambiguous-cost sign flows.
6. **No Services lane without a dispute/refund/arbiter** in `escrow_v3` — binary escrow is a non-starter for stranger-to-stranger freelance.
