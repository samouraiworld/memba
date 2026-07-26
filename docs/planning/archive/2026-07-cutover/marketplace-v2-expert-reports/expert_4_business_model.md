# Expert 4 — Marketplace Business Model / Monetization / Web3 Tokenomics Audit

**Lens:** Is the Memba Marketplace fee model sustainable AND competitive? Unit economics, revenue projections, the "fee flywheel" thesis, FX risk, and a growth-aware monetization strategy for the new version.

**Source of truth verified:** `memba_market_config/config.gno` (fee spine), `admin.gno` (SetFeeBPS, 2-step handoff, no Pause), `render.gno`, `memba_market_core_v2/split.gno` (three-way split), `memba_nft_market_v3_1/market.gno` (resolveFee fail-safe, fee→treasury at buy), `memba_token_otc_v1/otc.gno` (dust-fill guard, exact-coin settlement, fee→treasury).

Confirmed on-chain state: NFT **200bps (2%)**, Service **200bps (2%) release** + 5% cancel→freelancer (escrow-internal), Token **50bps (0.5%)**. `MaxFeeBPS=500` (global 5% ceiling), `DefaultFeeBPS=200`. Agents lane unset → resolves to 2%. All protocol fees → **single DAO treasury** (2-of-2 multisig). Fee is DAO-tunable per lane via `SetFeeBPS` with **no realm redeploy**. Creator royalty 5% (cap 10%) preserved on NFT. All fees denominated + settled in **ugnot (GNOT)**. Zero XP for volume (anti-wash). Confirmed.

---

## TOP FINDINGS (ranked)

### P0-1 — You are optimizing the take rate at GMV ≈ 0. Wrong variable.
**What's wrong:** Revenue = take_rate × GMV × velocity. Services lane is an empty stub (`SERVICES=[]`), Agents is mock, Tokens gated; only NFT is live and "reads as an engineer's admin panel." At cold-start GMV, whether the rate is 2% or 0.5% changes annual treasury revenue by a rounding error. The entire fee debate is deck-chairs until liquidity exists.
**Why it matters (benchmark):** **Blur** understood this — it went **0%** and bribed liquidity with token points, took ~50–70% of Ethereum NFT volume from OpenSea in months, THEN monetized. **OpenSea** charges **0 listing fee** deliberately to not suppress supply. Both prioritized GMV/liquidity over take rate. Memba is doing the opposite: charging a positive rate on lanes with no liquidity, taxing the very supply it needs to attract.
**Recommendation:** Reframe strategy as **GMV-first**. Near-0% intro on the *empty* lanes (Services, Tokens) to bootstrap; keep 2% on the *live* NFT lane (it has traction and OpenSea/Magic-Eden parity). Pre-commit a **transparent fee ratchet** tied to liquidity milestones. The config realm already supports this perfectly (`SetFeeBPS`, per-lane, no redeploy) — the *mechanism* for a ratchet is built; you're just not using it as a growth dial.

### P0-2 — Transaction-fee-ONLY model. No revenue line that survives cold-start.
**What's wrong:** 100% of treasury revenue is a % of GMV. During the 12–24-month bootstrap when GMV is thin AND you're suppressing take rates to attract liquidity, treasury revenue is ~zero. You have USD-denominated costs (Fly, Netlify, dev, audits) and a revenue model that produces nothing until GMV is large.
**Why it matters (benchmark):** Every tier-1 marketplace has **≥2 revenue lines**. **Fiverr:** take rate + Promoted Gigs (ad auction) + Seller Plus subscription. **Etsy:** transaction fee + Offsite Ads + listing fees + Etsy Plus. **Amazon:** referral fee + Sponsored Products (a >$50B/yr ad business, higher margin than the take). Ad/promotion revenue is **countercyclical to cold-start** — sellers pay to be *seen* even when GMV is low.
**Recommendation:** Add **two non-transaction revenue lines now** (see table): (1) **Promoted listings / featured placement** — a GNOT payment to treasury for top-of-lane slot for N blocks; (2) **Launchpad primary fee** — `CreateCollectionLaunchpad` should take a primary-mint cut or flat deploy fee (primary sales are where NFT platforms actually earn vs 2% secondary — cf. Manifold, ThirdWeb). Both route to treasury, both are new-realm/new-field (no `tokenfactory_v2` touch), both monetize seller *intent* independent of GMV.

