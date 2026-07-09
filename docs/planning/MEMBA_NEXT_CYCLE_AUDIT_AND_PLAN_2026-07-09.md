# Memba Next-Cycle Audit & Implementation Plan — 2026-07-09

> **Status: DRAFT — owner review pending. NOTHING from §5 is coded.**
> Built per the kickoff ritual in `BACKLOG_NOTES_2026-07-09.md`: every one of the 16 owner
> items (plus all open carry-overs) was investigated at HEAD `1d6baea` by a 12-lane
> multi-perspective audit (App Store, Home, Feed, Marketplace, Blog, Docs, Mobile+Themes,
> Performance, Security, DAO+Multisig, Feature Matrix, Games/Carry-overs), findings
> spot-verified, then consolidated here. Evidence anchors are `file:line` at HEAD — they
> drift; re-verify before coding.

---

## 1) Verified real state at HEAD (2026-07-09)

- **Mains green**: Memba `1d6baea`, samcrew-deployer `1867a49` (#74), gnomonitoring `0ed8fc7` (#116).
- **Draft #851 (marketplace-v2)**: 17/17 checks green, refreshed with main same day, effectively
  dark (one benign non-gated change: tab icons emoji→Phosphor). Awaiting owner merge decision (D1).
- **App Store B3 (submit money-path)**: the parallel session did NOT land — its worktree
  (`memba-wt-b3-submit`) holds uncommitted test scaffolding only; no commits, no PR (D6).
- **Corrections to prior session memory, verified firsthand:**
  - `memba_feed_v1` **is deployed** (deployer `deploy.sh:203-205`); feed is code-mature, flag-off.
  - The #780 unfurl XSS surface is **mitigated** (SSRF stack, signed image proxy, SVG rejected,
    CSP none — `link_preview.go:78-122,228-235`).
  - `METRICS_BEARER` exposure is **closed** (#766, `/metrics` fail-closed when unset).
  - Blog has **12** articles, not 9.
  - Perf W1.4 (feed reply-count denormalization) **shipped** despite the plan doc marking it pending.
  - Marketplace plan doc's "Phase 8 all pending" header is stale: 8.1 e2e (5 tests) + 8.3 docs +
    funnel instrumentation are on the branch; genuinely open = 8.2 perf polish + 8.4 cutover flip.
- **Still-open env posture**: `QUEST_ADMIN_ADDRESSES` unset in prod (warning-only; falls back to
  baked-in default admin — owner should set it).
- **Quests headline gaps unchanged since Jun-26 audit**: Q-01 badges never auto-mint (drain is a
  manual CLI, `cmd/badge-mint`), Q-02 only 6 on-chain verifier cases (uncovered types return false).

### Owner-ceremony queue (unchanged, NOT part of this plan's coding scope)
gnomonitoring VPS deploy (then verify `/Participation?chain=test-13` names) · `REALM=` deploys:
`memba_nft_market_v3_2`, `memba_blog_v1` (+AddEditor+republish), `memba_appstore_v3` (+seed
migration) · Space Invaders register script (`samcrew-appstore-register-space-invaders.sh test13`) ·
mainnet exec per `MAINNET_READINESS.md` · `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` flip (see D4).

---

## 2) Owner decisions required

| # | Decision | Recommendation |
|---|---|---|
| **D1** | Merge draft **#851** now vs keep rebasing | **Merge.** Green, dark (flag off), stops rebase churn; only visible change is nicer tab icons. Cutover flip stays a separate later decision. |
| **D2** | **W1.5 indexer split** | **Option A — stay in-process.** A separate Fly machine is architecturally blocked by single-file SQLite + Litestream single-writer. Ship the real fix instead: `recover()` wrappers on the 3 indexer goroutines (a panic currently kills RPC) + connection budgeting. Revisit split only with a future DB migration. |
| **D3** | **Docs deletions** — approve the delete list (§4.7): 14 tracked files (10 high-confidence + 4 handoffs), 2 more after one-line reference edits, 38 local git-ignored scratch files | Approve; everything else stays KEEP/ARCHIVE/UPDATE per the inventory. |
| **D4** | **Sig-verify enforce flip** (owner-only, unchanged) | Flip only when: `curl -s -H "Authorization: Bearer $METRICS_BEARER" <app>/metrics | grep memba_multisig_sig_verify_sweep` shows `{result="mismatch"} 0` (ignore `legacy_shape`). Related product question W4: should broadcast require *verified*≥threshold instead of *submitted*≥threshold once enforce is on? |
| **D5** | **Feed fork**: discourse-first vs media-first (drives Wave F ordering; media is L and needs the CID serving-blocklist + moderation board first) | Discourse-first: ship the S-cluster polish + reposts now; media after the moderation gate. |
| **D6** | **B3 submit money-path**: the parallel session left only test scaffolding. Adopt/restart it in this cycle (Wave A) or wait for that session? | Restart it cleanly in Wave A (it's on the critical path of App Store items). |
| **D7** | **Arcade leaderboard realm** (`memba_arcade_leaderboard_v1`) — greenlight as the games/viral centerpiece? | Yes — spec locked in the SI plan §7.3; unlocks certified scores + share loops for both built games. |
| **D8** | **AI Analyst flag** (`VITE_ENABLE_ANALYST`) — turn on in prod after a cost/error-UX check, or keep dark? | Verify OpenRouter cost + error path first (Wave D DAO round), then decide. |

---

## 3) Findings by backlog item (condensed; full evidence in lane reports)

### A. Features

**1. App Store — richer cards + identity** (`AppStore.tsx`, `lib/appStore.ts`, realm `memba_appstore_v3`)
- Cards show **no reviews/ratings/counts**; reviews render only on detail. `AppReviewStars` +
  `fetchSummary` are reusable as-is; per-card fetch works today, batch getter
  (`GetSubjectSummariesJSON`) on the reviews realm avoids N calls.
- **No usage/player-count data source exists at any layer** (no on-chain counter, no funnel events
  on the page, no backend per-app metric). Cheapest honest number today: the realm's own
  `GetStatsJSON` per-status counts (unused by FE).
- **Icons: `iconCID` is stored+served on-chain but never rendered** — every app gets a monogram.
  Rendering needs an IPFS gateway const + CSP `img-src`; a real logo *upload* pipeline (pinning)
  is entirely net-new.
- **Owner/dev workflow: realm-ready, client 0% built.** `EditListing` (logo+info, pending/rejected),
  `DelistApp`, `ListByPublisherJSON` all exist on-chain; `appStore.ts` has no write builders for any
  of them. B4 curator UI + B5 my-submissions confirmed absent; realm supports both fully.

**2. Home — "Live across gno.land"** (`ActivityFeed.tsx` → `lib/activity.ts` → public tx-indexer GraphQL)
- The feed never touches Memba's backend; it decodes 4 msg types over a ~400-block window.
- `classifyCall` misses `memba_feed_v1` (posts show as generic "call"), all game realms, and the
  app-store realm. Marketplace shows func-name only (no price/parties — that data sits unused in
  Memba's own `nft_sales` table).
- The genuinely new capability (rich Memba-native activity: trades w/ prices, posts, installs)
  requires a new backend union RPC over the tables the indexer already fills (`nft_sales`,
  `feed_posts`, `feed_reactions`, `nft_ownership_history`, `nft_collections`) — the public indexer
  physically can't provide it. App-store events additionally need a new indexer dispatcher.

**3. Home — general refresh**
- **Stale contradictions**: `ComingSoon.tsx` still lists "NFT Marketplace — not live yet" while
  `/marketplace` is a live route; `ExploreGrid.tsx` (#538-era) omits Marketplace/Feed/Blog/Games/
  App Store; `EcosystemBand` ignores `Counts.Collections` the snapshot already returns;
  `VisitorHero`/`ValueStrip` copy predates 5 shipped features. All S, frontend-only.
- `YourAssetsPanel` uses inline styles and a hardcoded "no digital assets" NFT door despite the
  live marketplace/indexer (M). Member BelowFold is a verbatim copy of visitor's (M, later).

**4. Feed — next wave** (design doc mined; 14-item delta table in the lane report)
- Realm already reserves `MediaCIDs` (≤4) + `RepostOf`; neither is wired (no realm `Repost`
  entrypoint yet; no media column in backend).
- Cheap completions: inline rich text (bare-URL/`@`/`#` linkify — `renderPostBody` runs
  `autolink:false` today), NFT unfurl kind, copy-link button, `sameContent` client-id keying,
  durable per-viewer flagged state. Then reposts (M — closes the standing `FeedGate` "coming next"
  promise).
- **Growth gate before any flag-on push**: moderation board beyond the single bearer-token
  blocklist + `SweepTombstones` cron + abuse dashboard; media additionally requires the CID
  serving-blocklist (immutable chain ⇒ refuse-to-serve is the only takedown lever).

**5. Marketplace — real-state check** (verdict table in lane report)
- **#851 + cutover fixes the *craft*** (skeletons, MarketCard, filters, a11y) **but adds zero
  listing volume** — `NftLaneV2` reads the same near-empty verified-collections source, and the
  cutover flag does not touch `VITE_ENABLE_SERVICES`/`TOKENS` (money-path hard-gate trio still
  applies to those).
- Residual "cheap" after cutover, by cause: *data/content* — real supply + imagery (needs
  `seedToOnchain.ts`, unbuilt, + media ingestion); *deploy-gated* — reputation wiring (v3_2 realm
  merged but undeployed; `memba_marketplace_reviews_v1` consumer realm unbuilt; FE consumers zero);
  *code* — Phase 5 mobile trade sheet + focus-trap, 6.3 `AllInPrice`, 6.5 interstitial, 6.6
  copymint defense, 7.1 item-level browse.

**6. Blog — content + SEO + images** (12 articles, all substantive)
- **SEO: articles are second-class.** Not in the sitemap (only `/blog` is), every `/blog/:slug`
  shares one generic og:title/description (`routeMeta.ts:48`), no `BlogPosting` JSON-LD, RSS is
  the only per-article URL emission, no RSS autodiscovery link. `docs/features/SEO.md`'s stated
  prerender re-eval trigger ("blog needing social-preview fidelity") is now active.
- **Images cannot render**: `markdownLite.ts` has no `![alt](url)` support and escapes raw HTML;
  frontmatter has no cover field. Fix order: parser img support (S) → `cover:` field + hero +
  per-article `og:image` (M) → editorial screenshot pass.
- Editorial: add "as of test13" qualifiers to flag-state claims (rot vector); `gno-core-pulse` is
  the only pure-dev piece; consider `author` frontmatter (on-chain meta already carries it).

### B. Audit rounds (scoped, one MD each when run)

**7. Docs house-cleaning** — full 3-repo inventory done (lane report = the working list).
~14 tracked DELETE candidates (7 shipped superpowers plans/specs, test12 report, "stray" go-live
readiness, 4 May handoffs), 2 deletions blocked on one-line reference edits first
(`NFT_ACTIVATION.md`, deployer 06-27 audit), 38 local git-ignored `.superpowers/sdd` scratch files,
UPDATE items (ROADMAP.md drift, 3 Apr-era ACTIVATION docs, 3 stale gnomonitoring READMEs), and a
ship-check needed on 4 gnomonitoring superpowers docs. Execution ≈ half a day after D3.

**8. Mobile round** — strong 375px e2e base; gaps: `reviews.css` (0 width breakpoints),
Feed thread/profile (no dedicated pass), Space Invaders layout (controls fine), marketplace-v2
pre/post-merge QA, `leaderboard.css` `overflow:hidden` table. All S; plus M to close the e2e
viewport gaps (blog, appstore+reviews, feed-thread, marketplace-v2, space-invaders, leaderboard).

**9. Themes round** — mechanism healthy (`themeStore` + `--color-k-*` tokens, doc'd rules).
1,669 hardcoded colors confirmed (doc's ~1,800 estimate): `gnolove.css` 318 (decide brand-exempt
vs tokenize), hacker-mode CSS ~123 (document as intentional dark-only), top-15 `.tsx` inline-color
files are the light-theme risk (M), marketplace-v2 branch has 10 small violations (S, post-merge
cleanup), and a CI guardrail against new hardcoded colors (M) would stop the bleed.

**10. Performance round** — Jul-8 tiers verified shipped. New top targets: indexer goroutine
`recover()` (the SPOF — see D2), `GetLeaderboard` full recompute on the read path
(`quest_rpc.go:617-628`), directory DAO read fan-out (W3.2), rpcFallback coalescing/backoff
(W3.3/3.4), unbounded team/marketplace queries, `manualChunks` gaps (gnolove/board bundles),
eager layout widgets (W4.3), dead remotion deps (W4.6).

**11. Security round** — scoped at 6-7 engineer-days:
- **Track A (realms)**: `memba_nft_market_v3_2` fee/royalty math + offers escrow (postdates the
  OriginSend sweep, no dedicated review), `memba_appstore_v3` fee path vs the v1 adversarial
  checklist, `memba_market_config` ACL. NF-2 `TotalLiabilities()` getters remain the open
  mainnet-readiness design item (K2), plus the owner checklist (K3) and 6 deploy.sh residuals (K4).
- **Track B (product)**: A2 unsigned-auth enforce-transition readiness, A3 flip runbook (D4),
  input-validation + rate-limit matrix across the 13 `*_rpc.go` handlers, DOMPurify sweep on all
  10 `dangerouslySetInnerHTML` sinks, set `QUEST_ADMIN_ADDRESSES`.
- Already well-covered (don't redo): OriginSend class, appstore_v1 fee path, link-preview stack,
  feed/blog funds-free claims.

**12. DAO round** — biggest structural finding: **the Create-DAO wizard emits a hand-rolled
avl-based realm (`daoTemplate.ts`), not the deployer's daokit/basedao framework** — two governance
codebases whose quorum/threshold/execution semantics need a parity audit (L). Also: ~15 fragile
regexes parsing proposal markdown (M, fuzz them), AI Analyst dark (D8), treasury/plugins lightly
covered. #490/#491 both merged.

**13. Multisig round** — per-sig verified badge shipped (#855); enforce flip = D4. Product
questions: broadcast gate counts *submitted* not *verified* sigs; hand-rolled Amino broadcast
fallback is fragile and broadcast-critical (L review); **no member/threshold/key-rotation
management exists** (feature gap, L); rename overloads create; legacy rows read "Unverified"
forever (copy fix S).

**14. Per-feature review round** — feature matrix built (28 features, flag reference, coverage
map; lane report is the backbone). **Coverage gaps found**: 12 flags referenced in code but
missing from `.env.example`; freshest marketplace audit doc lives only on the #851 branch.
Review order (stalest first): Multisig → Organizations/Teams → Extensions → Settings → Feedback →
Leaderboard → Profile → Tokens → Alerts → Candidature → Gnolove → … (everything from Validators
onward was audited within ~5 days). AMM/Dex remains the only zero-coverage product milestone —
by design (spike-gated, go/no-go).

### C. Brainstorms

**15. App Store futures** — existing building blocks: fee path w/ settable fee + pause, full
curation state machine w/ resubmit credits, subject-keyed reviews+reputation+moderation,
community flagging, per-status O(1) counters. Net-new directions: discovery/ranking (today
"Featured" = lowest id; no search), monetization (recurring/paid placement/dev rev-share),
developer analytics (zero data today), logo/screenshot upload+pinning, self-service dev console
(B3/B4/B5 complete it).

**16. Viral games/dapps** — ranked shortlist (reuse × potential):
(1) **ship `memba_arcade_leaderboard_v1`** — the single missing piece converting two built games
into competitive products (M-L, D7); (2) daily-challenge share cards + Web Share deep links across
both games (S-M); (3) second title on the SI spine — ~70% reuse (M); (4) prize escrow
`memba_arcade_prizes_v1` (L, gated on attestation + fund audit); (5) weekly boards + streaks (S-M);
(6) ghost/replay viewer — input logs already recorded (M); (7) quest×arcade badge tie-in (blocked
on Q-01); (8) PWA daily reminder (S). Hard rules: never "trustless" labeling, scoring frozen by
corpus, leaderboard realm funds-free, cosmetics use their own RNG.

---

## 4) Prioritized implementation plan

Effort: S ≤ half-day · M 1-2d · L multi-day. Each wave = independently shippable PRs, dark or
low-risk by default. Waves A-C are parallelizable lanes after Wave 0.

### Wave 0 — Unblock + de-stale + quick wins (all S, ~2-3 days total)
1. **#851 merge** (after D1) + post-merge follow-ups: 10 theme-token fixes, mobile QA at 375px.
2. **Home de-stale pack** (frontend-only): fix `ComingSoon` contradiction, extend `ExploreGrid`
   with the 5 shipped surfaces, render `Counts.Collections` in EcosystemBand, refresh
   hero/ValueStrip copy, fix `classifyCall` labels (feed/games/appstore/marketplace verbs).
3. **Blog SEO pack**: article URLs in sitemap (reuse the RSS plugin's parse), per-article
   og:title/description + `BlogPosting` JSON-LD, RSS autodiscovery link, markdown `![img]`
   support in `markdownLite` (sanitized).
4. **Perf quick wins (backend)**: indexer `recover()` wrappers + connection budget (D2 Option A);
   move `GetLeaderboard` recompute off the read path.
5. **Flag hygiene**: document the 12 missing `VITE_*` flags in `.env.example`.
6. **App Store S-wins**: `AppReviewStars` on cards (per-card `fetchSummary`), masthead counts via
   `GetStatsJSON`, render `iconCID` with monogram fallback (+gateway const + CSP img-src),
   screenshot gallery on detail.
7. **Docs deletions** (after D3): the approved list + 2 reference-edit-first deletions + local
   scratch purge + UPDATE items (ROADMAP.md, ACTIVATION docs).
8. **Multisig copy fixes**: legacy "Unverified" disambiguation, rename flow.

### Wave A — App Store cycle (owner item 1 + B-track; M-L total ~1.5 wk)
1. **B3 submit money-path** (restart per D6; SAFETY_GATED `VITE_ENABLE_APPSTORE_SUBMIT`).
2. **B5 my-submissions** (`ListByPublisherJSON` + page; types exist) — M.
3. **Publisher edit/delist UI** (`EditListing`/`DelistApp` builders + form) — M. Together with B5
   this is the owner's "great workflow to manage logo & app info".
4. **B4 curator dashboard** (`IsCurator`-gated queues + approve/reject/restore) — M-L.
5. **Batch review summaries** (`GetSubjectSummariesJSON` realm method + `fetchSummaries`) — M.
6. **Logo/screenshot upload+pin pipeline** (IPFS pin service; also unblocks marketplace imagery
   and feed media later) — L. Design once, reuse thrice.
7. Defer: on-chain usage counters (L, spam-design needed); interim: Plausible `OpenApp` events (S).

### Wave B — Home "Live across gno.land" (owner item 2; L, ~1 wk)
1. **`GetMembaActivity` backend RPC**: union over `nft_sales`/`feed_posts`/`feed_reactions`/
   `nft_ownership_history`/`nft_collections` with semantic fields (prices, parties, bodies) — L.
2. FE merge: Memba-native stream primary + public tx-indexer tail; filter chips per kind — M.
3. Optional: app-store events indexer dispatcher (mirrors `feed_dispatch.go`) — M-L.

### Wave C — Feed next wave (owner item 4; per D5 discourse-first)
1. S-cluster: inline linkify (`@`/`#`/URLs), NFT unfurl kind, copy-link, `sameContent` keying,
   durable flagged state.
2. **Reposts** (realm `Repost` entrypoint + dispatcher + FE) — M.
3. **Moderation gate**: sweep cron + abuse dashboard (M) → daokit mod board (L). Prereq for any
   flag-on/growth push and for media.
4. Media pipeline (L) — only after 3 + the CID serving-blocklist; reuses Wave A.6 pinning.

### Wave D — Audit rounds (owner items 8-14; one consolidated MD each)
Order: **Security** (Track A realms first — v3_2 + appstore_v3 pre-deploy; 6-7d) →
**Multisig** (item 13 + per-feature #1: enforce readiness, broadcast-gate semantics, Amino
review, member-mgmt scoping) → **DAO** (item 12: wizard/daokit parity, parser fuzz, D8) →
**Mobile+Themes** (items 8-9 fix clusters + CI color guardrail) → **Perf** (item 10 targets) →
then the systematic per-feature tour (item 14) continuing down the staleness order
(Orgs/Teams, Extensions, Settings, Feedback, Leaderboard+Quests Q-01/Q-02, Profile, Tokens, Alerts…).
Quests Q-01 (badge auto-mint worker) + Q-02 (verifier coverage) get fixed inside the
Leaderboard/Quests stop of the tour — they are the oldest known-broken loop.

### Wave E — Marketplace completion (owner item 5 residuals; after #851)
1. Phase 5: mobile trade BottomSheet + `AccessibleDialog`/focus-trap — M.
2. Phase 6 code: `AllInPrice` (M), leaving-Memba interstitial + copymint defense (M).
3. `seedToOnchain.ts` + founding-supply seeding ceremony (M; converts seed → real volume).
4. Item-level NFT browse/shelves (M). Trust wiring (reputation) stays deploy-gated on v3_2 +
   consumer realm — schedule after the owner's v3_2 deploy ceremony.

### Wave F — Games/viral (owner item 16; after D7)
1. `memba_arcade_leaderboard_v1` realm (spec §7.3, funds-free, sig-gated) + backend attest path —
   M-L. 2. Share-card growth loop both games (S-M). 3. Weekly boards + streaks (S-M).
4. Later: SI Go engine port (W5 of SI plan), ghost viewer, second title, prize escrow (gated).

### Blog content wave (owner item 6, editorial — interleave anytime after Wave 0.3)
`cover:` frontmatter + hero + per-article OG image (M) → in-app screenshots pass across the 12
articles (editorial) → "as of" qualifiers + author bylines (S) → prerender re-eval for /blog
(decision note, M if adopted).

---

## 5) Carry-over ledger (folded in)

| Carry-over | Where it landed |
|---|---|
| Backlog-Jul-8 item 2 (plan-coverage matrix) | DONE — §3.14 / feature-matrix lane report |
| Backlog-Jul-8 item 3 (per-feature review) | Wave D tour, staleness order |
| B3 / B4 / B5 | Wave A.1/.4/.2 (D6) |
| Marketplace Phase 5/6 gates | Wave E + owner deploy ceremonies |
| Validator-naming P1 alerts | OPEN — lives in gnomonitoring/infra (address-as-moniker alert >10%); schedule with the next gnomonitoring session; P2 UX affordance noted |
| W1.5 indexer decision | D2 (Option A) → Wave 0.4 |
| Quests Q-01/Q-02 | Wave D per-feature tour (Leaderboard/Quests stop) |
| samcrew-deployer orphan `chore/reviews-onchain-verify` | Owner call: port to reviews_v2 or discard (5-min decision, any wave) |
| `QUEST_ADMIN_ADDRESSES` prod env | Owner action alongside D4 |

---

*Method note: 12 read-only investigation lanes over Memba, samcrew-deployer, gnomonitoring at
HEAD; all key claims spot-verified (Phase-8 branch state, feed realm deployment, METRICS_BEARER
closure). No source files were modified for this plan.*
