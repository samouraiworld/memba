# SESSION_SYNC — parallel Claude session coordination (append-only; newest on top)

Format: `<UTC time> · <lane> · <wave/item> · START|STOP · files/areas being touched · branch`

Rules:
- Read this file before your first edit of a session; re-read before touching a single-writer file.
- Single-writer files (register here before touching): `api/**` + generated code, `frontend/.env.example`, `CHANGELOG.md`, CI yaml, shared hooks (`useAdena`, tx toolkit).
- Lane C OFF-LIMITS while active (external: #734 / per-sig-verified): `backend/internal/auth/**` (all) · signature RPC handlers in `backend/internal/service/tx_rpc.go` · signature/verified fields in `api/memba/v1/memba.proto` + regenerated code · signing-call paths in `frontend/src/hooks/useAdena.ts` (`SignMultisigTransaction`) — the connection/account-change logic in that file is Lane A; register the split here before either side edits.
- Program reference: `docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md`.

---

2026-07-15 · Lane B · Feed v2 B.5 GetFeedStats singleflight cache · START · backend ONLY, non-single-writer files: `backend/internal/service/feed_rpc.go` (cachedFeedStats + assembleFeedStats + feedStatsTTL), `backend/internal/service/service.go` (feedStats cache fields), `backend/internal/service/feed_stats_cache_test.go` (new), `backend/.env.example` (FEED_STATS_TTL doc — NOT the single-writer frontend/.env.example). No `api/**`, no CHANGELOG (no-changelog: internal perf, API contract unchanged), no CI yaml. ⚠️ MERGE-HOLD: backend merge auto-deploys Fly (deploy-backend.yml on push:main) → owner-gated. branch perf/feed-stats-cache

2026-07-15 · Lane A/B · Feed v2 pre-Jul-20 remainder (Wave A1 + B) · START · NEW files only (no shared-file contention): `frontend/src/lib/feedOg.ts` (+test, pure OG builders w/ tombstone guard), `frontend/netlify/edge-functions/feed-og.ts` (Deno handler — base=frontend → discovered at frontend/netlify/, NOT repo-root; netlify.toml UNTOUCHED), `frontend/src/components/feed/FeedShareCard.tsx` (+test, canvas PNG, Riso-light), PostCard share-menu mount, `frontend/e2e/feed-live.spec.ts` + `.env.e2e-feed`-style flag env, backend `internal/service/feed_rpc.go` GetFeedStats singleflight (+test). CHANGELOG.md (single-writer: will register per-PR). ⚠️ MERGE-HOLD: edge-fn PR (auto-deploys via Netlify-native on merge) + GetFeedStats PR (auto-deploys Fly via deploy-backend.yml) = prod deploys → owner-gated; canvas card + e2e are gate-mergeable. Branches: feat/feed-og-edge-fn, feat/feed-share-card, test/feed-live-e2e, perf/feed-stats-cache

2026-07-13 · Lane B · Feed v2 planning (deep-dive + expert panel) · START→STOP (single session) · docs ONLY: docs/planning/MEMBA_FEED_V2_PLAN_2026-07-13.md (new) + this registration · no source changes; 4 code audits + 8-lens expert panel + 3 adversarial verifiers → consolidated plan, FOR OWNER REVIEW (no implementation until §10 owner go) · KEY LIVE-STATE FINDINGS for any other session: VITE_ENABLE_FEED is ALREADY ON in prod (feed public); FEED_MODERATION_BEARER UNSET in prod (takedown lever inert — P0 owner action); VITE_ENABLE_REACTIONS is a FOOTGUN (deployed realm lacks entrypoints → every tap panics; DO NOT flip until memba_feed_v2); deployed feed realm = old build (no reactions/moderator role). No feed source touched — feed code is FREE to edit; if you implement, follow the plan's Wave A0 first (block_ts backfill, Feed→mobile tab bar, copy truth-up) · branch docs/feed-v2-plan-2026-07-13

2026-07-09 · Lane B · Wave 0.3 blog SEO pack (plan #862) · START→STOP (single session) · frontend: lib/sitemap.ts (+test, SitemapEntry), lib/blogMeta.ts (+test, new), lib/markdownLite.ts (+test, opt-in images — feed/realm renderers UNCHANGED), pages/Blog.tsx + blog.css, index.html (RSS autodiscovery), vite.config.ts (articles → sitemap) · CHANGELOG.md (single-writer: registered) · branch feat/blog-seo-pack · B3 files still untouched (that session's PR = #864)

2026-07-09 · Lane B · Wave 0 execution (plan #862, owner go): #851 merged; backend perf PR; Home de-stale pack · START · frontend: components/home/{homeSurfaces.tsx(new),ExploreGrid,ComingSoon,ValueStrip,VisitorHero,EcosystemBand,ActivityFeed}(+tests), lib/activity.ts(+test) · backend: internal/indexer/{recover.go(new),tailer,feed_tailer,poller}, internal/service/{quest_rpc,service,leaderboard_test}, internal/metrics · CHANGELOG.md (single-writer: registered) · **B3 session detected LIVE (launch.json edit ~14:15): NOT touching lib/appStore.ts / pages/AppStore.tsx / .env.example / safeFlags — Wave 0.6 App Store S-wins ON HOLD until B3 lands** · branches fix/indexer-recover-leaderboard, feat/home-destale

2026-07-09 · Lane B · next-cycle kickoff: 12-lane audit → consolidated plan (docs only) · START→STOP (single session) · docs/planning/MEMBA_NEXT_CYCLE_AUDIT_AND_PLAN_2026-07-09.md (new) + this registration · no source changes; plan awaits owner review before any implementation · docs/next-cycle-plan-2026-07-09

2026-07-09 · Lane B · App Store B1b Report/FlagApp write-side · START→STOP (single session) · frontend: components/appstore/ReportAppButton.{tsx,test.tsx} (new), lib/appStore.ts (buildFlagAppMsg), pages/AppStore.tsx (mount in apptrust, flaggable states only), pages/appstore.css · CHANGELOG.md (single-writer: registered) · active-realm write (v2 now, v3 after repoint); no new flag · feat/appstore-report-app

2026-07-09 · Lane B · validator-name resilience P0-B (plan: VALIDATOR_NAMING_RESILIENCE_PLAN_2026-07-08) · START→STOP (single session) · frontend: lib/gnomonitoring.ts (any-endpoint seeding, isRealMoniker, 7d last-good localStorage cache) + gnomonitoring.test.ts, lib/validators.ts (guarded moniker adoption ×3, keying note) · CHANGELOG.md (single-writer: registered) · gnomonitoring root fix = PR #116 (separate repo, owner deploys VPS) · fix/validator-name-resilience
2026-07-09 · Lane B · on-chain blog reader (backlog item 8, realm = deployer PR #74) · START→STOP (single session) · frontend: lib/blogOnchain.ts + blogSource.ts + blogOnchain.test.ts (new), lib/config.ts (isOnchainBlogEnabled), pages/Blog.tsx (source hook), pages/Blog.test.tsx (QueryClient harness), .env.example (single-writer: registered) · behind VITE_ENABLE_ONCHAIN_BLOG (off; realm not deployed) · feat/onchain-blog-reader

2026-07-09 · Lane B · repo hygiene session · START→STOP (single session) · docs/planning archive sweep (shipped plans → archive/shipped-2026-07 with status banners), rescue VALIDATOR_NAMING_RESILIENCE_PLAN + SPACE_INVADERS_AAA_PLAN into git, BACKLOG_PLAN status header; test deflake PostCard.test.tsx (fix/postcard-edit-test-flake); marketplace-v2 branch pushed + draft PR #851 (no source changes to it); stale worktrees/branches pruned · CHANGELOG.md untouched (docs+test only) · docs/planning-rescue-and-archive

2026-07-09 · Lane C · per-signature verified badge (finishing the Jul-3 WIP) · START→STOP (single session) · api/memba/v1/memba.proto (Signature.verified=5) + buf regen (backend/gen, frontend/src/gen) · backend: internal/service/tx_rpc.go (store+read verdict), tx_sig_verified_test.go (new), migrations/023_sig_verified.sql (new) · frontend: multisig/ProgressBar.tsx, TransactionView.{tsx,test.tsx}, txview.css · CHANGELOG.md (single-writer: registered) · fix/per-signature-verified-flag

2026-07-05 · Lane A · feed P1.5 thread/profile views · START→STOP (single session) · frontend: components/feed/{PostCard,FeedComposer}.tsx (new, extracted), lib/feedTypes.ts + feedTypes.test.ts (new), pages/FeedPage.tsx (refactor to shared components + nav), pages/FeedThread.tsx + FeedProfile.tsx (new), App.tsx routes (feed/post/:id, feed/user/:address), pages/feed.css, e2e/feed-gating.spec.ts (sub-route gating) · CHANGELOG.md (single-writer: registered) · reads live GetFeedThread/GetUserFeed RPCs — no realm/backend change; behind VITE_ENABLE_FEED · branch feat/w72-feed-thread-view

2026-07-04 · Lane A · UX polish (owner-requested): nav placement + marketplace/blog redesign + validator reviews fix · START→STOP (single session) · frontend: lib/navManifest.ts, components/layout/Sidebar.tsx (+test), pages/UnifiedMarketplace.tsx + unified-marketplace.css, pages/Blog.tsx + blog.css, pages/Validators.tsx, components/validators/{ValidatorReviewStars.tsx,validatorReviewsData.ts} (+test) · CHANGELOG.md (single-writer: registered) · no auth/sig paths; no api/**; no shared tx hooks · branch feat/ux-polish-jul4

2026-07-04 · Lane B · W7.3 activity bot · START→STOP (single session) · backend: cmd/activitybot/{main,scenario,state,runner}.go + tests + scenario.example.json (new), docs/ACTIVITYBOT_RUNBOOK.md (new) · CHANGELOG.md (single-writer: registered) · testnet-only tool, not wired into any service; emits gnokey commands (no in-process key) · branch feat/w73-activity-bot

2026-07-04 · Lane A · W7.1 PR1 marketplace My Listings · START→STOP (single session) · frontend: lib/myListings.ts + myListings.test.ts (new), components/marketplace/MyListingsView.tsx (new), pages/UnifiedMarketplace.tsx (tab + route), pages/unified-marketplace.css (append), e2e/marketplace-my-listings.spec.ts (new) · CHANGELOG.md (single-writer: registered) · existing marketplace flags only; no new realm/flag · branch feat/w71-my-listings

2026-07-04 · Lane A · W7.2 feed P1 /feed UI · START→STOP (single session) · frontend: pages/FeedPage.tsx + feed.css (new), components/ui/FeedGate.tsx (new), lib/feed.ts + feedApi.ts + feedConstants.ts (new), lib/config.ts (isFeedEnabled + feedPath), components/layout/Sidebar.tsx (FLAG_ON += VITE_ENABLE_FEED), lib/navManifest.ts (feed entry + MORE_NAV_IDS), lib/routeMeta.ts + lib/sitemap.ts (paired), App.tsx route, .env.example ×2 + .env.e2e, e2e/feed-gating.spec.ts (new) · CHANGELOG.md (single-writer: registered) · behind VITE_ENABLE_FEED (off by default; realm not yet deployed) · branch feat/w72-feed-ui

2026-07-04 · Lane B · W7.2 feed slice 1 · backend P0 DONE + MERGED #753 (proto: 3 NEW Feed RPCs + messages, NOT sig/verified fields; buf regen; migration 018_feed.sql; feed_tailer/feed_dispatch in internal/indexer; feed_rpc.go; main.go wiring behind FEED_WATCHED_REALMS) · deployer memba_feed_v1 realm MERGED (#56).
2026-07-04 · Lane A · stale-chunk crash fix (owner-reported, mobile) · START→STOP (single session) · frontend: lib/staleChunk.ts (new — matcher + reload budget), components/ErrorBoundary.{tsx,test.tsx} (WebKit phrasings), main.tsx (vite:preloadError one-shot reload) · CHANGELOG.md (single-writer: registered) · fix/chunk-error-auto-recovery

2026-07-04 · Lane B · W6.1 PR3 changelog CI gate · START→STOP (single session) · .github/workflows/changelog.yml (new; check name "Changelog entry" — owner U-9 adds it to required checks) · ci/changelog-check

2026-07-04 · Lane A · W6 closure: articles 2–3 + W6.2 skip decision · START→STOP (single session) · frontend/content/blog/ (2 new articles), roadmap doc (W6.2 SKIPPED, gate status) · feat/blog-articles-2-3 · merged under owner's delegated trust (owner may request edits anytime)

2026-07-04 · Lane A · W6.4 blog (infra + article 1 draft) · START→STOP (single session) · frontend: content/blog/ (new), lib/blogParser.ts + lib/blog.ts (new), pages/Blog.tsx (new), App.tsx routes, navManifest, routeMeta, sitemap, vite.config (RSS emit) · feat/w64-blog · MERGE = OWNER-GATED (article content)

2026-07-04 · Lane B · W6.5 PR1 Sentry verify/extend · START→STOP (single session) · frontend: ErrorBoundary.tsx (root capture, stale-chunk tag), lib/grc20.ts (tx-broadcast terminal capture — broadcast infra only, NOT sig paths), main.tsx (JWT scrub in exception path) · feat/w65-sentry-verify

2026-07-04 · Lane B · docs: W5 retro + W6 status · START→STOP (single session) · docs/planning/MEMBA_ROADMAP_COMPOUND_2026-07.md (retro append), ROADMAP.md (status row) · docs/w5-retro-status

2026-07-04 · Lane A · GovDAO bugfix (owner-reported, mobile) · START→STOP (single session) · frontend: lib/dao/proposals.ts (+strictProbe test), components/quests/QuestToast.{tsx,css} (styles out of lazy questhub.css), index.css (compact stat grid mobile row), pages/questhub.css, e2e/dao.spec.ts · CHANGELOG.md (single-writer: registered) · fix/govdao-strict-probe-and-mobile-stats

2026-07-04 · Lane B · W6.3 SEO (PR3: JSON-LD + prerender decision) · START→STOP (single session) · frontend: index.html (static JSON-LD), RouteMetaSync.tsx (breadcrumbs); docs/features/SEO.md (new) · feat/w63-jsonld-prerender

2026-07-03 · Lane B · W6.3 SEO (PR2: sitemap+robots) · START→STOP (single session) · frontend: lib/sitemap.ts (new), public/robots.txt (new), vite.config.ts (sitemap emit plugin — safeFlags wiring untouched) · feat/w63-sitemap-robots

2026-07-03 · Lane A · W6.3 SEO (PR1: route meta) · START→STOP (single session) · frontend: lib/routeMeta.ts (new), components/layout/RouteMetaSync.tsx (new), Layout.tsx (mount) · feat/w63-seo-route-meta

2026-07-03 · Lane A · W6.2 4-mode IA (PR1: nav shell) · START→STOP (single session) · frontend: navManifest.ts (mode groups), Sidebar.tsx (manifest-driven sections), index.css · feat/w62-ia-nav-modes

2026-07-03 · Lane B · W6.1 changelog automation (PR1+PR2) · START→STOP (single session) · CHANGELOG.md (parse contract), frontend: lib/changelog.ts (new), lib/changelogLegacy.ts (new), pages/Changelogs.tsx · feat/w61-changelog-automation

2026-07-03 · Lane B · W5.6 breaking-changes sweep · START→STOP (single session) · docs only: GNO_CORE_BREAKING_CHANGES.md, roadmap O-7 correction · docs/w56-breaking-changes-sweep

2026-07-03 · Lane A · W5.1 Adena session stability · START→STOP (single session) · frontend: useAdena.ts (connection/persistence paths ONLY — signing paths untouched per Lane C), walletDebug.ts (new) · fix/w51-adena-session-stability

2026-07-03 · Lane A · W5.3 validator review stars · START→STOP (single session) · frontend: ValidatorReviewStars.tsx (new), Validators.tsx, validators.css · feat/w53-validator-review-stars

2026-07-03 · Lane A · W5.2 directory fixes · START→STOP (single session) · frontend: gnowebSource.ts (+RPC qfile path), RealmDetailDrawer.tsx, Directory.tsx, directoryUrl.ts, directory.css, e2e/directory.spec.ts · fix/w52-directory-packages-gnoweb

2026-07-03 · Lane B · program setup · STOP · created roadmap doc + this file · docs/roadmap-compound