### P1-1 — The global 5% ceiling permanently caps your highest-margin lane at ¼ of Fiverr.
**What's wrong:** `MaxFeeBPS=500` is a single global constant. NFT (2%) and Token (0.5%) will never need >5% — fine. But **Services** is a freelance lane with a larger TAM than NFT, and **Fiverr takes ~20% seller + ~5.5% buyer ≈ 25% blended**. A 5% hard cap means that even at Fiverr-grade demand and trust, Memba can *never* price the services lane above 5% — leaving ~15–20 points of take rate on the table *forever* on your potential flagship.
**Why it matters:** On-chain marketplaces carry almost none of Fiverr's cost (no Stripe ~3%, no chargebacks, no human arbitration, no escrow float — escrow is a contract). So Memba does NOT need 20% to break even. But the take rate should track the **value delivered (demand + trust)**, and if you ever deliver Fiverr-grade demand, freelancers will *happily* pay 8–15% (still a permanent wedge vs Fiverr). 5% is a self-inflicted ceiling on that upside.
**Recommendation (respecting the hard constraint):** Keep the 5% ceiling for the immediate plan. But **escalate to the CTO/DAO as a governance decision**: make `MaxFeeBPS` **per-lane** (NFT/Token cap 5%; Services cap ~15%). One-line change in `config.gno` (store max per lane in the AVL tree alongside the fee, or a second tree). Do not silently violate — raise it explicitly as the single biggest long-term revenue limiter.

### P1-2 — GNOT denomination = severe treasury asset-liability mismatch.
**What's wrong:** Fees are charged, settled, and held in **ugnot**. Treasury revenue is 100% GNOT-price beta. Your *costs* (Fly, Netlify, salaries, audits) are USD. A GNOT drawdown cuts real treasury runway even at constant GMV. GNOT is a testnet-era, thin-liquidity token — this is far worse than OpenSea/Blur taking fees in deep-liquid ETH.
**Why it matters:** Classic crypto-treasury failure mode (Terra-era DAOs, many NFT platforms): USD liabilities, volatile-token assets, no hedging. Sustainability analysis that assumes GNOT revenue = USD runway is fiction.
**Recommendation:** (a) Adopt a **treasury diversification policy** — periodically convert a % of GNOT fees to a stable/blue-chip once liquidity exists; do NOT plan USD-cost runway off GNOT-denominated treasury. (b) Roadmap a **stablecoin-denominated lane** (once a Gno stable exists) — de-risks both traders and treasury. (c) The OTC lane settles ugnot-only today; note this as the FX chokepoint.

### P1-3 — The "fee flywheel / marketplace-as-treasury-utility" thesis is HALF true.
**What's wrong:** The thesis: N lanes → one treasury → breadth compounds revenue. The **revenue-aggregation mechanic is real** (all fees land in one pot — confirmed: NFT and OTC both send fee to `GetTreasury()`). But **breadth ≠ automatic compounding**. Liquidity begets liquidity *within* a lane, not across — an NFT buyer does not create service demand. Four sub-scale lanes read as *hollow* (brief confirms "feels hollow/cold-start"). Breadth *fragments* focus and treasury capital unless something transfers value across lanes.
**Why it matters:** The only genuine cross-lane compounding vectors are: (1) **shared reputation/identity** (a trusted seller in NFT converts faster in Services), (2) shared treasury funding cross-lane growth, (3) shared discovery/traffic. The brief confirms reviews **exist but are NOT wired into listings** — so the #1 flywheel mechanism is disconnected. Right now breadth is a liability, not a flywheel.
**Recommendation:** **Sequence, don't parallelize.** Get NFT to genuine liquidity + **wire cross-lane reviews/reputation**, THEN light Services at 0% intro, THEN Tokens. Shared reputation is what converts "4 empty lanes" into a compounding treasury. No "coming soon" tabs (brief already enforces — good).

