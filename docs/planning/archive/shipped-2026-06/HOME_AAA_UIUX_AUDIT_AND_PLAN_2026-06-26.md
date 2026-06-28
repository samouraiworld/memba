# Memba Home — AAA UI/UX Audit & Implementation Plan

**Date:** 2026-06-26 · **Scope:** `/:network/` home page, both **visitor** (non-connected) and **member** (connected) states, both themes · **Target bar:** Revolut / Qonto-grade — stunning, super-intuitive, tier-#1, working perfectly, honest by design · **App version:** memba v4.1.0 (test13)

> Single consolidated plan for this session. Grounds every decision in (a) a live audit of production, (b) the actual codebase, and (c) what data is honestly fetchable on-chain. Built to AAA full-stack-engineering standards: tests, accessibility, both themes, deploy-preview verification, code-review gates, rollback.

---

## ✅ FINAL STATUS — SHIPPED & LIVE IN PRODUCTION (2026-06-26)

The entire plan below was executed and is **live on `memba.samourai.app/test13`**, across 4 squash-merged PRs:

| PR | Scope | Notes |
|----|-------|-------|
| [#584](https://github.com/samouraiworld/memba/pull/584) | The redesign — all 5 side-notes (hover bug, GovDAO split, ecosystem "Top validators"+supply, Launchpad mini-card, feed diversity), **Proposal C editorial hero** + live network proof card, **on-ramp ValueStrip**, **holder counts** | holder counts came free from the GRC20 `Known accounts` render field — no indexer aggregation needed (better than DEC-2's plan) |
| [#589](https://github.com/samouraiworld/memba/pull/589) | P0-A2 page-level halt consistency — `useChainHealth` → NetworkHealthDoor "stalled" / feed "paused" | B1 itself shipped independently via #580 (server-Date approach); this branch kept only the page-consistency layer |
| [#590](https://github.com/samouraiworld/memba/pull/590) | W3 polish — soft elevation shadow on card hover | the lift already existed from a prior wave; only the shadow was missing |
| [#593](https://github.com/samouraiworld/memba/pull/593) | Token **launch dates** — backend `GET /api/token-launches` (cached indexer scan) + Launchpad "launched Xd ago" | proven frontend-infeasible (16–26s scan vs 10s proxy timeout) → built in the backend, **no proto change**; code-review caught + fixed a refresh-flag wedge |

**Deviations from the plan, all for the better:** holder counts via `Known accounts` (not indexer aggregation); B1 deduped against #580; launch dates implemented as a standalone cached HTTP endpoint (no proto regen). **Nothing from the plan remains unshipped.** Full per-PR detail, the concurrent-merge handling (~7 rebases onto moving main), and the live-verification record are in the session memory (`project_memba_home_aaa_uiux_2026_06_26`).

---

## 0. TL;DR — what we're doing and why it's safe

The home page has good **bones** (tokenized two-theme color system, semantic teal=community / gold=GovDAO, JetBrains-Mono "on-chain truth" signature) but reads as a **clean dev tool, not a finished consumer-finance product**. The dominant failure mode across all three expert audits is the **same single root cause: the page does not manage emptiness** — flagship cards (GovDAO, "ecosystem at a glance", Launchpad) sit 60–80% empty at full size, which signals "unfinished" rather than "premium," and quietly violates Memba's own honesty contract ("empty → omit or honest empty state", never stretch).

**The good news (from the feasibility audit):** almost every enrichment the product owner wants is **pure frontend work on data we already fetch** — no backend, no proto regen. The home cards are fed client-side (`useGovDao`, `useEcosystemTokens`, `useEcosystemValidators`, `useRecentActivity`), not by `GetHomeSnapshot` (which only carries counts/summaries). So this is a **low-risk, high-leverage** session.

**Phasing:** Wave 1 = quick wins + the hover bug. Wave 2 = the four structural recompositions (GovDAO split, ecosystem density, Launchpad, activity feed). Wave 3 = AAA polish (depth, motion, type roles). Wave 4 (fast-follow, optional) = indexer-query widening for launch dates / timestamps / event-attr feed rows.

---

## 0b. Plan audit — round 2 (2026-06-26, post-review)

Deep accuracy/safety pass on this plan: **live-endpoint probing + adversarial code verification of every load-bearing claim**. Result: plan is **sound**; four corrections folded in.

1. **🐞 test13 is NOT halted — the "Halted" state is a clock-skew bug (new finding, now B1).** Probed all 4 test13 RPC nodes + indexer live: all at block **478,673**, ~5–7s lag, `catching_up:false`; live prod shows `#478,671 · 10v` with **no halt toast**. Root cause: `networkStatus.ts` derives halt from `Date.now() − blockTime > 300s`, so a client clock ≥5 min fast false-positives "Halted." **Reframes P0-A** from "the page lies during a halt" to "fix the clock-dependent detector" (+ keep page-consistency as P0-A2). Added as a **TDD task in W1**.
2. **GovDAO proposer is best-effort, not guaranteed.** `useGovDao` fetches the full `proposals[]` (✅ no new RPC for the 3–4 preview) but today exposes only `proposals[0]` title+status; proposer is populated only in the v3 list-parse path and **blank for basedao-format** realms. Preview shows title+status+vote% reliably; proposer only when present (widen the hook type).
3. **Platform fee is a hardcoded client constant** (`PLATFORM_FEE_RATE = 0.025`), **not** from `getTokenInfo`. Supply/admin/decimals *are* from `getTokenInfo` (✅).
4. **Holder/buyer counts are feasible after all** (validates DEC-2). Not enumerable via realm *read*, but the realm emits `Transfer`/`Mint`/`Faucet`/`Burn` events → derivable by indexer event-aggregation (needs `response{events}` added to the GraphQL query).

**Verified TRUE without change:** cards are client-fed not snapshot-fed (snapshot is counts-only, gated `SNAPSHOT_NETWORK==="test13"`); `getValidators` sorts by power desc with rank/powerPercent/gnoAddr/profileUrl, moniker `""` (needs `fetchValoperMonikers`, regex `/\*\s+\[([^\]]+)\]\(\/r\/gnops\/valopers:(g1[a-z0-9]+)\)/`); activity feed auto-refetches 60s, classifies 7 kinds from type+pkg_path+func, GraphQL omits `events`/`args`; `DirectoryToken` is `{slug,name,symbol,path}` only; **token price genuinely does not exist** (no AMM — hard omit). The gnoweb hyphen-username (#5655) and valopers-revert (#5845) risks stand — smoke-test the moniker regex post-redeploy.

**Design preview:** 3 home-redesign proposals rendered this session (Claude Design widget) — **A Refined** (keep IA, fix density), **B Control Room** (bento, data-dense), **C Editorial** (spacious, premium) — each showing the GovDAO split, compact ecosystem (Latest tokens ≤3 / Top validators ≤3), richer Launchpad, and diversified feed. Await user's pick to set the W2/W3 visual direction.

---

## 1. Current state & live context

| Fact | Detail | Implication |
|---|---|---|
| Live URL | `https://memba.samourai.app/test13/` | audited via prod + deploy-preview screenshots |
| **test13 is LIVE & healthy** (verified 2026-06-26 15:05Z) | RPC + indexer both at block **478,673**, ~5–7s behind wall-clock, `catching_up:false`, all 4 nodes current; live prod shows `#478,671 · 10v`, **no halt toast**. The "Halted · 1h ago" in the Jun-25 screenshot was a **past** state, not current. | **The "Halted" reading is a clock-skew bug, not a real halt** (see B1 in §3.1). Deploy-preview verification works against the live chain. |
| Home data path | client-side hooks, **not** `GetHomeSnapshot` | enrichments are frontend-only; no backend/proto regen |
| Working branch now | `chore/reviews-enable-flag` (unrelated reviews-flag work) | **all home work branches fresh from `main`** |
| Design system | `docs/DESIGN_SYSTEM.md` — tokens only, two themes, WCAG AA, teal/gold semantics, honesty contract | every change routes through these rules |
| CI guardrail | light-theme hardcoded-color scan in `ci.yml` (§13) | no new hardcoded colors; tokens only |

### Home structure (as built today)
- **Entry:** `pages/Home.tsx` branches `mode="visitor"` vs `"member"` (from `adena.connected`).
- **Visitor:** `StatusStrip` → `VisitorHero` → `GovDaoSpotlight` (gold, "Monitor governance") → `ShowcaseBoard` 4 doors (Contributors / NetworkHealth / Directory / Launchpad) → `BelowFold`: `EcosystemBand` ("ecosystem at a glance": tokens + validators) → `ExploreGrid` (6 tiles) → `ActivityFeed` ("live across gno.land") → `ComingSoon`.
- **Member adds:** `WalletChips` (balance/address) → `ActionInbox` ("Act now": vote/sign/candidature/claim) → `YourWorldsPanel` ("Your organisations").

---

## 2. Upstream / breaking-change analysis (Gno ecosystem)

All Samourai repos are at `origin/main` (0 behind). Only **gno core** (`origin/master`) has new activity since the last Memba work. None are hard home-page breakers (Memba's deployed realm paths on test13 are immutable), but three to **watch & smoke-test** when test13 next redeploys:

| gno PR | What | Risk to home | Action |
|---|---|---|---|
| **#5655** gnoweb: find usernames with hyphens | username/profile resolution for hyphenated handles | **Low–Med** — affects `resolveUsername` (admin/proposer @handles) and valoper profile links | re-verify @handle resolution on a hyphenated test account |
| **#5845** revert valopers technical questions | changes `r/gnops/valopers` Render layout | **Low** — `fetchValoperMonikers` parses Render with a brittle regex `* [Moniker](/r/gnops/valopers:g1…)` | live smoke-test the moniker parse after the revert lands on test13 |
| **#5857 / #5858** event attr-len cap (1024→4096, then hard-cap panic) | realm event emission | **None for home** (read-only); relevant only if we redeploy realms emitting long attrs | note for realm side |

> The activity feed, govdao reads, validator reads, and token reads all depend on **tx-indexer GraphQL** (`indexer.test13.testnets.gno.land`) and **abci_query** wire format — both stable on test13. No schema change observed.

---

## 3. Consolidated expert findings (prioritized)

Synthesis of three independent audits: **Visual/Brand** (Revolut/Qonto lens), **UX/IA/Interaction**, **Data-Feasibility**. Severity: **P0** blocker · **P1** high-leverage · **P2** worth doing · **polish**.

### 3.1 — P0 (fix first; first-impression failures)
- **P0-A / B1 · Halt detection is a clock-skew false-positive bug (CONFIRMED root cause).** `lib/networkStatus.ts:49` computes `blockAge = Math.floor((Date.now() − latestBlockTime)/1000)` and flags `halted` at `>300s` (`:21,52`). This depends entirely on the **client's wall clock**: any browser running ≥5 min fast falsely reports "🔴 Halted · Nh ago" via `NetworkStatusToast` even though test13 is live (verified live: block advancing, all 4 RPC nodes current, 5–7s lag). The Jun-25 "Halted" screenshot was either a real past halt or exactly this skew. **Fix (B1):** make halt detection **clock-independent** — track `latest_block_height` across successive 60s polls; report `halted` only when height has **not advanced** over N consecutive polls (the node also exposes `catching_up`). Keep `blockAge`/`formatBlockAge` for *display* only; add a guard so a negative or implausibly-large `blockAge` with an *advancing* height is treated as healthy. Files: `lib/networkStatus.ts`, `components/ui/NetworkStatusToast.tsx`, `components/ui/ChainHaltedBanner.tsx`. Add a unit test that feeds advancing-height + skewed clock → expects `healthy` (regression guard).
- **P0-A2 · Page-level consistency on a *real* halt.** Separate from B1: when the chain genuinely stalls, the page should tell one story. Single source of truth in `StatusStrip` → a `degraded` flag consumed by `NetworkHealthDoor` ("network stalled", not "10/10 healthy") and `ActivityFeed` ("feed paused — chain stalled"). Prefer an inline `--color-k-amber` status in the strip over a floating red toast; reserve red/danger for destructive states. (Lower urgency than B1 since the chain is currently live, but ships in the same `networkStatus` change.)
- **P0-B · No on-ramp for a non-crypto-native.** Hero ("Run your DAO. Own your stack.") drops straight into GovDAO "constitution", validator power %, and `gno.land/r/...` paths. **Fix:** one plain-language value strip between hero and GovDAO — three human-verb cards: *Join a community & vote · Launch a token · Track the network* — linking to existing destinations.
- **P0-C · Emptiness at full card size (cross-cutting).** GovDAO right half, "ecosystem at a glance" cards, Launchpad, and the empty "top contributors" card all stretch to full size around one line of data. **This is the headline fix** and is addressed structurally in Wave 2. Principle: when data is thin → **shrink / merge / honest empty-state**, never stretch.

### 3.2 — P1 (the four structural recompositions + brand)
- **P1-1 · GovDAO card — recompose into left rail + right "latest governance" preview** (side-note #2). Data already in `useGovDao.proposals`.
- **P1-2 · "ecosystem at a glance" — reduce height, "Latest tokens" (≤3) + "Top validators" (≤3)** (side-note #3).
- **P1-3 · Launchpad — living mini token card** with the honest subset of supply/admin/created (side-note #4).
- **P1-4 · Activity feed — diversify, humanize, de-dup, filter** (side-note #5).
- **P1-5 · Type roles + depth.** Mono is overused as default → split roles: **sans** for headings/body/CTAs, **mono only** for on-chain truth (addresses, hashes, heights, status, eyebrows). Establish a real type scale; big stats use `tabular-nums`. Widen dark-theme elevation (bg→panel→elevated) + 1px top highlight + soft shadow so it stops reading as one flat plane.
- **P1-6 · Secondary CTA "Install Adena" near-invisible on dark** (black-on-near-black) → ghost button with `--color-k-edge` outline + teal text (fails the design system's own ≥3:1 border rule today).

### 3.3 — P2 / polish
- **P2-1 · Nav redundancy.** Tokens/Directory/Validators/Gnolove/Quests each appear ~3× (sidebar + doors + explore-grid). Give each surface a distinct job: sidebar = app nav; **ShowcaseBoard = live windows only** (real-time data); **ExploreGrid = the flat "all destinations" tray**. De-dupe. *(Bigger refactor — schedule after Wave 2 settles which surfaces survive.)*
- **P2-2 · "Coming soon" eats premium below-fold real estate** with 3 vaporware cards → collapse to a slim "On the roadmap: NFTs · Services · Agents" line.
- **P2-3 · Microcopy/casing inconsistency**; qualify every count with noun+scope ("GovDAO · 1 member", "294 people in the directory").
- **P2-4 · Connected-but-empty can feel like a downgrade** — keep the ecosystem feed + a "discover DAOs" rail visible so "all caught up" reads as *calm*, not *abandonment*.
- **polish:** eyebrow consistency (one token, uniform tracking); one separator glyph; distinct activity icons per kind; skeleton min-heights to kill layout shift; live block-height ticker; card hover lift; `prefers-reduced-motion` respected; `メンバー` wordmark fallback-font crispness + tooltip; light-theme feed icon saturation bump.

---

## 4. Data-availability matrix (the honesty line — non-negotiable)

What the redesign may show, and where it comes from. **Omit, never fake.**

| Ask (side-note) | Verdict | Source / call | Effort | Honesty note |
|---|---|---|---|---|
| Token: symbol, name, decimals, **supply**, **admin addr**, faucet | **AVAILABLE NOW** | `getTokenInfo()` (`lib/grc20.ts`) / `qeval TotalSupply` | S | per-token ABCI read; cache (5-min cache exists) |
| Token: platform fee (2.5%) | **AVAILABLE NOW (client constant)** | `PLATFORM_FEE_RATE = 0.025` (`lib/grc20.ts:16`) — **NOT** from `getTokenInfo` (corrected) | XS | hardcoded constant; also on realm HOME render |
| Token: **admin name** (@handle) | FRONTEND | resolve admin g1 via `resolveUsername` | S | fall back to truncated addr |
| Token: **launch date** | INDEXER (Wave 4) | tx-indexer: find `New`/`NewWithAdmin` tx → block→time | M | **omit if not found**; not stored on-chain |
| Token: **# buyers / holders** | **NEEDS-INDEXER (feasible — DEC-2)** | not enumerable via realm *read*, **but derivable** by aggregating emitted `Transfer`/`Mint`/`Faucet`/`Burn` events (`tokenfactory.gno`) through the tx-indexer | L | DEC-2 funds this; approximate (unique recipient set); current GraphQL must add `response{events}` |
| Token: **price** | **OMIT** | no AMM/oracle — tokens have no price | — | **must omit** |
| Token: 3 latest activities | FRONTEND | indexer filter on `tokenfactory_v2` (basic) / event-attrs need query widening | S / M | — |
| **Top-3 validators**: power %, rank, addr, profile link | **AVAILABLE NOW** | `getValidators()` already sorts by power desc | S | slice top-3 |
| Validators: **monikers** | FRONTEND | `fetchValoperMonikers()` (1 cached call) | S | fall back to truncated addr; **watch gno #5845** |
| Validators: uptime/health | **OMIT on home** | needs gnomonitoring (~100 calls) — `useEcosystemValidators` deliberately skips it | L | render "Active" honestly; no uptime |
| **GovDAO: 3–4 latest** (title + status) | **AVAILABLE NOW — already fetched** | `useGovDao` already pulls full `proposals[]` (sorted id-desc); today the hook only surfaces `proposals[0]` as `latestProposal` (title+status) | S | widen `GovDaoLatestProposal`→array; **no new RPC** |
| GovDAO: proposer per row | **BEST-EFFORT (corrected)** | populated in v3 list-parse (`proposals.ts`), but **blank for basedao-format** realms and shows raw `g1…` when no username | S | render only when present; don't promise it |
| GovDAO: per-proposal timestamps | INDEXER (Wave 4) | block→time per proposal | M | omit when absent |
| Activity: DAO-creation / NFT / post / multisig / token-launch classes + de-dup | FRONTEND | refine `classifyCall`/`mapMessage` in `lib/activity.ts` (wire already carries `pkg_path`+`func`) | S–M | — |
| Activity: event-attr / args-enriched rows | INDEXER (Wave 4) | widen GraphQL selection to request `events{}` / `args` | M | payload/perf risk on chain-wide window |

**Bottom line:** the high-value asks ship **frontend-only, S–M, no backend**. Hold the honesty line on **price, buyers/holders, uptime** (omit), and treat **launch dates / proposal timestamps / event-attr feed rows** as Wave-4 indexer work.

---

## 5. The redesign — section by section (maps every side-note)

### 5.1 Side-note #1 — "Monitor governance" hover color bug (Wave 1, XS)
**Root cause (confirmed):** global `index.css:213` `a:hover { color: var(--color-k-accent-hover, #00e6bb) }` (teal/green) leaks onto the GovDAO `<Link className="govdao-spotlight__cta">`, which sets a base `color` but **no `:hover` color** → hover flips to green.
**Fix:** add an explicit `.govdao-spotlight__cta:hover` (and `:focus-visible`) `color` so the global teal never wins.
**⚠ Design decision (DEC-1):** the user wants hover text **white in dark / black in light**. But the button background is **gold** — **white-on-gold ≈1.6:1, fails WCAG AA**. Options:
- **(A — recommended, "smarter CTO"):** restyle the CTA as a **gold-outline ghost button** (transparent fill, gold border, theme-aware text: near-white in dark / near-black in light) — then white/black text is legible AND matches the requested intent, and hover just darkens/tints the fill. Removes the contrast problem entirely.
- **(B):** keep the solid gold button but fix hover to the legible dark-on-gold (`--color-k-on-govdao`) — safest contrast, but doesn't honor "white in dark" literally.
- **(C):** honor literally (white/dark, black/light on solid gold) — accepts sub-AA contrast in dark.
→ **Plan recommends (A).** Flagged for user confirmation before implementation.

### 5.2 Side-note #2 — GovDAO card split (Wave 2, M)
Recompose `GovDaoSpotlight` into two columns:
- **Left rail (~40%, keep):** eyebrow `★ layer 1 · core governance` → `GovDAO` title → one-line description → CTA + a *contextualized* stat (`GovDAO · 1 member · L1 multisig`, or replace with live "N open proposals" which reads as activity not emptiness).
- **Right (new, fills the dead half):** **"latest governance" mini-list, 3–4 lines**, fed by `useGovDao.proposals` (top 3–4, newest-first):
  - each line: `status-dot · proposal title (1-line truncate)` (+ proposer @handle **only when present** — corrected: not exposed by the hook today, blank for basedao-format realms; widen `GovDaoLatestProposal` to carry it) (+ vote % only when non-zero, + relative age only when present).
  - status dot color reuses existing `--status` classes (gold/teal/danger family).
  - each line links to the specific proposal; existing "Monitor governance" CTA stays as catch-all; a `view all proposals →` anchors the previously-empty bottom-right.
  - honest states: 0 proposals → one line "No proposals yet" (not 3 perpetual skeletons); RPC error → existing retry.
**Hook change:** widen `GovDaoResult.latestProposal` → `latestProposals: GovDaoLatestProposal[]` (title/status/proposer/[yes%/no%]/[age]). **No new RPC call.**

### 5.3 Side-note #3 — "ecosystem at a glance" density (Wave 2, M)
`EcosystemBand`:
- **Tokens card → "Latest tokens", ≤3 rows.** Header is a small count chip, not a giant hero number. Each row: `ticker · name · supply` (supply via `getTokenInfo`, ≤3 cheap reads). Add `created` only in Wave 4 (indexer). **Do not render "—" placeholders** for unavailable fields. Until `createdAt` exists, label "tokens" (registry order), not "latest" (don't imply an order we don't have).
- **Validators card → "Top validators", ≤3 rows.** Relabel header from bare count to **"Top validators"**; slice `getValidators()` top-3; each row `moniker · {power}% · active` + status dot; keep `view all N →`. Add monikers via `fetchValoperMonikers` (1 cached call; fall back to truncated addr).
- **Equalize card height** to one `ShowcaseBoard` door; count becomes a header chip, the 3 rows are the body. Kill the oversized hero count.
- **De-dupe the double token count** (Launchpad door AND ecosystem both say "1"): consolidate.

### 5.4 Side-note #4 — Launchpad card enrichment (Wave 2, M)
`LaunchpadDoor` → **living mini token card** (newest token):
- headline `name · ticker` → 2-up honest stat grid (`supply` · admin/creator) → footer `by {admin} · N tokens total`. Whole card links to `/tokens`.
- **Honesty:** `supply` + `admin` are AVAILABLE NOW; **`# buyers` and `price` are OMITTED** (not on-chain — see DEC-2); `launch date` is Wave-4 (indexer). When only the count is known (today's halted/low-data state), **keep the existing promo fallback** ("Launch a token in minutes") — it's a *better* visitor experience than "1 token created".

### 5.5 Side-note #5 — "Live across gno.land" feed (Wave 2, M; Wave 4 for attrs)
`lib/activity.ts` + `ActivityFeed.tsx`. It already auto-updates (`refetchInterval: 60_000`). The problem is monotony ("10× Approve · governance/govgraph +12 more" reads like a stuck loop) and flat, jargon titles.
**Frontend-only fixes (no indexer change):**
1. **Diversify, don't truncate:** per-kind / per-realm round-robin cap so no single realm/func exceeds ~2–3 of the visible 12 → surfaces deploys, transfers, token launches currently crowded out.
2. **Richer classification:** distinguish **DAO creation** (`MsgAddPackage` matching dao patterns), **token launch** (`func New`/`NewWithAdmin` on tokenfactory), **NFT** (memba_nft/collections paths), **on-chain posts** (boards/social realms), **multisig executions** (Memba multisig paths / `Execute`).
3. **Humanize titles, verb-first** with kind badge+icon (icons already exist): `Vote approved · govgraph` / `Token launched · ZENTOSHI` / `Realm deployed · r/demo/foo` / `1,000 GNOT sent`.
4. **Collapse repetition inter-tx:** group consecutive same-(kind,func,pkgPath) into one row "12 governance votes on govgraph · 5m" (extend the existing `extraCount` mechanism).
5. **Filter chips** above the feed: All · Governance · Tokens · Deploys · Transfers (toggle, cheap, big scannability win).
6. **Alive cues:** "new" highlight on rows since last poll; ticking relative time; on halt → "feed paused — chain stalled" (ties to P0-A).
**Wave 4 (indexer):** request `response{events{... on GnoEvent{type attrs{key value}}}}` + `MsgCall{args}` to enrich titles with supply/amount/subject ("Launched $FOO · 10,000 supply").

### 5.6 Brand/visual layer (Wave 3, M)
Hero display-scale headline + a live "proof" mini-card on the dead right half of the hero; type-role split (sans headings / mono on-chain truth) + locked type scale + `tabular-nums` stats; dark-theme elevation depth (+1px top highlight, soft shadows); ghost secondary CTA; eyebrow consistency; live block-height ticker; card hover lift; coherent per-kind iconography; skeleton min-heights.

---

## 6. Phasing & PRs

Each wave = its own branch off `main`, its own PR, its own deploy-preview verification (light **and** dark), its own code-review pass. Admin-squash-merge only after CI green **and explicit user approval** (never auto-merge).

| Wave | Theme | Tasks | Effort | Backend? |
|---|---|---|---|---|
| **W1 — Quick wins & truth** | hover bug, P0 halted-state, P0 on-ramp, secondary CTA, eyebrow/microcopy, skeleton min-heights | 5.1, P0-A, P0-B, P1-6, polish | S each | none |
| **W2 — Structural recompositions** | GovDAO split, ecosystem density, Launchpad, activity feed | 5.2, 5.3, 5.4, 5.5 (frontend) | M each | none |
| **W3 — AAA polish** | type roles + scale, depth/elevation, hero proof-card, motion, iconography | 5.6 | M | none |
| **W4 — Indexer enrichment (fast-follow, optional)** | token launch dates, GovDAO timestamps, event-attr/args feed rows | 5.5 (attrs), launch date, timestamps | M | indexer query widening (frontend GraphQL) |
| **W5 — Nav de-dup (optional, post-W2)** | ShowcaseBoard vs ExploreGrid vs sidebar | P2-1 | M | none |

**LOCKED this-session scope (see §10):** **W1 + W2 + W4-indexer + W3** — quick wins/P0, the four structural recompositions, the indexer enrichment (holder counts per DEC-2 + launch dates + proposal timestamps + event-attr feed rows), then AAA polish. **W5 nav de-dup deferred.** Note: DEC-2 means W4's indexer work is **in scope**, so it is no longer optional.

---

## 7. Per-wave task detail (files · approach · acceptance)

> Every task: TDD where logic exists (parsers, classifiers, hooks → unit tests first); presentation verified on deploy-preview in both themes; honesty-contract checked (no fabricated/`—` data); no hardcoded colors (tokens only, CI scan green).

### W1
| Task | Files | Acceptance |
|---|---|---|
| Hover fix (DEC-1) | `home.css` `.govdao-spotlight__cta:hover/:focus-visible`; possibly markup if going ghost-button (A) | hover/focus text never green; legible both themes; WCAG ≥4.5:1 (option A/B) |
| **Halt-detection clock-skew fix (B1)** | `lib/networkStatus.ts` (height-progression detection, not `Date.now()`), `NetworkStatusToast.tsx`, `ChainHaltedBanner.tsx` | **TDD**: advancing-height + skewed-clock → `healthy`; halted only when height flat over N polls; `blockAge` display-only; live test13 must read healthy |
| Page-level halt consistency (P0-A2) | `StatusStrip.tsx` (single `degraded` source) → `NetworkHealthDoor.tsx`, `ActivityFeed.tsx`; repurpose toast | on a *real* halt: strip shows amber, door "stalled" not "healthy", feed "paused"; no floating red alarm |
| On-ramp strip (P0-B) | new `components/home/ValueStrip.tsx` + `Home.tsx` visitor branch | 3 human-verb cards between hero & GovDAO; links resolve; omitted in member mode |
| Secondary CTA (P1-6) | `VisitorHero.tsx` + `home.css` | ghost outline ≥3:1 on dark; teal text; both themes |
| Eyebrow/microcopy/skeleton polish | `home.css`, affected components | one eyebrow token+tracking; counts qualified; reserved min-heights (no layout shift) |

### W2
| Task | Files | Acceptance |
|---|---|---|
| GovDAO split (5.2) | `GovDaoSpotlight.tsx`, `useGovDao.ts` (`latestProposals[]`), `home.css` | right half shows 3–4 real proposals (title/status/proposer); per-line links; honest 0/error states; **no new RPC**; both themes; no dead space |
| Ecosystem density (5.3) | `EcosystemBand.tsx`, `useEcosystemTokens.ts`/`useEcosystemValidators.ts`, `lib/grc20.ts` (supply), `lib/validators.ts` (`fetchValoperMonikers`), `home.css` | tokens ≤3 rows w/ supply; "Top validators" ≤3 w/ monikers+power%; equal height; no "—" placeholders; double-count removed |
| Launchpad (5.4) | `LaunchpadDoor.tsx`, `lib/grc20.ts`, `lib/directory.ts` (extend `DirectoryToken`/`TokenInfo` types) | newest token name/ticker/supply/admin; **buyers/price omitted**; promo fallback when low-data; links to `/tokens` |
| Activity feed (5.5 frontend) | `lib/activity.ts` (classify/diversify/group/humanize), `ActivityFeed.tsx` (filter chips, alive cues) | no single realm >~3 of 12; verb-first humanized titles; grouped repeats; filter chips work; halt→"paused"; **unit tests** for classifier/grouping/round-robin |

### W3 / W4 / W5
- **W3:** `index.css`/`tokens.css` (type scale, elevation tokens, `tabular-nums`), `VisitorHero.tsx` (proof card), motion utilities (respect `prefers-reduced-motion`), icon set. Acceptance: type-role split applied; dark depth visible; hero proof-card live; hover/entrance motion; reduced-motion honored; AA maintained.
- **W4:** `lib/activity.ts` + `lib/dao/proposals.ts` + token read — widen GraphQL selections; acceptance: launch dates/timestamps shown only when resolved, else omitted; payload size measured; perf acceptable.
- **W5:** `ShowcaseBoard.tsx`, `ExploreGrid.tsx`, `ComingSoon.tsx` — de-dup surfaces; acceptance: each destination appears once with a clear job; fold height reduced.

---

## 8. Review, verification & FSE standards (by design)

**Pre-implementation (this session):** ✅ multi-perspective expert audit done (visual / UX / feasibility) — per planning preference (audit before AND after).

**During implementation — every task:**
1. **TDD for logic** — activity classifier/diversifier/grouping, `useGovDao` `latestProposals` mapping, token-info parsing: write failing unit tests first (Vitest). Run via `npm run build` + `npm test` (note: `tsc --noEmit` is a no-op here — use `npm run build`).
2. **Honesty-contract check** — no fabricated values; no `—` placeholders for unavailable fields; empty → omit/honest-state; thin data → shrink/merge, never stretch.
3. **Tokens only** — zero hardcoded colors; add tokens to **both** `:root` and `[data-theme="light"]`; CI light-theme contrast scan green.
4. **Both themes, deploy-preview** — local serves stale CSS; verify on `deploy-preview-<PR>--memba-multisig.netlify.app` in **dark and light** via Playwright (screenshots in PR). Because **prod test13 is halted**, verify data-rich states against the preview/live-chain path, and verify halted-state handling explicitly.
5. **Accessibility** — WCAG AA (≥4.5:1 text, ≥3:1 large/borders); keyboard focus-visible on new interactive rows/chips/links; `aria-hidden` on decorative skeletons; `prefers-reduced-motion` for W3 motion.
6. **E2E** — extend existing Playwright specs (home visitor/member, mobile baselines already exist); add cases for GovDAO preview rows, top-validators, feed filter/diversity, halted-state messaging. Keep desktop intact.
7. **Code review** — run a `code-reviewer` agent pass per PR (bugs, silent failures, type design) + self-review; address findings before requesting merge.
8. **Perf** — watch N+1 token reads (cap Launchpad/ecosystem to ≤3–6, lean on the 5-min cache); measure feed payload if W4 widens the query.

**Merge gate:** CI green **AND** explicit user approval (admin-squash `gh pr merge --admin`, 1-review gate). **Never merge without explicit approval**, even green. Branch from `main`; `cd` into the worktree before commit (hook checks cwd branch). **No Claude attribution** anywhere.

**Post-implementation:** second expert audit pass (visual + UX) against the deploy-preview before final merge — closes the "audit after" half of the planning preference.

---

## 9. Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Halted test13 makes data-rich verification hard | High (now) | verify on live-chain deploy-preview; explicitly test halted-state code paths; don't block on prod data |
| N+1 ABCI reads for token enrichment | Med | cap to ≤3–6 tokens on home; reuse 5-min cache; never fan out the full directory on home |
| gno #5845 changes valopers Render → moniker parse breaks | Low | fall back to truncated addr (already the failure mode); smoke-test after redeploy |
| Over-fetching / feed payload bloat (W4) | Med | keep W4 optional; measure payload; cap window |
| Light-theme regressions | Med | CI contrast scan + per-PR both-theme Playwright; tokens only |
| Scope creep into nav refactor (W5) | Med | W5 explicitly deferred; W1–W2 are self-contained |
| Breaking member-mode while editing visitor | Low | both branches tested; E2E covers both; honesty/degrade per component |
| **Wrong branch / reviews-flag entanglement** | Low | branch fresh from `main`, not from `chore/reviews-enable-flag` |
| **Rollback** | — | each wave is an isolated PR; revert the squash commit; no migrations/proto changes in W1–W3/W5 |

---

## 10. Decisions — LOCKED (2026-06-26)

- **DEC-1 — GovDAO hover style → (A) gold-outline ghost button.** ✅ Restyle the CTA as transparent fill + gold border, theme-aware near-white (dark) / near-black (light) text; hover tints the fill. Honors your intent, passes WCAG, kills the green leak.
- **DEC-2 — Launchpad buyers/holders → FUND the indexer aggregation.** ✅ Build an indexer-side aggregation to derive holder/buyer counts (approximated from transfer/mint events on the token realm). **Token price stays OMITTED** (no AMM/oracle exists — impossible, not a choice). This pulls the indexer work (W4) **into this session's scope**.
- **DEC-3 — Scope → W1 + W2 + W3.** ✅ Quick wins + P0 fixes, the 4 structural recompositions, AND the AAA polish layer (type roles, depth, hero proof-card, motion). Combined with DEC-2, effective scope is **W1–W4** (W4 = indexer enrichment: holder counts + launch dates + GovDAO timestamps + event-attr feed rows). **W5 nav de-dup remains optional/deferred.**
- **DEC-4 — On-ramp value strip (P0-B) → YES, add it.** ✅ Visitor-only: 3 human-verb cards (*Join a community & vote · Launch a token · Track the network*) between hero and GovDAO.

- **DEC-5 — Visual direction → PENDING user pick.** 3 proposals previewed (Claude Design): **A Refined** (lowest risk, keeps current IA, just fixes density — recommended for a first pass), **B Control Room** (bento, data-dense, most Revolut-like), **C Editorial** (spacious, premium, most Qonto-like). The pick sets W2/W3 layout; the data wiring (W2/W4) is identical across all three. → **Awaiting choice.**

### Locked execution order
**W1** (truth + quick wins) → **W2** (structural recompositions, frontend) → **W4-indexer** (holder counts, launch dates, proposal timestamps, event-attr feed rows — unblocks the rich Launchpad/tokens/feed) → **W3** (AAA polish: type roles, depth, hero proof-card, motion). W2 ships its honest "available-now" subset first; W4 then upgrades the same cards with indexer data behind honest "omit-when-absent" guards. W5 (nav de-dup) deferred.

---

## 11. Out of scope / explicit non-goals (this session)
- Backend / proto / `GetHomeSnapshot` changes (not needed for W1–W3).
- Buyer/holder counts, token price (not on-chain — omit).
- Validator uptime on home (too expensive).
- Mobile AAA Phase 2 (tracked separately).
- Reviews-flag / `chore/reviews-enable-flag` work (unrelated; do not entangle).
- NFT/Services/Agents activation (gated off).

---

### Appendix — key files
- `pages/Home.tsx` · `components/home/{StatusStrip,VisitorHero,GovDaoSpotlight,ShowcaseBoard,EcosystemBand,ExploreGrid,ActivityFeed,ComingSoon}.tsx`
- `components/home/doors/LaunchpadDoor.tsx` · `components/home/panels/YourWorldsPanel.tsx`
- `hooks/home/{useGovDao,useEcosystemTokens,useEcosystemValidators,useRecentActivity,useNetworkPulse}.ts`
- `lib/{activity,directory,validators,grc20}.ts` · `lib/dao/{proposals,shared}.ts`
- `components/home/home.css` · `index.css` (global `a:hover` at :213, tokens) · `tokens.css` · `mobile-tokens.css`
- `docs/DESIGN_SYSTEM.md` · `docs/planning/HOME_AAA_REDESIGN_AND_AUDIT_PLAN_2026-06-25.md` (§13)
