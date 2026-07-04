# Changelog

All notable changes to Memba are documented here.

<!--
PARSE CONTRACT (W6.1): the /changelogs page is generated from this file at
build time (frontend/src/lib/changelog.ts — parser unit tests run against
THIS file, so breaking the format fails CI). New entries use:

  ## [vX.Y.Z] — YYYY-MM-DD
  <!- categories: memba, network, gno-core ->   (optional HTML comment, default memba)
  ### Workstream title (#PRs, date)             (section titles become the page digest)
  - detail bullets

Keep `## ` for release blocks only; historical heading variants below are
grandfathered (the parser tolerates them — don't add new ones).
-->

Full changelogs are split by version range for easier navigation:

## [Unreleased]

### Social feed — W7.2 P1: /feed UI (2026-07-04)
- **New `/feed` page** behind the ordinary `VITE_ENABLE_FEED` flag (no funds): a global on-chain timeline reading the indexed backend projection, with a wallet-gated composer (optimistic insert + reconcile against the indexer) and a per-post flag action — all broadcasting to the `memba_feed_v1` realm via the ordinary Adena flow (no multisig paths touched). Graceful empty/loading/error states; post bodies render as escaped plain text (zero XSS).
- Wired through the 4-mode nav (Explore), route meta + sitemap (paired), and both `.env.example` files; reachable in the mobile "More" sheet. Fixed a latent flag-badge gap — the sidebar's literal-reader `FLAG_ON` map was missing the feed flag, which would have badged an enabled feed as "soon" (the documented prod-bundle-env trap). Off by default until the realm is deployed (owner-executed).

### Social feed — W7.2 P0: indexer + timeline API (2026-07-04)
- **Feed indexer** — a new, fully decoupled event-tailing indexer for the `memba_feed_v1` realm (its own goroutine, cursor `feed_indexer_state`, and raw ledger `feed_raw_events`, separate from the NFT money-path tailer so neither can stall or corrupt the other). Projects `PostCreated`/`Edited`/`Deleted`/`Flagged`/`AutoHidden`/`ModAction` events into `feed_posts`; idempotent writes, single-block reorg-safe rollback. Off by default — starts only when `FEED_WATCHED_REALMS` is set (safe while the realm is pre-deploy).
- **Timeline RPCs (public, no auth):** `GetFeedTimeline` (home timeline — newest top-level posts, cursor-paginated, visibility-filtered; replies are read per-thread), `GetUserFeed` (one author), `GetFeedThread` (a post + its live replies, oldest-first, with a deleted-parent tombstone root). These serve the low-latency indexed projection for optimistic UI; the realm stays the source of truth. Reposts are deferred to P1 (the proto field is reserved, not shipped as an always-empty field).

### Blog — articles 2–3 + Wave 6 closure (2026-07-04)
- Published *Gno core pulse* (builder's digest of the verified upstream window: interrealm-v2 in production, NewBanker hardening, realm.Sub status, AddPackage strictness, event-attr caps) and *Why Memba* (the thesis: readable governance, fees to the DAO treasury, safety as code, honest progressive decentralization).
- W6.2 URL-mode restructuring formally **skipped** (decision recorded in the roadmap); Wave 6 gate passed except the U-2/U-9 owner carry-overs.

### Observability — W6.5 PR1: Sentry gaps closed (2026-07-04)
- **Root ErrorBoundary now reports to Sentry** — app-wide render crashes were invisible (only the alerts/gnolove boundaries captured). Stale-chunk crashes are tagged (`memba_stale_chunk`) so benign auto-reloads stay filterable while persistent chunk loops finally surface.
- **Money-path visibility:** a transaction broadcast that exhausts every retry on an infrastructure failure is captured (`memba_path: tx-broadcast`); user rejections and domain errors stay unreported by design. Addresses/JWTs scrubbed by the existing global beforeSend.

### Blog — W6.4: /blog + RSS + first article (2026-07-04)
- **New `/blog` section:** markdown articles in `content/blog/` (front-matter contract in `lib/blogParser.ts`, drift-tripwire test on the real files), list + article pages rendered through the XSS-safe markdownLite + DOMPurify house pattern, Explore-mode nav entry, route meta + sitemap pairing, and a build-time RSS feed (`/blog.rss`).
- First article: "Inside Memba — what's live on gno.land test13 today" (merged under the owner's delegated trust).

### SEO — W6.3 PR3: structured data + prerender decision (2026-07-04)
- **JSON-LD structured data:** site-level Organization + WebApplication graph static in `index.html` (crawler-readable pre-JS); per-route BreadcrumbList injected by `RouteMetaSync`. JSON-LD script blocks are inert — CSP unaffected.
- **Prerender decision recorded (`docs/features/SEO.md`): not adopted** — Googlebot's JS rendering plus the now-complete meta/sitemap/JSON-LD surface covers the testnet-stage audience; re-evaluation triggers documented. W6.3 complete.

### SEO — W6.3 PR2: sitemap.xml + robots.txt (2026-07-03)
- **`sitemap.xml` generated at build** (vite plugin over a pure builder in `lib/sitemap.ts`): every public static route, network-prefixed and lastmod-stamped. Static-only by design — build-time chain fetches for entity pages would couple Netlify builds to live-chain availability (decision documented in-module; revisit with the PR3 prerender decision). Plus a static `public/robots.txt` pointing at the sitemap.

### SEO — W6.3 PR1: per-route meta (2026-07-03)
- **Per-route SEO meta on every navigation:** a central `RouteMetaSync` (mounted in Layout) now writes meta description, `og:title`/`og:description`, `og:url`, `twitter:title`, and the canonical link from an ordered route-meta map (`lib/routeMeta.ts`) covering all key sections. Deliberately never touches `document.title` — pages own their titles, and React effect ordering would otherwise clobber dynamic ones (proposal names, validator monikers).

### DAO — GovDAO page fixes, owner-reported on mobile (2026-07-04)
- **GovDAO proposals load again (no more "Blockchain query failed"):** the proposals reader probed the W1.4 `GetProposalsJSON()` export in strict mode, and GovDAO v3 (which never exported it) answers that with a VM panic — the strict probe threw before the GovDAO Render-markdown fallback could run, on every visit. The probe is now always non-strict (missing JSON API is a designed-for condition); real transport/realm failures still surface via the strict fallback read.
- **Quest-complete toast no longer squeezes the whole app:** the toast renders from the global layout but its styles lived in the lazy quest-pages stylesheet — completing a quest anywhere else (e.g. "Governance Viewer" fires on the GovDAO page for fresh profiles) rendered it UNSTYLED as a flex item inside the app shell, crushing the page into a ~106px strip for the toast's 4-second lifetime. The styles now ship with the component in the main bundle.
- **Mobile: DAO stat chips readable again:** the compact stat grid was starved to a ~70px sliver beside the power donut, wrapping every label mid-word ("Membe rs"). It now takes the full card row below the donut on phones, using the app-wide mobile stat layout.

### Navigation — W6.2 4-mode IA, PR1 (2026-07-03)
- **Sidebar reorganized into four labeled modes — Wallet / Govern / Launch / Explore** — and is now fully manifest-driven (adding a `navManifest.ts` entry places it; no more hand-curated link list). Marketplace/Services/NFT surface in Launch with live/soon pills, replacing the buried "Upcoming" collapsible. Zero URL changes; account links unchanged.

### Changelogs — W6.1 automation (2026-07-03)
- **/changelogs is now generated from this file:** build-time parser (`frontend/src/lib/changelog.ts`) with a documented parse contract at the top of `CHANGELOG.md`; parser unit tests run against the real file, so format drift fails CI instead of emptying the page. The page was frozen at v3.2.0 (April) — it now shows everything through the current release plus the Unreleased digest. Curated pre-v6 entries preserved in `changelogLegacy.ts`.

### Docs — W5.6 upstream breaking-changes sweep (2026-07-03)
- `GNO_CORE_BREAKING_CHANGES.md`: added the Jun 16 → Jul 3 upstream sweep (master `dfe49509f`) — zero breaking changes for deployed test13 realms; three forward-looking rules pinned for new realm code (NewBanker `IsCurrent()` caller-drain rule, `realm.Sub()` not-on-test13 status, AddPackage production-file strictness), all commit SHAs fact-checked against the gno repo.

### Wallet — W5.1 Adena session stability (2026-07-03)
- **"Memba keeps disconnecting" root cause fixed:** the connection flag lived in per-tab `sessionStorage`, so every new tab and every browser restart skipped silent reconnect entirely. The flag now persists in `localStorage` (no weaker than the status quo — the auth token already lives there; silent reconnect is still gated by Adena's own whitelist), with one-time migration of the legacy flag.
- **Locked-wallet recovery:** the mount-time silent reconnect was one-shot — if it ran while Adena was locked, the tab stayed disconnected even after unlock. A visibility-driven retry (throttled to one attempt per 15 s) now recovers when the user returns to the tab.
- **Field diagnosis:** opt-in wallet session-event ring buffer (`localStorage.memba_wallet_debug = "1"`, dump via `window.__membaWalletLog()`) for pinpointing any residual disconnect reports — event names only, no addresses or signatures.

### Validators — W5.3 review stars (2026-07-03)
- **Review stars in the validator table** (behind `VITE_ENABLE_REVIEWS`): per-row ★ average + count from the on-chain reviews realm, fetched lazily with a 4-wide concurrency limiter and page-lifetime cache (no N-parallel qeval bursts against the public RPC); row hover card now shows the 3 most recent review comments (tombstones filtered).

### Directory — W5.2 fixes (2026-07-03)
- **Source view fixed at the root:** realm/package source now loads via ABCI `vm/qfile` on the chain RPC (CORS-safe, authoritative, RPC-failover-aware) instead of scraping gnoweb HTML — gnoweb serves no CORS headers, which was the actual cause of "Source code not available" / "Source metadata not available". Gnoweb scrape kept as fallback; retry button added to the drawer's unavailable states.
- **Packages tab first:** `/directory` now lands on Packages (most-filled tab on test13); explicit `?tab=daos` deep links unchanged.

### Planning — Program "Compound" (2026-07-03)
- **Long-term roadmap:** added `docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md` — the successor program to the v7.2.x AAA remediation plan (Waves 5–9: stabilization, discoverability/SEO/blog, marketplace & social feed, fund-safety de-gating, platform-bet spikes). `ROADMAP.md` now points to it; `docs/planning/SESSION_SYNC.md` added for parallel-session coordination.

## [v7.2.0] — 2026-06-29

> Large multi-workstream wave merged to `main` after v6.3.1. Grouped by workstream (most recent first); PR numbers are the source of truth.
>
> ⚠️ **Backlog note:** the wave from #510 → #585 (Home AAA, validators unification, mobile, §13 light theme, reviews realm, quests) is only partially captured here. A backfill pass is in progress.

### Page Decomposition & Hygiene — Wave 3 (#650, #651, #652, 2026-06-29)
- **Marketplace Page Decomposition:** `Marketplace.tsx` reduced from 816 LOC to 319 LOC by extracting `AgentDetailView`, `RegisterAgentForm`, and `CreditSection`.
- **CSS Tokenization:** Replaced 270+ inline hex colors with CSS custom properties (`var(--color-...)`) across 61 files to support upcoming themes.
- **NavManifest Completion:** Added 4 missing routes (`organizations`, `quest-admin`, `leaderboard`, `changelogs`) and 4 new icons to ensure 100% route coverage.
- **Backend Deprecation Fix:** Migrated from deprecated `h2c.NewHandler` to standard library `http.Server` protocols (Go 1.25) to fix `SA1019` linter errors, while preserving HTTP/1.1 fallback for Fly.io health checks.
- **Dependency Hygiene:** Merged 10 `dependabot` PRs across the stack (React, Cosmos SDK, ConnectRPC, SQLite).

### Security Hardening — Wave 1 (#644, 2026-06-28)
- **Auth fail-closed by default.** `MEMBA_ALLOW_UNSIGNED_AUTH` default inverted from permissive→reject. Unset/missing env var now **rejects** unsigned auth (impersonation closed). Explicit `=1` required for dev mode only. fly.toml env var removed (default is now secure).
- **Ed25519 seed log redacted.** Ephemeral keypair generation no longer logs the raw seed to stdout — logs an 8-byte public key prefix instead (SEC-13).
- **Quest claim error observability.** 5 silently-swallowed `_, _ =` DB write errors across `queueBadgeMint`, `updateUserRankCache`, `checkAndQueueRankBadge`, and leaderboard cache now emit `slog.Warn` with address + error context.
- **ReviewQuestClaim data fix.** Approved quest completion INSERT now returns error to caller instead of silently failing — was a data-loss bug where claim status showed "approved" but XP was never granted.
- **Health handler resilience.** DB Ping bounded to 2s context timeout — prevents health check blocking under SQLite `MaxOpenConns(1)` when the single writer conn is held by the tailer or a long RPC.
- **Periodic WAL checkpoint.** `PRAGMA wal_checkpoint(PASSIVE)` every 5 minutes bounds WAL growth during runtime. The existing shutdown TRUNCATE only fires on graceful stop — a crash leaves a large WAL that slows recovery.
- **WAL size alerting.** Health handler logs `slog.Warn` when WAL exceeds 50MB threshold.
- **Indexer lag metric.** New `memba_indexer_lag_blocks` Prometheus gauge (chain_head − last_block) for direct alerting. Structured warning emitted when lag exceeds 30 blocks.
- **Team LeaveTeam fix.** Last-member team cleanup DELETEs now return errors instead of silently failing.

### Workspace Hygiene — Wave 0 (#631, 2026-06-28)
- **`.env.example` sync.** `VITE_ENABLE_NFT=true` (production reality since #617), `NFT_RPC_URL` → `rpc.testnet13.samourai.live` (our node, avoids public rate limits), `NFT_WATCHED_REALMS` → `v3_1` (drop retired v3). Updated `realm-versions.json` with `memba_quest_attestation_v1`.
- **CI safety gate fix.** `.github/workflows/ci.yml` safety-check step fixed for clean env (was hard-failing on CI where no `.env` exists).
- **Dependabot re-enabled.** Weekly checks for npm, gomod, and GitHub Actions dependencies.
- **`.gitignore` hardened.** Excludes dev artifacts (`*.db`, `*.db-wal`, `*.db-shm`, `coverage/`, `.DS_Store`).
- **Workspace cleanup.** Pruned 4 stale worktrees, 49 merged local branches, 6 obsolete stashes. Reset Gno repo to `origin/master`.

### Quests — on-chain XP attestation (live on test13) + hardening + polish (#582/#583/#586/#596/#601/#605/#610/#613/#619, deployer #38/#39/#40, 2026-06-27)
- **Quest XP is now cryptographically settled on-chain (Q-05), not just a backend DB row — live-verified end-to-end on test13.** The audit's central finding was a fully centralized XP ledger; this adds a verifiable on-chain record without giving the backend a hot key. Model = **offline-signed voucher**: the backend holds an *offline* ed25519 key and signs a voucher `(address, questId, xp, nonce)` on a verified completion; the **user broadcasts** it (`RecordCompletion`) to the new immutable realm `gno.land/r/samcrew/memba_quest_attestation_v1`, which verifies the signature (`crypto/ed25519.Verify`) + rejects reused nonces & separator-injection + bounds XP, then records it. The signature — not the caller — is the authority, so there's no custody blast radius beyond a per-voucher XP cap; the signer is owner-multisig-rotatable. Realm deployed + `SetSigner`'d (2-of-2 multisig); backend signer wired via `MEMBA_ATTESTATION_SEED` (dormant when unset); a QuestHub **"On-chain attestation"** panel surfaces claimable vouchers and broadcasts via Adena. Proven live: a real completion recorded **15 XP on-chain** (signer-verified). Chosen over a hot-key relayer by a cross-perspective panel; the realm and signer paths were each independently security-reviewed before merge. (#582 audit+plan+ADR · deployer#38 realm · deployer#40 `SetSigner` helper · #605 signer · #610 backend issuance + `GetAttestationVouchers` · #613 frontend · #619 also-issue-on-sync so every completion attests.)
- **Per-address quest rate limiting (Q-03, #596).** Layered a per-wallet token bucket (`ratelimit.AllowKey`) on top of the per-IP limiter — 10 writes/min + 5 self-report claims/min per address (env-tunable), checked *before* the expensive on-chain verify. Stops a sybil farm rotating IPs from grinding XP on one wallet (multi-wallet sybil heuristics remain a mainnet prerequisite). Security-reviewed.
- **Attestation/farming observability (Q-16, #601).** New `memba_quest_rate_limit_exceeded_total{endpoint}` counter + a WARN breadcrumb on rejection — the farming signal to watch before badges carry value.
- **Catalog correctness + UX/a11y polish (#583, #586).** Single-sourced the candidature XP threshold from the Gold rank tier (killed a duplicated `350`); accurate set-difference "syncing" indicator + XP-confirming state; tokenized the last hardcoded colors; clear-filters affordance on the empty grid; semantic claims list; localized self-report dates; deploy-quest namespace hint. (The audit's other "gaps" — focus rings, form labels, leaderboard, self-report UI — were verified already shipped.)

### Marketplace — unified NFT marketplace, live on test13 (deployer #36/#40–#44, memba #612, 2026-06-27)
- **The marketplace shipped.** A unified front door over the NFT lane on a DAO-owned fee spine: every trade routes a per-lane protocol fee (NFT 2%) to the Memba DAO treasury, enforced atomically on-chain alongside creator royalties. One `MarketplaceHub` shell (lane registry, URL-state), a multi-engine trade router, and the v3.1 engine wired for buy / list / make-offer / **accept-offer** — plus a buyer best-offer badge and a fee row that reads the live DAO rate from `memba_market_config` (not a hardcoded constant).
- **On-chain (test13, 2-of-2 multisig).** Deployed `memba_market_core_v2` (shared split math — `SplitProceedsBPS` + a `MaxFeeBPS=500` ceiling the DAO can never exceed) → `memba_market_config` (per-lane fee + treasury; admin/treasury = the samourai-crew multisig; **no Pause** by design so a config read can't brick settlement) → `memba_nft_market_v3_1` (config-reading engine, addr `g1hu6u2q…`). Registered as the **sole** market on `memba_collections`; the old fee-less v3 was retired (`UnregisterMarket`). Settlement proven by a gnodev integration harness (55/55) and confirmed live (`SplitProceedsBPS`=20000@2%, treasury routing verified).
- **Safe-by-construction.** The trade surface gates on **both** the engine's allowlist validity **and** `VITE_ENABLE_NFT` — it stayed dark through the entire build + deploy and only lights up in prod once the flag is set (a live realm ≠ an exposed UI). Deploy tooling (`deploy.sh`, gnodev harness, runbook) brought current for next-network deploys; a stale Phase-0 `memba_market_core` already on-chain forced the `_v2` rename (gno paths are immutable). Realm versions recorded in `realm-versions.json` (chain-verified).

### Home — connected/member AAA pass + ecosystem-band fixes (#602, #608, #604, 2026-06-27)
- **Member home hero (#604).** The logged-in home opened on impersonal chrome and a bare two-span wallet band — thinner than the shipped visitor hero, with the member's own data surfaced nowhere. New **`MemberHero`** brings it to the same editorial bar: left = identity (initials avatar + on-chain `@username`/truncated-address + honest wallet balance), right = a standing "proof object" — **XP + rank + a progress bar toward the 350-XP Memba DAO candidature**, flipping to an "Apply to Memba DAO" CTA once eligible (else "Earn XP" with the exact XP-to-go). New hooks `useMemberStanding` (backend-authoritative XP via `fetchUserQuests` with an instant local `placeholderData` baseline + real `gnobuilders` rank tiers; XP gated on auth so a disconnected render never leaks another session's local XP) and `useMemberIdentity` (`resolveOnChainUsername`, address fallback, never blanks).
- **Wallet-balance honesty (#602).** The member balance chip was gated on `balance !== "0"`, but `useBalance` only ever emits a `"… GNOT"` string (`"— GNOT"` loading / `"? GNOT"` error / `"0 GNOT"` empty), so the guard was dead and the forbidden `—`/`0` rendered. Now gated on the numeric `rawUgnot > 0n` (threaded through `LayoutContext`).
- **Ecosystem band — count↔rows consistency (MH-14, #602).** The band header count comes from the fresh backend snapshot while the rows come from `fetchTokens` (5-min `sessionStorage` cache); right after a token launch the count jumped (e.g. "3 tokens") while the cached list lagged (1 row), and the "view all" gate keyed off the stale list length so no "view all 3" appeared. Count is now `max(snapshot, listLength)` and "view all N" shows whenever the count exceeds the rows actually rendered (tokens + validators). Plus "1 token" singular.
- **Ecosystem band — equal-height cards + genesis-validator names (#608).** The "tokens" and "Top validators" cards rendered at different heights → the sections grid now stretches them equal. The top-by-power validators showed truncated addresses because they're genesis validators unregistered in `r/gnops/valopers`; added gnomonitoring participation as a cheap, best-effort secondary moniker source (valopers stays primary; degrades to the address) so the band shows `gno-core-val-01` / `gfanton-1` / `Samourai-crew-1`.

### Home — AAA editorial redesign (#584, #589, #590, #593, 2026-06-26)
- **The redesign (#584).** Root cause across three expert audits: the page didn't manage emptiness — flagship cards sat 60–80% empty. Fixes (all honesty-contract-clean — absent data is omitted, never faked): the **GovDAO card** now fills its dead right half with a live "latest governance" rail (top 3–4 proposals, from data `useGovDao` already fetched — no extra RPC); **"ecosystem at a glance"** compacted to **"Top validators" (top 3 + real monikers via `fetchValoperMonikers`)** and **token rows with on-chain supply**; the **Launchpad** is a live mini token-card (name · $ticker · supply · **holders** · creator · count); the **"live across gno.land" feed** gets a per-realm **diversity cap** (kills the "wall of Approve"), **verb-first humanized titles**, new kinds (NFT / posts / multisig), and **type filter chips**. The **"Monitor governance" hover bug** (global `a:hover` teal leaking onto the GovDAO `<Link>`) fixed via a gold-outline ghost button. Plus a **Proposal-C editorial hero** (display headline + a live network proof card) and a plain-language **on-ramp ValueStrip** for first-time visitors. Holder counts come from the GRC20 `Known accounts` render field (no indexer aggregation needed).
- **Page-level halt consistency (#589).** New `useChainHealth` shares one `/status` liveness poll; `NetworkHealthDoor` shows "network stalled" (not a misleading "X/Y healthy") and the activity feed says "paused" when the chain is halted/unreachable. (The clock-skew halt-detection root cause itself shipped via #580.)
- **Hover polish (#590).** Soft elevation shadow on door / explore-tile / value-strip hovers so the existing lift reads as depth; `prefers-reduced-motion`-guarded.
- **Token launch dates (#593).** The realm stores no creation time, and the indexer scan to find a token's `New` tx takes 16–26s — longer than the 10s `/api/indexer` proxy timeout, so the browser can't do it. New backend `GET /api/token-launches` serves a cached `{symbol: launchedAtISO}` map: a background refresh (6h TTL) scans the indexer once for `New`/`NewWithAdmin` calls on the tokenfactory realm (the `func` filter is selective → bounded by token count, not block range) and resolves each creation block's time via RPC `/block`. The Launchpad shows "launched Xd ago" (best-effort — omitted when absent). No proto change.

### Validators — profile bugfixes + roster pagination + reviews continuity (2026-06-26 → 27)
- **Reviews subject continuity (#600, 2026-06-27).** When a validator registers a valoper its canonical address flips from the signing address to the operator address, stranding reviews posted before registration under the old key (hit live on `samourai-crew-1`: operator `g1n9y62…`, signing `g1k7asng8…`). The profile now reads reviews from the **union of {operator, signing}** addresses and merges them (`mergeReviewsByAuthor` — dedupe by author, prefer the canonical-subject review); new reviews still post to the operator address. Summary is computed client-side from the merged set. Posting is now **optimistic** (instant insert via `makeOptimisticReview`/`upsertReviewByAuthor`, marked "Posting…" with actions hidden until confirmed, reconciled by a bounded poll, show-stale-while-revalidating). The post button shows a "Select a rating to post" hint and the `connecting` state always clears so it can't stick disabled. The durable realm-level fix is specced in `docs/planning/REVIEWS_V2_SUBJECT_CANONICALIZATION_SPEC_2026-06-27.md` (`memba_reviews_v2` with a moderator-set canonical-alias map; v1 is immutable; team-deployed, then this bridge is retired).
- **Validator profile bugfixes (#581).** Review/comment dates now resolve the realm's block-height `createdAt` to real wall-clock time via RPC `/block?height=N` (was rendering "Jan 1970", because `memba_reviews_v1` stores `CreatedAt` as a `runtime.ChainHeight()` block height, not a Unix timestamp). The reviews write-form is now always visible with connect-on-submit — the wallet is only triggered on "Post review" (was replaced by a connect prompt when logged out), with a synchronous double-submit guard. Genesis validators (in the active set, no valoper record) get a name via a valopers+gnomonitoring moniker merge plus a curated gnolove identity-label fallback; the Samourai-crew genesis validator is mapped by address so its name and team contributions resolve. Loading state centered via the canonical `ConnectingLoader`; light-theme white fills in `reviews.css` tokenized; `StarRating` rebuilt as an accessible radiogroup (arrow keys + hover-fill); review action buttons get aria-labels; inverted comment-tombstone filter removed.
- **Full valoper roster pagination (#585).** `r/gnops/valopers` `Render("")` paginates at 50 entries/page; `fetchValopers` and `fetchValoperMonikers` only read page 1, so the Candidates count and roster moniker tags silently capped at the first 50 (test13 has 77 registered — 50 on page 1, 27 on page 2). New `fetchValoperListPaged` walks every page (stops at the last page / empty / no-new-entries, with a `MAX_PAGES` backstop), so the count and tags now update automatically as operators register.

### test12 → test13 cutover + auth enforcement + indexer (2026-06-23)
- **Production cutover to test13.** Chain flip `GNO_CHAIN_ID test12 → test-13` + RPC + accepted-chain-ids (#450); retire test12 from the network selector (#453); backfill `realm-versions.json` with the live test13 realms (#451); fix the gnoweb test13 URL (#454).
- **test13 feature completeness:** candidature admin approve/reject UI (#448); channel thread author edit/delete (#449); owner-only Create Channel (#452); truthful home network-status states (#447).
- **Auth — login signatures now ENFORCED in prod.** Root-caused the long-standing `result=signed_invalid`: the backend reconstructed the login sign-doc with `"args":null`, but Adena's proto-roundtrip omits an empty `args`; `args,omitempty` makes real Adena signatures verify (#456). Confirmed `result=signed` live, then flipped `MEMBA_ALLOW_UNSIGNED_AUTH=0` — empty/invalid/address-only logins are now rejected, closing the impersonation window (#460). `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` held pending live A3 validation.
- **NFT indexer unfrozen.** Read the block hash from `result.block_meta.block_id.hash` — test13 nests it there, and the wrong path had frozen the tailer at block 259,999 (#457); retry past the public node's intermittent empty responses (#462); pin the tailer to samourai's own RPC node after the resulting fast catch-up tripped the public node's per-IP rate limit (#466).
- **Fixes/docs:** Candidature "Go to Quest Hub" button → `/quests` (was `/profile`) (#463); consolidated test13 live cross-perspective audit (#464).
- **Home — Atlas redesign (concurrent session):** visitor "board of doors" home, member home, polish, vendored fonts (#455/#458/#459/#461).

### gnolove (#371–#380, 06-04 → 06-05)
- Default Home + Report to "This Month" (#371); order Teams index by this-month contributor score (#372).
- Notable PRs board page (#373), redesign as Linear list + Kanban (#376), and **multi-board** selector mirroring multiple project boards via a code-owned registry (#378, gnolove #230).
- CI: clear react-router + Go stdlib advisories (#374); restore Node 20 frontend matrix (#375). Docs archived (#380).

### test13 migration + go-live (#377–#382, #408–#421, 06-05 → 06-16)
- Migration plan + off-chain Phase-2 prep (network entry, CSP, RPC trust) with **no cutover** (#377/#379); unify channels write-API (#381); session-outcome docs (#382).
- G5 ledger: chain-verify `realm-versions.json`; mark `contracts/` as CI-only stubs (#408/#409).
- Official onbloc RPC + trust/CSP congruence (#392/#410/#411), drop test11; go-live hardening — chain-mismatch + broadcast + a11y + explorer (#412); chain-id allowlist so test13 works alongside test12 with no forced re-login (#413).
- **Realms live on test13:** flip `realmsDeployed` on (#416); repoint frontend to deployed `_v2` commerce realms — token creation works (#420); feedback → `memba_feedback_v2` (#421); repair `vm/MsgCall` builders + per-network realm-validity gating (#419). Go-live note → DONE (#417).

### Auth / AAA hardening (#383–#407, #418, 06-10 → 06-16)
- Fund-safety: AAA CI safety gate for fund-trapping flags (#383); treasury-spend kill-switch (#387); gate agent-credit deposits (#388); tx-confirmation modal before all broadcasts (#389); remove client-side fee Transfer that double-charged token mints (#386).
- Backend: fix SQLite self-deadlock in `computeLeaderboard` (#385); immutable cache headers for hashed assets (#384).
- **Signature auth:** gno-canonical **tm2 sign-bytes helper (A2/A3 keystone)** (#397); server-side multisig member-signature verification at submission (#398); verify tx-shaped login proof via canonical sign-bytes (#399); frontend signs tx-shaped login proof (#400); stop minting tokens from empty signatures — gate + enforce switch (#393); lockout-safety fixes (#401/#402/#404); untransacted-wallet login via signature (#403); A2 signed-login disabled then **re-enabled via SignMultisigTransaction** (lockout-safe) (#405→#407). Address-only login + secure-login upgrade hint (#418).

### Validators monitoring (#423–#428, 06-17)
- Aggregate `/net_info` so test13 peers/nodes match the network (#423); query each node directly (#425); non-blocking peer aggregation (#426); **full Network Nodes roster (Phase 2b)** (#428).

### NFT launchpad + marketplace (#422, #424, #427, #429–#436, #441, 06-17 → 06-19)
- Design spec + Phase 3+ plan (5-lens CTO-validated) + Phase 0 foundation plan (#422/#427).
- Launchpad: verified-collection badge (gated, team-curated) (#429); allowlist mint flow + go-live (#424); allowlist `memba_collections` on test13 (#430).
- **Phase-0 data foundation:** raw immutable event ledger + Sale handler + reorg-safety + points recompute (#431).
- **v3 trading UI:** token grid + approve→list→buy on `memba_nft_market_v3` (#432); admin-panel UX (#435); 404 + CSS fixes (#433/#434).
- **Creator Studio** — manage workspace + GNOT mint-price fix (#441). CI: bump frontend timeout to 30m for the E2E suite (#436).
- **Marketplace Phase 2 (UI rework):** discovery hub (`/nft`), redesigned public collection page, ONE engine-routed `TradeModal` (replaces 5 modals), `NFTMedia`/`PriceBreakdown`/`nftHub` data layer, read-only legacy v1 viewer; retired the code-gen advanced wizard (→ `/nft/create`). Offers gated to a buy/list MVP (`OFFERS_ENABLED=false`); full offer loop in Phase 3 (#443).
- **Indexer v3-correctness:** reject malformed Sale events (#497); fix the v3 launchpad event-contract — `collectionID`/`minter`/`RoyaltySet` (#507); resolve v3 offers on `Sale(via=offer)` (#509). On-chain settlement now has a gnodev integration harness (samcrew-deployer #33) + a go-live/rollback runbook (#504).

### GnoBuilders (#437, #438, #440, #442, 06-18 → 06-19)
- Honest + un-gameable baseline, backend hardening, self-report flow, badge-mint tooling (#437); namespace-verified deploy quests (#438); programmatic badge SVG art + IPFS metadata pipeline (#440); server-side verifiers for join-dao + create-token, Phase 3 (#442).

### Home rework — Control Room (#439, 06-19)
- Action-first home (Phase 0+1): mode-aware Home, ActionInbox/VisitorHero spine, 7 lazy error-isolated StateBoard panels, Landing + Remotion retired (#439). *(Phase 2 server-side `GetHomeSnapshot` in-flight on PR #445.)*

### Known carry-forward (not yet shipped)
- Release tag/version still to cut.
- **test12 cutover DONE** (prod now `test-13`) and **login auth enforcement LIVE** (#460); multisig A3 enforcement (`MEMBA_ENFORCE_MULTISIG_SIG_VERIFY`) still held pending live A3 validation.
- NFT marketplace/launchpad + Services still gated OFF in repo (`VITE_ENABLE_NFT`/`VITE_ENABLE_SERVICES=false`); GnoBuilders badges deployed but never minted. NFT #443 (marketplace Phase 2) open, pending on-chain E2E.
- 28 Dependabot alerts (1 critical) pending a dependency refresh; rotate the OpenRouter key in `.env`; observability (metrics/log-drain) still to stand up.

---

## v6.3.1 — Post-v6.3.0 cleanup (2026-05-26 / 2026-05-27)

> Trailing wave that closed Phase 7, knocked out the remaining dependency-vuln backlog, hardened the team-logo merge seed, fixed mobile overflow, and reorganized `docs/planning/`. Merged via #361–#368 across two days.

### Phase 7 — drop legacy team profile + flag (#362)
- `GnoloveTeamProfileLegacy` removed end-to-end (component, imports, route guards).
- `VITE_GNOLOVE_TEAM_HUB` feature flag deleted from `.env.development`, `.env.example`, `frontend/src/config.ts`, and the `e2e/gnolove-team-hub.spec.ts` flag-gated branches.

### Security — vuln backlog cleared
- **#363** — fixed all high + moderate frontend vulnerabilities (42 alerts) via direct dep bumps + targeted overrides.
- **#365** — fixed 20 pnpm workspace vulnerabilities via root `overrides` and `workspace:*` mcp-server-dao-analyst dep wiring (`fast-uri >=3.1.2`, `hono >=4.12.18`, `@hono/node-server >=1.19.13`, `qs >=6.15.2`, `ip-address >=10.1.1`, `vite >=7.3.2`, `postcss >=8.5.10`).
- **#368** — removed orphan `mcp-server/package-lock.json` (npm v3 lockfile inside a pnpm workspace) that Dependabot kept rescanning despite the root overrides; closes the remaining 16 alerts in one move.

### Reliability + UX
- **#364** — team logo / website / Twitter handle no longer lost when the backend `teams.yaml` payload races the seed merge.
- **#366** — gnolove mobile: prevent horizontal overflow on hero text, fix text sizing on iPhone SE 375px breakpoint.

### Docs / repo hygiene
- **#361** — finalize v6.3.0 changelog + handoff doc.
- **#367** — archive 16 shipped planning docs into versioned `docs/planning/archive/` subdirs (history preserved via `git mv`); track 2 untracked gnolove session docs into `archive/v6.3-gnolove/`; drop stale next-session prompt; remove stray root `package-lock.json`; gitignore `.claude/`; fix 7 broken doc links exposed by the archive move.
- Stale remote branch `docs/handoff-2026-05-19` (from closed PR #341) deleted from origin.

### Pending (carry-forward to v7.1 Phase 1)
- **VPS env update** — add `onbloc/gno-ibc/main` to `GITHUB_REPOSITORIES` on the gnolove VPS (Lours has SSH access).
- **GitHub release** — publish a `v6.3.1` release tag from these notes (Tag Protection bypass-actor required).

---

## v6.3.0 — Gnolove UX overhaul (2026-05-25 / 2026-05-26)

> Major Gnolove UX session: 10 PRs merged (#351–#360), covering architecture refactoring, accessibility, design tokens, test coverage, product trust, topic classifier precision, mobile PWA, team awards, and team profile enrichment.

### Added — PRs #351–#360

- **Architecture refactor (#351).** God-components split: `gnoloveAnalytics.ts`, `gnoloveReportFilters.ts`, `NarrativeReportView` extracted. Error boundaries unified.
- **Accessibility AAA (#352).** `useFocusTrap` + `AccessibleDialog`, SortHeader aria, touch targets (44px min), chart aria-labels, aria-live regions.
- **UX polish + design tokens (#353).** Dead CSS cleanup, light-theme chart tokens, methodology text in collapsible `<details>`.
- **Product trust + shareability (#354).** `og:url`/`og:image` PageMeta, relative-time sync pills with stale warnings, AI report deep-link support, improved "Team not found" empty state.
- **Test coverage (#355).** `gnoloveTime.test.ts`, `gnoloveAnalytics.test.ts`, `gnoloveReportFilters.test.ts`, `TeamHub.test.tsx`.
- **Reliability foundation (#356).** Fixed `/health` endpoint handling, null-array Zod parse, backend-down banner.
- **Focus areas rework + repo badges + team report card + custom dates (#357).** Kill "Other" bucket (4 new topics: consensus, realms, frontend, testing), conventional-commit prefix matching, `gnolang/gno` "core" badge, team report card on hub pages, "Custom" date range with from/to pickers, new 480px mobile breakpoint.
- **Roster popover + team ordering (#358).** Clickable roster metric, case-insensitive login matching, Samouraiworld description update.
- **Topic classifier precision (#359).** 30+ new regex patterns reduce "Other" from 35% to 7.5%. Synced with gnolove backend `topics.yaml` (gnolove#225).
- **Mobile UX + team awards + team profiles (#360).** Dead burger menu hidden, `overflow-x: hidden` on `.gl-page`, 375px iPhone SE breakpoint. Data-driven award badges (Top Contributors, Top Reviewers, Most Efficient). Team logos (GitHub org avatars), websites, and verified Twitter handles on Teams page + team hub headers.

### gnolove backend (gnolove#224, #225)
- Samouraiworld description synced, `onbloc/gno-ibc` added to tracked repos.
- `topics.yaml` expanded with 30+ patterns matching the frontend classifier.

> Phase 7 (drop legacy + flag) shipped 36 hours later in #362 (see v6.3.1 above).

---

## v6.2.3 (Gnolove analytics rework — final 2 panels + Phase 6 canary)

> Last beats of the team-hub rework. Plan §2's analytics promise is now fully delivered: 5 of 5 panels rendering against real data, with end-to-end canary coverage. Only Phase 7 (drop the legacy stub + the `VITE_GNOLOVE_TEAM_HUB` flag) remains, and that's intentionally gated on a few days of clean prod uptime.

### Added
- **Cohort retention panel.** Per-month cohort × month-offset retention grid, sourced from a new gnolove endpoint `GET /contributors/cohorts` (samouraiworld/gnolove#223). Newest cohort at the top; intensity from the shared `--gl-color-heatmap-l0..l4` ramp; empty cells where offset > cohort age render transparent so "hasn't aged yet" looks different from "dropped to zero." Backend math: per-author `MIN(created_at)` over the PR table picks the cohort; 24-month lookback cap.
- **Cross-team collaboration matrix.** 8×8 (auto-grows with `teams.yaml`) review-count matrix from new gnolove endpoint `GET /team-collab?time=...`. Joins `reviews` → `pull_requests` → `users` twice to attribute each review to (authorTeam, reviewerTeam). Self-reviews and dependabot excluded; "outsider" buckets (reviews involving non-team contributors) surface as a footnote. Diagonal cells get a dashed outline so intra-team activity reads distinctly. Driven by the page period selector.
- **Phase 6 — Playwright canary.** New `e2e/gnolove-team-hub.spec.ts` exercises: team hub mounts on `gnoland1`, "Roster updated" chip in header, period tablist URL state, network chip honesty (hidden on `gnoland1`, present on `test12`), all 5 analytics panel titles in trailing-year mode, and the On-Chain Metrics tile is **not** present (catches accidental revert of the v6.2.2 cleanup).
- **Dev/CI flag parity.** New `.env.development` (repo root — `vite.config.ts` sets `envDir: '..'`) sets `VITE_GNOLOVE_TEAM_HUB=true` so `npm run dev` and CI Playwright runs mirror production (where the flag has been on since 2026-05-19). Devs who want the legacy stub override with `.env.local` (also at the repo root). `.env.example` updated with doc-only entries.

### Fixed
- **Phase 6 canary actually green in CI.** Three follow-up corrections shipped after #346 landed red on main:
  1. `.env.development` was at `frontend/` but Vite's `envDir: '..'` reads from the repo root, so the flag was never loaded in dev/CI — moved to repo root.
  2. The period-tablist canary clicked a tab named `/Weekly/i` that never existed; labels are `Last week` per `TEAM_HUB_PERIOD_LABELS` — regex fixed.
  3. The 5-panels canary asserted panel titles, but each panel `<h2>` is gated behind `{data && (...)}` — without backend reachability from the runner (CORS blocks `localhost:5173`), no panels mount. Test now soft-skips with a clear reason rather than failing; data-mode runs on memba.samourai.app remain authoritative.

### Internal
- New Zod schemas: `CohortRowSchema` / `CohortsResponseSchema` and `TeamCollabCellSchema` / `TeamCollabResponseSchema`.
- New API client functions: `getContributorCohorts()`, `getTeamCollab(period)`.
- New hooks: `useGnoloveCohorts()`, `useGnoloveTeamCollab(period)` — 5-min staleTime matching the backend ristretto cache.
- New CSS namespaces: `.gl-cohort-grid-*`, `.gl-collab-matrix-*` (both reuse the topic-heatmap intensity ramp). `.gl-panel-footnote` utility class for the outsider-reviews line.

### gnolove backend (samouraiworld/gnolove#223)
- Two new aggregation endpoints — no new tables, no migrations, no new ingestion. `Review.AuthorID` + `Review.PullRequestID` was already populated by `syncPRs()` (see `server/sync/sync.go:263`); the new endpoints just aggregate from there + the PR `created_at` index.

### Tests
- 1843/1843 vitest unchanged.
- New Playwright canary spec covers the team hub + all 5 analytics panels.
- gnolove backend: full Go suite still green; new `handler/contributor/cohorts_test.go` + `handler/teams/collab_test.go` cover the cohort math, the dependabot/self-review exclusions, the outsider buckets, and the cache-hit behavior.

### Pending
- **Phase 7** — drop `GnoloveTeamProfileLegacy` + the `VITE_GNOLOVE_TEAM_HUB` flag. Gated on 3+ days of clean hub uptime (so don't open before 2026-05-23). Small cleanup, not a feature.

Handoff: [`docs/reports/handoff-team-hub-2026-05-20.md`](docs/reports/handoff-team-hub-2026-05-20.md).

---

## Unreleased — v6.2.2 (Gnolove audit fixes + Analytics period URL + 3 of 5 plan §2 panels)

Shipped 2026-05-19 via memba#344. See plan §4.1 for the full breakdown. Highlights:
- **3 of 5 plan §2 analytics panels** — PR cycle-time histogram, topic activity heatmap (16 topics × 12 months via the live `/topics` taxonomy), repo health matrix (traffic-light cells for PRs/wk, median cycle, open backlog, last activity).
- **`/gnolove` audit fixes (P0+P1)** — On-Chain Metrics tile removed (plan §2), `GnoloveTeams` slimmed to the index link grid plan §2 asked for, Score Factors badge folded into a `<details>` to hit the 5-section cap, "Last sync" → "Roster updated" pill (honesty), `TeamHubMetricsGrid` + `TeamHubActiveReposCard` distinguish "data unavailable" from "legitimately quiet period" instead of silently rendering 0s, auto-degrade banner above the legacy stub (plan §3 R-4), dual-threshold % surfaced inline on Primary/Secondary repo rows, AI report `?aiReport=<id>#<project>` deep-link with auto-expand + scroll + reduced-motion-safe highlight flash.
- **Period selector consistency** — Home time-filter migrated to `role="tablist"`; Analytics gains a tablist + URL state (`?time=`).

---

## Unreleased — v6.2.1 (Team-hub UX polish + Phase-7 a11y)

Shipped 2026-05-19 via memba#343. Highlights:
- Period selector → `role="tablist"` matching the `GnoloveReport` pattern. `aria-current`/`aria-selected` on the active period.
- Skeleton fidelity — each of the four loading cards renders a card-shaped placeholder instead of the generic 3-line stack. `aria-busy="true"` on the card, `aria-hidden="true"` on the skeleton DOM.
- `aria-live="polite"` regions on metrics, active repos, focus pills, recent activity so period changes announce.
- New `--gl-font-mono` token; 84 hardcoded `JetBrains Mono` declarations consolidated to `var()` references.
- `@media (max-width: 768px)` block for `.gl-thub-*` — header stacks, metrics grid drops to 2 cols, paddings tighten.
- Reduced-motion respect extended to team-hub interactives (cards, pills, repo rows, AI toggle).

---

## Unreleased — v6.2.0 (Gnolove Team Hub Rework)

> Makes `/:network/gnolove/teams/:teamName` the section's primary noun — team composition + active repos + scoped metrics + Focus Areas pills + embedded AI reports. Plan: [`docs/planning/archive/v6.3-gnolove/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md`](docs/planning/archive/v6.3-gnolove/GNOLOVE_REWORK_TEAM_HUB_IMPLEMENTATION_PLAN.md). Live in production behind `VITE_GNOLOVE_TEAM_HUB`, flipped on Netlify 2026-05-19.

### Added
- **Phase 0 (#337)** — `jsPDF` lazy import (~135 KB gz off first paint); `useGnoloveYearReport()` exported as the shared base query so derived hooks reuse the same cache; `SectionErrorBoundary` extracted; TEAMS uniqueness invariants locked in vitest; design-system token additions for PR-state + Recharts palette + heatmap ramp; MSW + fast-check + `@axe-core/playwright` added as dev deps.
- **Phase 3 (#338)** — `useGnoloveTeams()` seed + fetched-union hook: build-time `TEAMS` constant becomes the seed; backend `GET /teams` replaces it once the network resolves. `KNOWN_TEAMS` becomes async-aware; localStorage cache key bumped `v1 → v2`.
- **Phase 4 (#339)** — Team Hub MVP behind `VITE_GNOLOVE_TEAM_HUB`. Six cards under `components/gnolove/teams/`: `TeamHubHeader` (name + colour stripe + period selector + "Last sync" pill + "Data: mainnet" chip on `test12`), `TeamHubMetricsGrid`, `TeamHubActiveReposCard` (dual-threshold "Primary" / "Also contributes to" rows), `TeamHubFocusAreasCard` (5 pills), `TeamHubRecentActivityCard`, `TeamHubAIReportsCard`. `useTeamProfileUrlState` URL-state codec; `lib/gnolovePeriod.ts` extraction; per-card `CardErrorBoundary`; `useGnoloveBackendHealth()` auto-degrades to `GnoloveTeamProfileLegacy` after 2× HEAD failure in 30s.
- **Phase 5 (#340)** — AI report v2 polish. Shared `<AIReportCard>` backs both the standalone page and the team-hub embed. Short summary visible by default; "Read Detailed Report" toggle expands the long form inline on desktop, opens as a bottom-sheet on mobile (<768px). `?id=` → `?aiReport=` URL namespace migration with back-compat. Empty-string-safe coalescing (`||`, not `??`) for the additive Zod migration on `summary_short` / `summary_long`.
- **Phase 2c (#342, paired with gnolove#222)** — Focus Areas taxonomy moves server-side. `gnolove/server/config/topics.yaml` (16 topics, ported verbatim from the legacy TS regex bag) is now the source of truth, exposed via `GET /topics`. Memba consumes via `useGnoloveTopics()` seed-union (same shape as `useGnoloveTeams`); `computeFocusAreas(signals, rules?)` accepts caller rules with the build-time copy as default. `FocusTopic` widened from a literal union to `string` since the backend now owns the taxonomy. `compileBackendTopic` drops invalid regexes with a warning rather than crashing the card.

### Changed
- The Team Hub auto-degrades to the legacy stub if the gnolove backend reports unhealthy — no Netlify redeploy required to mitigate a backend hiccup.

### Operator decisions logged
- **Q-1** Curated ~50 tracked repos (not naive ~120). **Q-2** Dual-threshold "active repo" rule (>2% of team's PRs AND >5% of repo's PRs → Primary; below → "Also contributes to"). **Q-3** Both AI summaries visible inline; toggle labelled **"Read Detailed Report"**. **Q-4** Client-side AI report team filter. **Q-5** Focus Areas pills v1 (matrix is v1.5 behind a sub-flag). **Q-6** 24h EU-business Lours SLA for roster changes; emergency client-side seed-edit fallback. **Q-7** No staging; rollout = Netlify Deploy Previews + 24h production canary. Full text in plan §6.

### Tests
- Memba: 1838/1838 vitest passing (started this version at 1759). New: 23 around `useGnoloveTopics` + Focus Areas refactor; 19 around `useGnoloveTeams`; full coverage of seed-union loading / success / null / empty-roster branches; per-card error boundary tests.
- gnolove backend: full Go suite green; `TestLoadRealConfigFile` smoke tests both `teams.yaml` and `topics.yaml` against the real checked-in YAML so a bad commit fails CI.

### Not in this version (intentionally)
- **Phase 2b** — curated `~50-repo` expansion in `infra_gnolove` (deferred; revisit when Mistral context-budget pressure justifies).
- **Phase 5.5** — CORS glob for `*.netlify.app` previews (dropped 2026-05-19: operator opted for prod-only testing).
- **Plan-original Phase 6** — Analytics rework (cycle-time histogram, cohort retention, repo health matrix, topic-time heatmap, cross-team collab matrix). Deferred; operator redefined Phase 6 as a 1-day Playwright canary instead.
- **Plan-original Phase 7** — UX polish + a11y (empty states, skeleton fidelity, tabs pattern consistency, focus management on dropdowns, motion gating, `var(--font-mono)` consolidation). Being audited 2026-05-19 as candidate work for a v6.2.x patch release.

### Internal
- New components: `components/gnolove/teams/` (TeamHub + 6 cards + `CardErrorBoundary`).
- New hooks: `useGnoloveTeams`, `useGnoloveTeam`, `useGnoloveTeamActiveRepos`, `useGnoloveTeamStats`, `useGnoloveTopics`, `useGnoloveBackendHealth`, `useTeamProfileUrlState`.
- New API client: `getTeams`, `getTeam`, `getTeamActiveRepos`, `getTeamStats`, `getTopics`.
- New Zod schemas: `BackendTeamSchema`, `TeamsResponseSchema`, `TeamResponseSchema`, `ActiveReposResponseSchema`, `TeamStatsResponseSchema`, `BackendTopicSchema`, `TopicsResponseSchema`.
- gnolove backend: new packages `server/teams`, `server/topics`, `server/handler/teams`, `server/handler/topics`. New endpoints: `GET /teams`, `GET /teams/:slug`, `GET /teams/:slug/active-repos`, `GET /teams/:slug/team-stats`, `GET /topics`. Two new env vars: `TEAMS_CONFIG_PATH` (default `config/teams.yaml`), `TOPICS_CONFIG_PATH` (default `config/topics.yaml`).

Handoffs: [`docs/reports/handoff-team-hub-2026-05-18.md`](docs/reports/handoff-team-hub-2026-05-18.md), [`docs/reports/handoff-team-hub-2026-05-19.md`](docs/reports/handoff-team-hub-2026-05-19.md).

---

## Unreleased — v6.1.0 (Gnolove shareable URLs + section UX hardening)

### Added
- **Gnolove — shareable report URLs.** Every filter on `/:network/gnolove/report`
  (period, period offset, status tab, team, repository set, view mode) now
  serializes to URL query params. Absolute period keys (ISO-8601
  `at=2026-W18` / `2026-05` / `2026`) so links stay valid forever — a Friday
  link still shows the same week on Monday. Same treatment for
  `/gnolove` (Home scoreboard: timeFilter / sort / excludedTeams /
  selectedRepos / page) and `/gnolove/reports` (AI archive: `?id=` deep-link
  with auto-scroll + highlight flash). `Copy link` button on the Report
  reconstructs the URL from validated state (Web Share API fallback on mobile).
- **Per-page contextual `document.title`** + `og:title` / `twitter:title` via
  a new `<PageMeta>` component (race-safe cleanup, no react-helmet).
- **Stale-repo / stale-team warning banners** on the Report when a shared
  URL pins a repo or team that no longer exists.
- **Smarter empty states**: branches per reason (no_data / team / repo /
  team_and_repo / filter) with scoped "Clear that one filter" buttons.

### Fixed
- **BUG-1**: all internal gnolove `<Link to="…">` use `useNetworkPath()`;
  SubNav + 12 link sites no longer detour through `LegacyRedirect` (extra
  render + URL flicker).
- **BUG-2**: Report no longer silently empties when the default repo
  (`gnolang/gno`) is missing from the backend response — a dismissible
  warning banner appears.
- **BUG-3**: Report "Highlights" (top 5 merged PRs) now sorts by `mergedAt`
  descending. Previously sorted by `title.length` (a meaningless proxy).
- **BUG-4**: PR status badge derives from PR data (`statusFor()`), not from
  the active tab. Blocked PRs now correctly show "Blocked" on the "All" tab.
- **BUG-5**: Switching period preserves time-window context. April week 18
  (which ends 2026-05-03) → Monthly now lands on **May**, not the current
  month. `all_time → weekly` no longer teleports to 1980.
- **BUG-6**: Report MD-export footer ID matches the report's period
  (was always week-ID regardless). Footer also embeds a "Filter URL" share
  link with `view=table` stripped.
- **UX-1**: `aria-current` on active period/status tabs; `aria-pressed` on
  view toggle; `aria-haspopup="listbox"` + `aria-expanded` on the repo
  multi-select; `role="tablist"` on tab groups.

### Internal
- New `lib/gnoloveReportUrl.ts` + `lib/gnoloveHomeUrl.ts` URL-state codecs
  with Zod validation, year-range cap, repos size cap, charset-restricted
  team allowlist, rate-limited Sentry breadcrumb on parse fallback.
- New `hooks/gnolove/useReportUrlState` + `useHomeUrlState` hooks with
  push/replace history strategy (push on coarse axes; replace only on
  `view` toggle).
- New `components/gnolove/PageMeta` (~50 LOC, race-safe `document.title`).
- `frontend/package.json` bumped `4.0.0 → 4.1.0` so Sentry release name is
  `memba@4.1.0`.
- Tests: 1,759 vitest (1,659 baseline + 100 new) + 13 Playwright chromium
  specs (3 new for URL-state behavior).

Plan: [`docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md`](docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_PLAN.md) (Rev1, ~1,750 lines).
Expert review (6 panels, immutable audit trail):
[`docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md`](docs/planning/archive/v6.1-shareable-urls/GNOLOVE_SHAREABLE_REPORT_URLS_EXPERT_REVIEW.md).

---

## Unreleased — post-v6.0.3 patches (Phase 0 wind-down)

- **#333** `fix(deploy)`: Sentry source-map assertion was a false negative (the
  Vite plugin deletes maps after upload by design) — replaced with a token-presence
  log. Fly → GHCR mirror jq query corrected (schema is
  `Registry/Repository/Tag`, not `.Ref`). After this, the GHCR mirror image
  `ghcr.io/samouraiworld/memba-backend:<sha>` is produced on every backend deploy.
- **#314** `fix(ux)`: improve error messages + execute button theme token.
- **#329** `chore`: rename `MikaelVallenet` → `mvallenet` in the gnolove
  contributors constant (matches the actual GitHub login casing).
- **#330** `docs(planning)`: v7.1 implementation plan + two expert review trails +
  PR triage runbook (5 markdown files under `docs/planning/`).
- **#334** `docs(reports)`: Phase 0 signoff record at
  `docs/reports/v7.1-phase0-signoff.md`.

Plan reference: `docs/planning/MEMBA_V7_1_IMPLEMENTATION_PLAN.md` §4.

## v6.0.3 (Phase 0b of v7.1) — Frontend deps, dependency policy, dependabot pause, OWASP regression suite

### Security
- **`@clerk/clerk-react`** bumped `^5.61.4` → **`^5.61.6`** (closes
  `GHSA-vqx2-fgx2-5wq9` + `GHSA-w24r-5266-9c3c`). Memba does not call any
  of the affected APIs (`has()`, `auth.protect()`, `createRouteMatcher`,
  billing, reverification, orgs) — see `docs/DEPENDENCY_POLICY.md` §7 for
  the evidence.
- **`@clerk/themes`** bumped `^2.4.57` → **`^2.4.60`** (peer of clerk-react).
- **`package.json` `overrides`**: `@clerk/shared` pinned to **`^3.47.5`** so
  the transitive cannot drag in a vulnerable copy.
- **`dompurify`** added as a **direct dep** at **`^3.4.2`** + `overrides`
  entry to coerce the `jspdf` transitive. Closes
  `GHSA-39q2-94rc-95cp`, `GHSA-h7mw-gpvr-xq4m`, `GHSA-crv5-9vww-q3g8`,
  `GHSA-v9jr-rg53-9pgp`. Memba's 3 sanitize call sites all use default
  config — not directly exploitable by the 4 CVEs.

### Folded patch bumps (10 dependabot PRs closed at merge)
- `@sentry/react` ^10.47.0 → ^10.49.0 (PR #315)
- `@tanstack/query-sync-storage-persister` ^5.99.0 → ^5.99.2 (PR #317)
- `@tanstack/react-query-persist-client` ^5.99.0 → ^5.99.2 (PR #319)
- `@tanstack/react-query` ^5.99.0 → ^5.99.2 (PR #327)
- `typescript-eslint` ^8.58.0 → ^8.59.0 (PR #322)
- `typescript` ~6.0.2 → ~6.0.3 (PR #326)
- `connectrpc.com/connect` v1.19.1 → v1.19.2 (PR #316)
- `github.com/cosmos/cosmos-sdk` v0.54.0 → v0.54.2 (PR #318; `internal/auth`
  test suite ran clean)
- `modernc.org/sqlite` v1.48.2 → v1.50.0 (PR #328)

### Tests
- New `frontend/src/lib/__tests__/sanitize-regression.test.ts` — 30 OWASP-style
  XSS vectors run against the production `DOMPurify.sanitize(html)` call
  shape (the same shape used at `NFTGallery.tsx:489`,
  `RealmDetailDrawer.tsx:164`, `SourceCodeView.tsx:116`). Locks the
  dompurify ≥ 3.4.2 baseline. Includes a meta-assertion that the helper
  passes no options (any future addition of `ADD_TAGS`, `RETURN_DOM`,
  `CUSTOM_ELEMENT_HANDLING`, or `SAFE_FOR_TEMPLATES` re-opens the closed
  CVE class and fails the test).

### Policy / process
- **New `docs/DEPENDENCY_POLICY.md`** — cadence, SLA (CRITICAL 24h /
  HIGH 5 BD / MODERATE 30d / LOW quarterly), responsibility matrix, group
  + auto-merge rules, Memba-specific exploitability evidence, allowlist
  procedure with 14-day expiry, escalation path, reviewer checklist.
- **New `.github/workflows/dependency-review.yml`** —
  `actions/dependency-review-action@v4` gates every PR; fails on severity
  ≥ HIGH; license allowlist (MIT / Apache-2.0 / BSD-2/3-Clause / ISC /
  MPL-2.0 / 0BSD / Unlicense / CC0-1.0).
- **`.github/dependabot.yml`** rewritten — grouping (tanstack, sentry,
  clerk, eslint, dev-deps, cosmos, connectrpc), `ignore: semver-major`,
  added `github-actions` ecosystem, `open-pull-requests-limit: 0`
  (**paused** for the v7.1 program; restored in Phase 6).

### Deferred (tracker)
- `eslint-plugin-react-hooks` stays at `~7.0.1`. The 7.1.x line adds
  `react-hooks/set-state-in-effect` which flags 60 patterns Phase 3
  React Query migration will eliminate. PR #320 closed; re-bump after
  Phase 3.
- `eslint` 10 (PR #324 closed; v7.2 spike).
- `vite` 8 (PR #325 closed; v7.2 spike).
- Clerk patch PR #323 closed (superseded — we jumped to 5.61.6 in this PR).

## v6.0.2 (Phase 0a of v7.1) — CI unblock, AUTH-CHAINID-01, rollback hardening

### Security
- **MEMBA-2026-001 / AUTH-CHAINID-01**: ADR-036 sign document now embeds the
  real `chain_id` instead of `""`. Auth tokens carry the chain they were issued
  for; cross-chain token replay is rejected. Includes a 24h legacy grace window
  for pre-fix clients. See `docs/advisories/MEMBA-2026-001.md` for the full
  write-up.

### CI / infrastructure
- Bumped Go toolchain to **1.25.10** across `go.mod`, `ci.yml`,
  `deploy-backend.yml`, and `backend/Dockerfile` (pinned `golang:1.25.10-alpine`).
  Closes `GO-2026-4918`, `GO-2026-4971`, `GO-2026-4980`, `GO-2026-4982`.
- Pinned `govulncheck` to `v1.3.0` in every workflow site (no more `@latest`).
- `security.yml` now uses `go-version-file: backend/go.mod` (was stale at
  `1.23`); dropped the duplicate `backend-audit` job that conflicted with
  `ci.yml` + `govulncheck.yml`.
- `deploy-frontend.yml`: removed `|| true` from `npm audit` (silent failure
  forbidden) and switched the production audit to `--omit=dev`.
- `deploy-frontend.yml`: wired `SENTRY_AUTH_TOKEN` into the build env so
  source maps actually upload, plus an explicit guard that fails the job if
  no `*.js.map` files were produced.
- `npm ci --ignore-scripts` on the Netlify build path (supply-chain defense).
- Frontend `Dockerfile`: default `VITE_GNO_CHAIN_ID` bumped from the stale
  `test11` to `test12`.

### Rollback / deploy hardening
- `fly.toml` now declares `[deploy] strategy = "rolling"` with
  `wait_timeout = "5m"` — bluegreen is incompatible with this app (volume +
  single-machine). See `docs/OPS_RUNBOOK.md` §4.
- Both deploy workflows now use `cancel-in-progress: false` so concurrent
  deploys **queue** instead of cancelling mid-traffic-flip.
- `deploy-backend.yml` now mirrors every successful Fly deploy to GHCR
  (`ghcr.io/samouraiworld/memba-backend:<git-describe>`) as a long-lived
  rollback artifact (Fly registry retention is undocumented).

### Headers
- Added `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  to `netlify.toml`.

### Docs
- New `docs/advisories/MEMBA-2026-001.md`.
- New `docs/comms/v7.1-token-rotation.md` (user-facing banner + Discord copy).
- New `docs/comms/v7.1-adena-disclosure.md` (coordinated disclosure draft).
- New `docs/OPS_RUNBOOK.md` (rollback playbooks, recurring tasks, SLO).

## v6.0.0 (2026-04-16) — Security Hardening, AVL Migration & Accessibility

### Security (10 fixes)
- **AUTH-01**: Pubkey-bound challenges prevent zero-click account takeover
- **SEC-01**: Removed unauthenticated `/api/eval` endpoint
- **SEC-02/03**: Auth required on IPFS upload and AI analyst endpoints
- **SEC-04**: Removed CORS wildcard for Netlify deploy previews
- **SEC-06**: Rate limiting now uses `Fly-Client-IP` (spoofing-proof)
- **SEC-NEW-01**: Fixed JSON injection in ABCI query construction
- **SEC-NEW-03**: Added 1MB body size limit to ConnectRPC handler
- **SEC-NEW-04**: Removed user-controllable LLM prompts (prompt injection)
- **SEC-05**: NFTGallery XSS fix (DOMPurify after markdown conversion)

### Gno Templates
- **GNO-NEW-01**: Unified AVL import paths (`p/demo/avl` → `p/nt/avl/v0`) across all templates
- **GNO-01**: Migrated daoTemplate from slices to AVL trees (O(n) → O(log n) lookups)
- **GNO-02**: Added `Render("page:N")` pagination to agent_registry, escrow, and daoTemplate
- **DEFI-01**: Fixed escrow dispute timeout — now refunds CLIENT (was releasing to freelancer)

### UX & Accessibility
- **UX-01**: Global `:focus-visible` styles for keyboard navigation (WCAG 2.1 AA)
- **UX-02**: Added 320px breakpoint with overflow guards
- **UX-04**: Vote confirmation dialog before irreversible on-chain votes
- **ARCH-07**: Replaced hardcoded hex colors with theme tokens in 3 files

### Infrastructure
- `min_machines_running = 1` (prevents cold start DoS)
- Memory: 256MB → 512MB
- ED25519_SEED startup guard (fails if unset in production)
- `npm test` added to deploy-frontend CI gate
- Coverage reporting (backend + frontend) with artifact upload
- Bundle size budget enforcement (main chunk < 600KB)
- Gno lint now fails CI (removed `|| true`)

### Docs
- `docs/planning/archive/v6/MEMBA_V6_IMPLEMENTATION_PLAN.md` — 32-expert audit, 108 issues catalogued
- `docs/SECRETS_ROTATION.md` — rotation procedures for all credentials
- `docs/PROGRESSIVE_DECENTRALIZATION.md` — roadmap for reducing centralization

## Version History

| Version Range | File | Period |
|---------------|------|--------|
| **v4.0** | [changelogs/v4.0.md](changelogs/v4.0.md) | 2026-04-08 |
| **v3.x** (v3.1–v3.2) | [changelogs/v3.x.md](changelogs/v3.x.md) | 2026-04-04 — 2026-04-06 |
| **v2.14–v2.29** | [changelogs/v2.14-v2.29.md](changelogs/v2.14-v2.29.md) | 2026-03-17 — 2026-04-02 |
| **v1.0–v2.13** | [changelogs/v1.0-v2.13.md](changelogs/v1.0-v2.13.md) | Pre-2026-03-17 |