### P2-1 — 0.5% OTC is defensible; not a priority, arguably underpriced.
**What's wrong/right:** Token 0.5% is positioned "vs DEX ~0.3%." But this is **OTC/RFQ** (price certainty, no slippage, no impermanent loss, partial fills with front-run guard) — RFQ desks charge *more* than AMMs precisely because they remove slippage. 0.5% is fine; 0.75–1% would still be competitive given the value. Low priority vs the lanes above. Dust-fill guard (`otc.gno:171`) correctly enforces minimum notional so fee never rounds to 0 — good.

### P2-2 — Anti-wash (zero XP for volume) is correct — protect it as you add mechanisms.
**What's right:** Zero XP for trade volume avoids the **Blur/LooksRare wash-trading disaster** (>90% of LooksRare volume was wash farming its token). Keep it. **Guard:** when you add promoted listings and reputation, ensure *those* can't be wash-farmed either — tie reputation to **completed + reviewed** trades with **counterparty diversity**, never raw volume.

---

## FEE / MONETIZATION RECOMMENDATION TABLE

| Lane / Line | Today | Recommended (new version) | Rationale / benchmark |
|---|---|---|---|
| **NFT (secondary)** | 2% | **Hold 2%** | OpenSea/Magic Eden parity; live lane with traction — don't discount what works. |
| **NFT primary (launchpad)** | none | **Add 5% primary mint fee OR flat GNOT deploy fee → treasury** | Primary is where NFT platforms earn (Manifold/ThirdWeb). Highest-margin missed line. |
| **Services** | 2% release | **0% intro (bootstrap) → ratchet to 8–12%** via `SetFeeBPS` on liquidity milestones | Cold-start supply is fragile; but Fiverr proves freelancers pay 20%+ for demand. Grow the dial. |
| **Services cancel fee** | 5%→freelancer | **Hold** | Correct — compensates freelancer, not protocol. Keep the "→freelancer" framing (never "→DAO"). |
| **Tokens (OTC)** | 0.5% | **0% intro → 0.75–1%** | RFQ value justifies >AMM; but bootstrap liquidity first. |
| **Agents** | unset (→2%) | **Usage/subscription-metered, NOT ad-valorem** — set explicitly | AI/MCP is a usage model, not a sale. Don't let it default to 2% of a "price" that has no meaning. |
| **Promoted listings / featured** | none | **ADD — GNOT boost payment → treasury, per-lane** | Fiverr Promoted Gigs / Amazon Sponsored. Countercyclical, high-margin, GMV-independent. **Top new line.** |
| **Seller tiers / subscription** | none | **DEFER to post-liquidity** (Fiverr Seller Plus $29/mo analog) | Recurring revenue, but needs a pro-seller critical mass first. P2. |
| **Listing fee** | none | **Keep 0 at cold-start**; optional dust anti-spam fee later | OpenSea proves listing fees suppress supply. Don't. |
| **Global fee ceiling** | 5% global | **Make per-lane** (NFT/Token 5%, Services ~15%) — governance decision | 5% permanently caps your biggest-TAM lane at ¼ of Fiverr. |
| **Treasury denomination** | 100% GNOT | **Diversification policy + stable-lane roadmap** | USD costs vs GNOT revenue = asset-liability mismatch. |

---

## UNIT ECONOMICS

**Key insight vs Fiverr/Upwork:** Memba's **marginal cost per transaction ≈ 0**. Gas is paid by the user; settlement/escrow is a smart contract; no Stripe (~3%), no chargebacks, no human dispute arbitration, no escrow float. Every basis point of fee is **~100% gross margin to treasury**. Costs are **FIXED** (indexer on Fly, Netlify, dev, security audits), NOT per-transaction. This is why "2% vs Fiverr's 20%" is apples-to-oranges: Memba doesn't *need* 20% to cover cost — but it also doesn't yet *deliver* the demand that justifies any take rate.

**Revenue at blended ~1.5% take (transaction-only):**

| Annual GMV | Treasury rev @1.5% | Reality check |
|---|---|---|
| $100k (Y1 niche cold-start) | **$1,500** | Below the cost of a *single* security audit. Noise. |
| $1M (Y2 growth) | **$15k** | Below one part-time contractor. |
| $10M (strong) | **$150k** | First meaningful DAO budget (~1 FT eng). |
| $50M (large web3 mktplace) | **$750k** | Funds a small team. Requires real network effects. |

**Conclusion:** Transaction fees alone don't fund a team until GMV is *large* (tens of $M). Two implications: (1) **non-transaction revenue (promoted + launchpad primary) is essential** to fund the bootstrap — it can plausibly out-earn the transaction take for the first 1–2 years; (2) the take rate itself is a **growth dial, not a revenue lever** at current scale — set it to maximize GMV, not to maximize per-trade capture.

**Is 2% "leaving money on the table"?** For NFT: no (at-market). For **Services: yes, massively — but correctly so at cold-start.** The error would be letting 2% ossify as "the Memba rate." Services take must be a ratchet toward 8–12% as demand/trust materialize.

---

## TIER-1 BAR & GAP

**What world-class looks like (business-model lens):**
1. Take rate **calibrated to value delivered** (demand + trust), not a round number.
2. **≥3 revenue lines** (transaction + promotion/ads + subscription/tiers + primary/launch) so revenue survives GMV volatility and cold-start.
3. A **liquidity-bootstrap mechanism** (0% intro or incentives) with a **credible, pre-committed path to monetization** (avoid Blur's "can't ever turn fees on" trap).
4. **Treasury asset-liability management** (don't hold 100% volatile token against USD costs).
5. **Reputation that compounds across surfaces** and can't be wash-farmed.

**Memba's position:** The **fee INFRASTRUCTURE is genuinely tier-1** — per-lane, DAO-tunable, no-redeploy ratchet, single-treasury aggregation, fail-safe reads, bounded ceiling, 2-step admin handoff, dust-fill guard. This is better-engineered than most L1 marketplaces. **The STRATEGY layered on it is one-dimensional:** transaction-fee-only, flat round rates, no promotion/subscription/primary revenue, no ratchet plan in use, no FX policy, reputation disconnected from listings. **The gap is strategy, not code.**

---

## CTO MUST-FIXES (before shipping the new version)

1. **Reframe fees as GMV-first with a pre-committed, public ratchet.** Near-0% intro on empty lanes (Services/Tokens); hold 2% on live NFT. Use `SetFeeBPS` as the growth dial it was built to be. Don't optimize take rate at GMV≈0.
2. **Ship a non-transaction revenue line at launch:** promoted/featured listings (GNOT boost → treasury) + launchpad primary-mint fee. Treasury cannot be 100% hostage to a take rate you're deliberately suppressing.
3. **Wire cross-lane reviews/reputation into listings.** This is the mechanism that makes the breadth flywheel real AND justifies future take-rate increases. Without it, breadth fragments.
4. **Adopt a treasury/FX policy.** GNOT revenue vs USD costs is a real sustainability risk; diversify + roadmap a stable-denominated lane.
5. **Escalate the per-lane fee ceiling as a governance decision.** Global 5% caps Services at ¼ of Fiverr forever — deliberate, respect it now, but put the per-lane-ceiling change on the DAO agenda.
6. **Sequence lanes to minimum-viable liquidity.** NFT → Services → Tokens. Don't ship four sub-scale lanes; a hollow marketplace reads as vaporware.
7. **Set the Agents lane fee model explicitly** (usage/subscription, not the 2% default) before it goes live — a % of a meaningless "price" is wrong.
