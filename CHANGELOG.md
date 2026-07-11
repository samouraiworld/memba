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

### Backend — Membas Genesis launch plumbing (2026-07-11)
- **Launchpad mints now index.** The event dispatcher projects `MintPublic`/`MintAllowlist` from `memba_collections` exactly like the admin `Mint` (the paid events carry no `to` attr — the minter receives, which the projection already handles), and the launchpad realm joins the default `NFT_WATCHED_REALMS` set (code default + `fly.toml`). Without this, every paid Genesis mint would be invisible to collection pages and portfolios.
- **Two mint-flow endpoints, off by default.** `/api/nft/allowlist-proof` serves per-wallet Merkle proofs for the allowlist phase (from the generator's proofs file, `MEMBA_ALLOWLIST_PROOFS_PATH`); `/api/nft/mint-ticket` suggests the next free `tokenURI` from our own indexer projection with short in-process reservations (`MEMBA_TICKET_COLLECTION_ID`/`_URI_BASE`/`_PREFIX`), narrowing the concurrent-mint URI race. Both return 404 until their envs are set at ceremony time.
### Game — MEMBA: BARRICADE G1 lands, dark (2026-07-11)
- **A new arcade title enters the roster.** BARRICADE is a 90-second daily lane-defense: hold the barricade against The Order through 8 waves to the Broadcast Tower, spend scrap between waves (repair / turret / arm the crowd), and pop the rally when the meter fills. One shared daily seed for everyone, practice mode on random seeds. The sim core is fully deterministic (integer-only, seeded, versioned) and every run records its input log — the results screen re-verifies the recorded log through the same replay code a server-side verifier will use, which is the foundation for the attested season leaderboards of the full launch. Behind `VITE_ENABLE_BARRICADE` (default off, funds-free, no wallet).

### NFT — curated Genesis mint flow in the studio (2026-07-11)
- **The mint form learns the Membas drop.** When the backend mint-ticket endpoint is live, the public and allowlist mint forms stop asking for a manual token URI: the next edition's metadata URI is fetched and shown ("Next mint: Memba #0004"), and the Genesis allowlist proof auto-loads from the server — no more pasting the published list (the paste flow stays as fallback for other collections). After each mint the ticket refreshes; if the queue jumped past ours, a **Misprint** notice explains it honestly. Everything degrades to the existing manual flow when the endpoints are off.

### Backend — authenticated RPCs stop echoing token internals (2026-07-11)
- **The last auth surface still copying raw validation errors onto the wire is sealed.** `authenticate()` — the guard in front of every token-authenticated RPC — returned `ValidateToken`'s reason verbatim: an expired / bad-signature / wrong-chain oracle plus wrapped decode detail. It now matches the sign-in hygiene: message-less `Unauthenticated` on the wire, full reason in server logs. No client parsed these messages (the REST endpoints were already sanitized), and a wire-contract test pins it.
- **The multisig signature-verify rejection is pre-sanitized for the enforce flip.** In enforce mode (off today, log-only) a failed member signature echoed the verifier's reconstruction detail onto the wire; it now returns static "re-sign the transaction" copy with the detail in logs — clearing the flip's last code prerequisite.

### App Store — publishers can delist their own apps (2026-07-11)
- **"My submissions" gains Delist** (any non-delisted listing, free): an armed two-step confirm spells out the honest contract before signing — delisting is one-way for the publisher, only a curator can restore it, and the package path stays taken. A failed delist shows its error right in the confirm box and stays armed for retry. Live rows also explain why they can't be edited (verified content is locked; a curator can unlock it for re-review).

### Sign-in — Adena session accounts get a real answer (2026-07-11)
- **Signing in with an Adena session account now explains itself.** The backend keeps rejecting session/subaccount pubkey payloads fail-closed, but the rejection now rides the wire as a bare code (`AUTH-SESSION-REJECT-01` — no internals, no env-var hint; the operator guidance stays in server logs), and the app maps it to: "Session accounts aren't supported yet — switch Adena to your main account and try again." Previously users hit a dead-end "Authentication failed".
- **Block Party's silent sign-in failure is fixed** — a rejected token exchange on that surface used to be a no-op; it now surfaces an error like every other sign-in path.

### NFT trading — the listing floor is enforced before signing (2026-07-11)
- **List/offer amounts below the realm floor can no longer be signed.** The trade modal gated on "more than zero" while the v3.2 engine rejects anything under 1000 ugnot (0.001 GNOT) — a sub-floor amount passed the wallet, then reverted on-chain (money-path audit F-2). The floor is now enforced before signing, and the offer hint states the real minimum instead of "&gt;0 GNOT".

## [v7.3.0] — 2026-07-11

### ⚠️ Behavior changes to know (migration notes)
- **NFT: existing listings did NOT migrate to the v3.2 engine — sellers re-list on v3.2.** v3.1's two open offers exit escrow via CLI cancel / expired-claim only.
- **Tokens: amounts are now entered in whole tokens** (no longer smallest units) — double-check the amount before signing.
- **Treasury: GNOT balances display in whole GNOT** (previously raw ugnot).

### Backend — NFT indexer defaults stop pointing at the retired v3 engine (2026-07-11)
- **Booting without `NFT_WATCHED_REALMS`/`NFT_SALE_VOLUME_REALMS` no longer indexes a dead realm.** The code defaults still named `memba_nft_market_v3` — deauthorized 2026-06-27 — so an unset env silently watched a realm that could never trade again; this is how v3.1 sales went un-indexed in prod until 2026-07-11. Defaults now cover the v2 pair plus the v3.1/v3.2 engines, with v3.x volume counted from `Sale` events only (v3.2's seeded history emits `SaleSeeded`, which the dispatcher ignores — no double-count). A test pins the default sets so the next engine retirement must update them deliberately.
- **The prod realm sets are now versioned in `backend/fly.toml` `[env]`** instead of living only as unversioned Fly secrets. Note for the operator: secrets override `[env]` — drop the two secrets once this deploys so the file is the single source of truth.

### NFT marketplace — trading moves to the v3.2 engine (2026-07-10 ceremony)
- **The active trading engine is now `memba_nft_market_v3_2`** — deployed, registered on the collections registry, and carrying v3.1's full sales history (seeded from the tx-indexer and permanently sealed). v3.2 adds machine-readable solvency (`TotalLiabilities()` reconciled against the realm balance), two-step ownership handoff, and a fee-recipient guard. Approval flows now authorize the v3.2 engine address.
- **v3.1 is paused, not gone**: it stays callable through the wind-down so its two open offers can exit escrow (cancel/expired-claim); new trades route to v3.2. **Existing listings do not migrate — sellers re-list on the new engine.**
- Backend indexer docs: watch both engines; v3.2's seeded history emits `SaleSeeded` (not `Sale`), so volume cannot double-count.
### App Store — self-service submissions open (2026-07-10)
- **/apps/submit leaves the safety gate.** `VITE_ENABLE_APPSTORE_SUBMIT` is removed from `SAFETY_GATED_FLAGS` after the full owner ceremony landed on test13: `memba_appstore_v3` deployed, the v2 catalog seeded and **sealed** (`FinalizeSeed` — the fee-free seeding door is permanently shut), and the fee-path checklist verified live from a plain wallet (wrong-fee refund, exact-fee accept, reject → free-resubmit credit, curator approve, flag dedupe, sealed-seed panic). Anyone can now submit an app for 1 GNOT; listings stay `pending` until a curator review.

### App Store — cards catch up with the reviews and realm data that already exist (2026-07-10)
- **Review stars reach the grid.** Community ratings only showed after clicking into an app's detail page; reviewed apps now carry their star summary (same ≥3-review integrity rule — small samples show a "New" chip and the count, never a fake-confident average) on the featured banner and every grid card. All visible cards are fetched as one concurrency-capped batch, not a per-card query burst.
- **The masthead counts the realm, not the fetched window.** "N apps" came from whatever one page-load happened to fetch; it now reads the realm's own `GetStatsJSON` (works on v2 today and v3 after the ceremony repoint) and additionally discloses total submissions once they exceed the live count.
- **Publisher-pinned icons render.** A listing with an `iconCID` finally shows its artwork (IPFS gateway, CID shape-validated, lazy-loaded); the deterministic monogram stays as the fallback for missing, malformed, or unloadable icons — a broken gateway can never leave a blank tile.

### Multisig — "Unverified" no longer reads as an alarm on legacy signatures (2026-07-09)
- Signatures collected before server-side verification existed can never be re-checked, but their badge read simply "Unverified" — indistinguishable from a real mismatch. The badge now explains itself on hover: legacy rows are expected and advisory, and the "Verified" badge states what was actually checked.

### Marketplace — light-theme parity for cards and warnings (2026-07-09)
- Marketplace card borders, hover shadows/surfaces, the agent-credits warning tint, and three v2 CSS fallbacks used hardcoded dark-theme colors — invisible hovers and washed-out frames on the light theme. All now use the shared theme tokens (`--color-border`, `--shadow-lg`, `--color-k-hover-surface`, `--color-k-amber-*`, `--color-success`). The service-card image scrim stays a constant overlay by design (it sits on imagery, not on a themed surface).
### Blog — articles become first-class for search engines and social shares (2026-07-09)
- **Every article now has its own URL in the sitemap** with its publication date as `lastmod` — previously only `/blog` itself was listed, so the 12 articles were invisible to crawlers except via the JS-rendered list and RSS.
- **Sharing an article now shows that article** — each `/blog/:slug` sets its own og:title/description/twitter meta and a `BlogPosting` JSON-LD record (headline, date, keywords, author), instead of every article sharing one generic "Blog — Memba" preview. Feed readers can also auto-discover the RSS feed from any page.
- **Articles can now include images** (`![alt](url)` on its own line): rendered lazily, protocol-whitelisted, and clamped to the article column. Deliberately opt-in for the blog only — untrusted realm output and feed posts keep the image-free renderer (the feed's media wave is gated on its moderation lever).

### Home — the front page catches up with what actually shipped (2026-07-09)
- **"Coming soon" no longer contradicts reality.** The below-the-fold "explore" and "coming soon" sections were static June lists — the Marketplace shipped weeks ago but Home still teased it as "not live yet", while the App Store, Blog, and Space Invaders never appeared at all. Both sections now derive from one flag-aware surface manifest: whatever a deployment enables shows as a live link, whatever it gates shows as "soon", and the two can never disagree again.
- **"Live across gno.land" understands Memba's own realms.** Feed posts, App Store submissions/reports, and OTC token trades used to render as anonymous "Calls"; they now classify and read as human sentences ("Posted on the feed", "Submitted an app", "Traded tokens OTC") with a new **Apps** filter chip.
- **Ecosystem at a glance now shows NFT collections** — the backend snapshot counted them all along; the band just never rendered the number.
- Visitor hero copy and the value strip mention apps & games (the value strip's fourth card only appears where the App Store is actually enabled).
### Backend resilience — an indexer crash can no longer take down the API (2026-07-09)
- **A panic inside any indexer cycle (NFT tailer, feed tailer, NFT poller) no longer kills the whole backend process.** The three indexers run in-process with the RPC server, so a single bad block or parse bug used to take API serving down with them. Each cycle is now panic-isolated: the cycle is skipped, logged with a stack trace, counted in a new `memba_indexer_cycle_panics_total` metric (alert on nonzero), and the loop retries on its next tick.
- **The public leaderboard no longer recomputes itself on the request path.** When the rank cache lagged behind quest completions, every read paid a full re-aggregation before responding. A stale (non-empty) cache is now served immediately while a single background repair rebuilds it; only a completely empty cache (first boot) still computes synchronously.

### Marketplace v2 — unified lane pipeline (dark, behind `VITE_ENABLE_MARKETPLACE_V2`) (2026-07-09)
- **One shared pipeline for every marketplace lane** (`LaneView` → cached `useLaneQuery` → validated codec → per-source `toCard` adapters → `LaneToolbar` + `ListingGrid`/`MarketCard`): NFT and Token lanes read real test13 data, the Services lane ships the labeled Founding-Supply seed catalogue. Buyer-first "You pay" pricing, honest URL-driven search/filters/sort, no fabricated trust signals. Off in prod until the owner's cutover flip.
- **Tab a11y (WAI-ARIA tabs):** roving tabindex with Arrow/Home/End keyboard navigation, `aria-controls`/`tabpanel` wiring on the lane outlet.
- **Lane tabs fixed under react-router 7:** relative tab links inside the splat-mounted shell resolved against the full URL (`/marketplace/nfts` + `services` → `/nfts/services`) and the catch-all bounced them back — switching lanes via the tabs never navigated. Tab links are now absolute.
### App Store — curator review queue (B4) (2026-07-09)
- **Curators can now work the pending-submission queue at `/apps/review`**: read the source and preview the listing, then Approve (the listing goes Verified/live) or Reject with a written reason — the confirm stays disabled until a reason is typed, because it's shown verbatim to the submitter and gates their free resubmit. The `IsCurator` check is UX-only and fails closed; the realm enforces curator authority on-chain regardless. Community-report counts surface on queue items. v3-realm only; no funds move, so the page rides the existing App Store flag.

### App Store — submit your app (B3 money path, dark) (2026-07-09)
- **Anyone will be able to list an app in the store by paying the registration fee** (`/apps/submit`, behind the NEW safety-gated `VITE_ENABLE_APPSTORE_SUBMIT` — a production build fails if it's enabled before the v3 fee path is verified). The form mirrors the realm's validation (field limits, `https://`/`http://`/in-app-path URL allowlist) so a transaction the realm would reject is never signed; the fee is read live from the realm and attached as an exact-coin send; the non-refundable fee → treasury disclosure is shown before signing and the pending-review state after. A "My submissions" panel shows each listing's status and the curator's reason on rejection, with a free fix-and-resubmit path. v3-realm only; on v2 the page explains submissions aren't available.

### Blog — on-chain source, dark (behind `VITE_ENABLE_ONCHAIN_BLOG`) (2026-07-09)
- **/blog can now read articles from the `memba_blog_v1` realm** (backlog item 8): flag-gated reads with the static build-time pipeline as a permanent fallback — on-chain wins its slug, static-only articles stay visible mid-migration, and a realm outage renders the static set (never a blank page). `/blog/<slug>` URLs are unchanged. Off in prod until the realm is deployed and the articles are migrated.
### App Store — community "Report app" (B1b) (2026-07-09)
- **Any user can now report a live or pending listing from its detail page** (one on-chain flag per address; the realm hides a listing from public lists at its flag threshold, pending curator review). The confirm step discloses the on-chain permanence before any wallet prompt; disconnected visitors get connect-on-action; the realm's "already flagged" dedupe reads as success. Targets whichever App Store realm is active (`VITE_APPSTORE_REALM_PATH`), so it works on v2 today and v3 after the migration.

### Fix — token amounts no longer overflow, and are entered in whole tokens (2026-07-09)
<!-- categories: memba -->
- Launching a token with a large supply used to fail with an opaque error (`strconv.ParseInt: value out of range`). Token amounts are stored on-chain as 64-bit integers, but the **Create Token** form and the token **Transfer / Mint / Burn** actions accepted amounts in the smallest unit with no upper limit, so a large-but-reasonable-looking number silently exceeded the ceiling and the transaction was rejected. Amounts are now **entered in whole tokens** (e.g. `1000000` = one million tokens, not one token) with a live readout of the exact on-chain value and, for mints, the 2.5% platform fee and resulting total supply. Anything above the ~9.2-quintillion-unit ceiling is caught **before** you sign, with a clear message and a disabled submit button instead of a failed transaction. The multisig **Propose Transaction** builder (where amounts stay in the smallest unit for raw-proposal review) gains the same ceiling guard so an over-limit proposal is rejected up front rather than failing when co-signers execute it.
- The Create Token page also gains a **"New to tokens?" primer** explaining, in plain language, what decimals, initial supply, the platform fee, the faucet, the admin, and the maximum supply mean — so first-time creators understand the tokenomics they're setting.
### Validators — names survive monitoring outages (2026-07-09)
- **Validator names no longer collapse to bare addresses when the monitoring service degrades** (the 2026-07-08 incident). Names now seed from any moniker-bearing monitoring endpoint (not just participation), an address-shaped or `unknown` "moniker" is never displayed as a name, and a 7-day last-good cache backfills names during outages — metrics still only come live from their own endpoint. Root-cause SQL fix shipped separately in gnomonitoring (#116).

### Marketplace — lane tabs actually switch lanes again (2026-07-09)
- **Clicking a marketplace lane tab navigated to a bounced URL and landed back on the lane you were already on.** Under react-router 7 the shell's relative tab links resolve against the full current URL (`/marketplace/nfts` + `services` → `/marketplace/nfts/services`), which the catch-all redirect sends straight back to the default lane. Tab links are now absolute. Invisible in prod today only because a single lane is live there; on any network with two or more live lanes the tab bar was unusable.
### Multisig — per-signature verification badge (2026-07-09)
- **Quorum displays now distinguish cryptographically verified signatures from merely-submitted ones.** The backend's server-side signature check (A3) already ran on every submission; its verdict is now recorded per signature (`signatures.verified`, proto `Signature.verified`) and surfaced as a badge in the transaction view. Signatures stored before this change (or failing verification during the log-only `MEMBA_ENFORCE_MULTISIG_SIG_VERIFY` window) show as unverified.

### App Store — read-side groundwork for the v3 realm (B1, 2026-07-09)
<!-- categories: memba -->
- Prepares the App Store front end for the next-generation listing realm (`memba_appstore_v3`, which adds a proper submission lifecycle) **without touching the live experience**. The realm the App Store reads is now env-selectable (`VITE_APPSTORE_REALM_PATH`) and still defaults to the current `v2` realm, so nothing changes until an operator points it at `v3` after that realm is deployed and migrated. When pointed at `v3`, the store gains an **opt-in "Apps pending review" disclosure** — apps that have paid the listing fee but haven't been vetted by a curator are hidden by default behind an amber-cautioned toggle (never shown as a peer of the verified apps), and the listing client can now read per-status windows and the richer v3 fields (screenshots, reject reasons). No user-visible change on the current realm.
<!-- categories: memba -->
- App Store listings can now carry **community reviews and ratings**. The App Store detail page mounts the shared reviews experience — a compact rating summary in the hero plus the full reviews section (post a rating, reply, like/dislike, flag, moderate) — pointed at the reputation-isolated App Store reviews realm, so an app's reputation is scored independently of the validator/profile web-of-trust. A **product-integrity** rule keeps early ratings honest: a listing with fewer than three reviews shows a neutral "New" chip with the review count instead of a headline star average, so one or two reviews can't present as a confident 5.0. Gated behind the new `VITE_ENABLE_APP_REVIEWS` flag (off by default; the app-reviews realm is deployed to test13 but the front end stays dark until it's switched on).

### App Store reviews — realm-path threading in the reviews client (B2a, 2026-07-08)
<!-- categories: memba -->
- Groundwork for community reviews on App Store listings: the subject-agnostic reviews data client (`lib/reviews.ts`) now threads an optional `realmPath` argument through every read and write builder, defaulting to the existing validator/profile web-of-trust realm. This lets a caller target the reputation-isolated App Store reviews realm by path alone, with no behavior change for existing callers (verified: the full validator/profile reviews suite still passes). No user-visible change yet — the App Store detail page wiring follows.

### Fix — Treasury shows GNOT in whole units, not raw ugnot (2026-07-08)
<!-- categories: memba -->
- The DAO **Treasury** page rendered the GNOT balance from raw micro-units (ugnot), so a treasury holding **1 GNOT** displayed as **"1,000,000"** — off by a factor of a million and misleading. It now shows the human-readable, decimal-scaled amount (**"1"**, or **"123.456789"** for sub-unit balances), with thousands still comma-grouped. GRC-20 token rows are unaffected.

### Performance — feed reply counts (2026-07-08)
<!-- categories: memba -->
- The social feed now serves each post's reply count from a maintained column instead of recomputing it per row on every read, and ranks "most replied" posts from that column instead of an on-the-fly sort. This trims the work behind the timeline, thread, and feed-stats endpoints — most visible under load — with no change to the counts shown (they stay correct across reply delete / hide / unhide / operator-blocklist / chain-reorg).
### Performance — on-chain read resilience (2026-07-08)
<!-- categories: memba -->
- On-chain reads now **coalesce**: when the same realm query is requested from several places at once (common while a page renders), they share a single round-trip instead of each hitting the network. And a read that hits a brief network blip or a 5xx now **retries the same endpoint once** before falling back to a backup node, so one hiccup no longer demotes a healthy primary. Timeouts still fail over immediately. Fewer redundant requests and steadier reads under flaky connectivity, with no change to results.

### Security — Go toolchain 1.25.11 → 1.25.12 (2026-07-08)
<!-- categories: memba -->
- Bumped the backend Go toolchain (`backend/go.mod`, `backend/Dockerfile`) to **go1.25.12** to clear **GO-2026-5856**, a `crypto/tls` advisory published today that `govulncheck` flags in go1.25.11 (fixed in 1.25.12). No product change — this unblocks the Backend (Go) CI gate, which now reds on every build until the toolchain is patched.
### Performance — Directory DAO reads (2026-07-08)
<!-- categories: memba -->
- The Directory's **DAOs** tab now resolves each listed DAO and reads its card metadata from a **single, cached on-chain render per DAO**, instead of a heavier config read (used only to check the DAO exists) followed by a second per-DAO metadata fetch. This roughly halves-to-quarters the on-chain reads behind the "Loading DAOs…" state and caches them, so re-opening the tab is instant. No change to which DAOs appear.

### Space Invaders — arcade game in the Store (#823, 2026-07-08)
- A classic **Space Invaders** added to the Store, playable instantly in the browser with no wallet. Built on a pure, deterministic game engine (a fixed-timestep loop that carries sub-frame time, so it runs correctly on 60 / 120 / 144 Hz displays) with keyboard (←/→ · Space · P) and full touch controls (steer on the left, tap-and-hold to fire on the right). Lean-classic rules: a formation that marches, drops and reverses at the edges and accelerates as ranks thin, one player shot in flight, three lives, escalating waves, and a local high score.
- Gated by `VITE_ENABLE_SPACE_INVADERS` — an ordinary flag (client-side only, no funds), off by default; reachable at `/game/space-invaders`. Listing it in the on-chain App Store (`memba_appstore_v2`) is a separate operator action.

### Space Invaders — deterministic engine spine for certified scores (2026-07-08)
<!-- categories: memba -->
- Internal groundwork for the upcoming on-chain leaderboard and game juice: the pure `step` reducer now emits a deterministic event stream (kills, fires, hits, wave clears) and carries a monotonic `tick`, retains its `seed`, and the loop advances by an exact integer step count — removing a float round-trip (`steps * FIXED_MS` re-divided) that could run one step short and desync a replay. Added a tick-indexed input-log recorder (the backbone for server-side replay verification). Seed is now injectable. **No product change** — identical gameplay; substrate only.

### Space Invaders — game feel: juice, a bigger CRT screen, and fresh runs (2026-07-08)
<!-- categories: memba -->
- The game now **feels alive**: killing an alien throws a burst of particles and a floating `+points`, hits and wave-clears kick a short screen-shake, and the whole thing plays on a **noticeably bigger arcade screen** (near-full-width on phones, up to ~480px on desktop) framed with a subtle **CRT scanline** and bezel glow. Mobile gets **haptic feedback** on hits and wave clears.
- **Every run is now different** — each game seeds from a fresh random value instead of a fixed one, so the swarm's patterns change from run to run (a deliberate daily-challenge seed comes later).
- Rendering is decoupled from React (drawn straight from the game loop) for smoother 60fps play, and all motion — particles, shake, scanline, the invulnerability blink — is disabled under **`prefers-reduced-motion`** for accessibility. Every cosmetic effect runs on its own separate randomness, so it can never affect a score that will be certified on-chain.
- Still gated by `VITE_ENABLE_SPACE_INVADERS` (client-side only, no funds), off by default.

### Space Invaders — sound (2026-07-08)
<!-- categories: memba -->
- The game now has **sound**: synthesized shoot / explosion / hit / wave / UFO effects and the iconic accelerating **4-note march**, all driven off the same deterministic event stream as the visual juice (so audio can never affect a certified score). A **mute toggle** in the HUD remembers your choice, and audio unlocks on your first tap/key to respect mobile autoplay rules. Cosmetic-only and safely absent where WebAudio isn't available.

### Space Invaders — better touch controls (2026-07-08)
<!-- categories: memba -->
- Mobile steering is now **proportional** — how far you drag decides how fast the ship moves, so fine dodges are possible instead of the old all-or-nothing ±1. And the **control zones are now visible** on the start screen (a labelled "drag to steer | tap · fire" split), so the touch scheme is discoverable instead of a guess. Keyboard play is unchanged, and the change is deterministic-safe (the on-chain scoring corpus is unaffected).

### Space Invaders — App Store listing prep (2026-07-09)
<!-- categories: memba -->
- Refreshed the Space Invaders store card to reflect the finished game (combos, rapid fire, mystery UFO, bunkers, sound) and added a proper on-brand **app icon** (`space-invaders-icon.svg`) in place of the emoji placeholder. The live App Store listing is registered on-chain by the operator — the exact copy, icon, and steps are in `docs/planning/SPACE_INVADERS_LISTING_2026-07-09.md`.

<!-- categories: memba -->
- Scoring now rewards **skill, not grinding** — the foundation for a competitive leaderboard. A **no-miss combo** builds a live score multiplier (×1 → ×1.5 → ×2 → ×3 → ×4) that **resets the moment you miss a shot**, so accuracy under pressure separates a good run from a great one. The active multiplier shows in the HUD.
- Two end-of-game bonuses — an **accuracy bonus** (high hit-rate) and a **surviving-lives bonus** — and top-row aliens are now worth more (40/30/20/20/10), so going for the hard targets pays off.
- All scoring lives inside the pure, deterministic engine using integer-only math, so a score can be **re-computed and verified byte-for-byte** — the basis for the upcoming on-chain certification. Controls unchanged; still gated by `VITE_ENABLE_SPACE_INVADERS`.

### Space Invaders — rapid fire (2026-07-08)
<!-- categories: memba -->
- Firing feels **faster and more energetic**: hold to stream shots (one every ~140ms) with **up to three bullets on screen at once**, and bullets travel noticeably quicker. More offense — but with combo scoring a missed shot still breaks your multiplier, so it rewards aggression *and* aim. Deterministic and integer-only like the rest of the engine; still gated by `VITE_ENABLE_SPACE_INVADERS`.

### Space Invaders — deeper waves that actually get harder (2026-07-08)
<!-- categories: memba -->
- Later waves now ramp up **real difficulty**: the aliens **fire faster each wave** (cooldown tightens toward a floor), and shots come from the **bottom-most alien of a column** — so cover disappears the way the arcade original intended, instead of raining from mid-formation. The formation also **stops descending past a safe cap**, so deep waves are hard because they're *fast*, not because they spawn on top of you. Still deterministic/integer-only; gated by `VITE_ENABLE_SPACE_INVADERS`.

### Space Invaders — mystery UFO (2026-07-08)
<!-- categories: memba -->
- The **mystery UFO** is back: it drifts across the top of the screen every so often for bonus points. Base value varies, but land the hit on the right shot and it pays the classic **300** — a risk/reward hook that rewards players who track their shot count and break rhythm to snipe it. Deterministic and integer-only like the rest of the engine; gated by `VITE_ENABLE_SPACE_INVADERS`.

### Space Invaders — destructible bunkers (2026-07-08)
<!-- categories: memba -->
- The classic **bunkers** are here: rows of destructible cover between you and the swarm. They soak up alien fire (three hits per block) — but you erode your *own* cover when you shoot through it, so positioning matters. Cover **refreshes each wave**. The tactical layer that makes "do I burn my shield to snipe the UFO?" a real decision. Deterministic/integer-only; gated by `VITE_ENABLE_SPACE_INVADERS`.

### Space Invaders — replay verifier (onchain-leaderboard groundwork) (2026-07-08)
<!-- categories: memba -->
- Internal groundwork for **certified scores**: a deterministic replay verifier that re-runs the game engine from a recorded input log and re-derives the *authoritative* score plus an integer, cross-language-portable state hash. This is the anti-cheat backbone — the server (and, later, a Gno realm) recompute the score rather than trusting any number the client sends. Proven by a round-trip test (a recorded run replays to the identical score and hash). **No product change** — substrate for the upcoming on-chain leaderboard.

### Space Invaders — determinism corpus (scoring model frozen) (2026-07-08)
<!-- categories: memba -->
- Committed a set of **golden test vectors** (`engine/testdata/game_vectors.json`) — canonical input scripts pinned to their exact final score and state hash. This **freezes the scoring model**: any accidental change to scoring or determinism now fails CI, and a future Go/Gno engine port loads the *same* file and must reproduce it byte-for-byte (the cross-language equivalence the on-chain verifier relies on). Mirrors the Block Party corpus pattern. **No product change.**

- Added a `.gitattributes` rule (`CHANGELOG.md merge=union`) so that when several independent PRs each append an entry to `[Unreleased]`, git keeps **both** sides instead of raising a conflict on every merge. Removes the recurring manual changelog-conflict resolution when a batch of PRs lands together. No product change.

### gno.land public-sale announcement popup (#809, 2026-07-08)
- A dismissible promo popup announcing the gno.land public **GNOT sale** (opens 2026-07-20, links to sale.gno.land), with a countdown that switches to "Now open" at the sale date. Shown once per campaign (localStorage), rendered via `AccessibleDialog` (focus trap, body-scroll lock, Esc), and suppressed while the onboarding wizard or activation gate is up so it never stacks on another modal.
- Gated by `VITE_ENABLE_ICO_ANNOUNCEMENT` — an ordinary flag (read-only external link, no funds), off by default; the owner enables it for the sale window.

### Explorer merged into the Directory (#811, 2026-07-08)
- The read-only realm Explorer is now a gated **🔎 Explorer** tab inside the Directory instead of a separate `/explorer` feature — realm discovery is one place: browse (Packages / Realms / …) → deep-dive into a realm's live render, source, and functions. Canonical route is `/directory`; the active realm rides the URL as `?tab=explorer&realm=r/x/y`.
- Legacy `/explorer/*` links redirect into the tab, preserving the realm path, so bookmarks and shares don't 404. The standalone Explorer nav entry is removed — the sidebar shows a single **Directory** entry.
- Still gated by `VITE_ENABLE_EXPLORER`: the tab is hidden and a deep-link to `?tab=explorer` falls back to the default tab when the flag is off, so there's no dead button or blank panel.
### Performance — feed render (2026-07-08)
<!-- categories: memba -->
- **Reading the feed no longer churns the main thread.** Each post card ran its own 15-second clock and re-ran the body's markdown + on-chain-unfurl parsing on every render, and cards weren't memoized — so a 200-post timeline meant 200 timers all re-parsing on each poll/scroll. Now the ticking relative-time is isolated to a tiny leaf (only the timestamp text updates every 15s), the body markdown and unfurl parsing are memoized per body, `PostCard`/`PostUnfurls` are `React.memo`'d, and the feed's row callbacks are stabilized so an unchanged card doesn't re-render on a timeline poll. Pure render-perf; no behavior change (all 30 feed unit tests unchanged and green). Behind `VITE_ENABLE_FEED`.
### Performance — backend read pool (2026-07-08)
<!-- categories: memba -->
- **Reads no longer queue behind the indexer's writes.** The SQLite connection pool was capped at a single connection (`SetMaxOpenConns(1)`), so every RPC read had to wait for the one connection the in-process indexer tailers use for writes — the dominant source of the intermittent backend lag. The pool now opens several connections over WAL (one writer runs concurrently with multiple readers; `busy_timeout` still serializes the rare write-vs-write overlap). Plain in-memory databases (tests) stay single-connection since they're private per connection; production is always file-backed and gets the full pool. Verified by a concurrency test proving a read completes while a write transaction is held open (which times out under the old single-connection cap).
### Performance — home snapshot: dedup + parallel sources (2026-07-08)
<!-- categories: memba -->
- **The landing page's server snapshot got much cheaper to build.** `GetHomeSnapshot` is cached for 30s, but on a cache miss it assembled the payload from **8 network/DB sources run one after another**, and every request that arrived during that assembly (a burst on cold start, or on each 30s expiry) re-ran all of them — a thundering herd against the pinned RPC node. Now concurrent misses per chain collapse to a **single assembly** via `singleflight` (the rest share its result), and the 8 sources are fetched **concurrently** instead of sequentially, so a miss costs the slowest single source instead of their sum. Behavior is unchanged — each source is still independently fault-tolerant and its failures still surface in `stale_sources` (verified under `-race`).
### Performance — right-size oversized icons & social image (2026-07-08)
<!-- categories: memba -->
- **~1.1 MB off first load.** Three images were shipped at ~10× the bytes they needed: the favicon (`memba-icon.png`, 414 KB at 777px but displayed 32px), `apple-touch-icon.png` (414 KB, displayed 180px), and the Open Graph card (`og-image.png`, 408 KB). Resized to sane dimensions and re-encoded the OG card as JPEG: **58 KB / 31 KB / 53 KB** respectively (the favicon downloads on every first paint). OG/Twitter meta now points at `og-image.jpg` with an explicit `og:image:type`.
### Performance — Clerk no longer ships to anonymous visitors (2026-07-08)
<!-- categories: memba -->
- **The Clerk auth SDK (~72 KB gz) stopped loading for everyone.** It's only used by the admin-panel link, which renders solely on your own authenticated profile — but `ProfilePage` imported it statically (through the profile barrel) and `ProfilePage` is prefetched on every load, so every anonymous visitor downloaded Clerk. `AdminPanelLink` is now lazy-imported (and dropped from the profile barrel), so Clerk loads only when the admin link actually renders (or on the Alerts route that also uses it). Verified against the prod build: `ProfilePage`'s chunk has no static Clerk import, and the main entry doesn't either.
### Performance — token dashboard caching (2026-07-08)
<!-- categories: memba -->
- **`/tokens` stops re-reading the whole token set on every visit.** The dashboard fetched the factory token list (plus one on-chain `getTokenInfo` per token, and a balance per token when connected) with bare `useState`/`useEffect`, so every navigation to the page — and every wallet connect — re-ran the entire fan-out with no cache. It now reads through React Query: the list and balances are cached (60s / 30s) and deduped, Refresh is an explicit refetch, and balances re-read only when the wallet or token set changes. Behavior unchanged (characterization tests added first, kept green across the refactor).
### Performance — app shell (2026-07-08)
<!-- categories: memba -->
- **The whole app stops re-rendering on every background poll, and scrolling is smoother.** The Layout handed routed pages a fresh Outlet-context object on every render, so a balance/notification poll (every 30s) re-rendered every page underneath it; the context (and its auth slice) is now memoized so only real input changes propagate. Separately, the sticky top bar used a `backdrop-filter: blur(16px)` over an already-85%-opaque background — a full-viewport GPU re-blur on every scroll frame for a barely-visible frost; it now uses an opaque elevated surface token (theme-aware), removing the scroll cost with a near-identical look. Non-scrolling frosted surfaces (menus, modals) keep their glass.
### Performance — feed stays smooth on long timelines (2026-07-08)
<!-- categories: memba -->
- **Scrolling a long feed no longer pays layout + paint for off-screen posts.** Feed cards now use CSS `content-visibility: auto` with `contain-intrinsic-size: auto`, so the browser skips rendering work for cards outside the viewport while remembering each card's real height — no scrollbar jump even though posts vary in height and unfurl cards resize after they load. No windowing library, no dependency, no scroll-jump risk. Because `content-visibility` also clips overflow, the own-post manage menu temporarily opts out of containment while it's open so its dropdown isn't cut off. (True row virtualization was evaluated and deliberately deferred until the feed is live and profiling shows it's needed — this gets most of the benefit at a fraction of the risk.) Behind `VITE_ENABLE_FEED`.

### Feature articles — product + engineering scope (#814, 2026-07-08)
- Nine `/blog` articles, one per major feature (Directory + Explorer, unified Marketplace, App Store, social Feed, Block Party, DAO governance, Multisig, Validators, Quests/XP), each pairing a product framing with an engineering-scope section so it doubles as documentation. Ships via the existing static blog pipeline.

### Marketplace menu consolidated to a single entry (#813, 2026-07-08)
- NFTs, Services, and Tokens are tabs (lanes) inside the unified `/marketplace` page, so the sidebar's separate **NFT** and **Services** entries — redirect-only duplicates — are removed. One **Marketplace** menu entry now matches the one page; deep links to `/nft` and `/services` still redirect in.
- Added a mobile "More"-sheet entry point for the Marketplace and App Store, which previously had no mobile navigation at all.

### App Store — flagship redesign (2026-07-07)
- **`/apps` reshaped into a world-class on-chain app store.** A real masthead ("Apps you can read before you run them") leads on the store's actual differentiator — every app is a public gno.land realm you can inspect before running — instead of a bare title. Adds a **featured hero** for the lead app, a responsive card grid that scales as listings grow, and designed loading (skeleton), empty, and error states.
- **Per-app identity when no artwork exists.** Apps with an empty `iconCID` get a deterministic monogram over a gradient seeded (FNV-1a) from the realm path — stable, unique per app, and CSP-safe (computed inline, never fetched). The realm path itself is promoted to a first-class mono chip.
- **App detail gains a trust panel** ("Read before you run") that names the publisher and points to the Explorer source — the reassurance a store of opaque binaries can't offer. Primary **Open app** CTA + secondary source link; first-party apps still open inline, third-party still open in a new tab (never an iframe).
- Theme-aware (light + dark) and mobile-responsive via Kodera `--color-k-*` tokens only — no literal colors in `appstore.css` (passes the DESIGN_SYSTEM §13 guardrail); keyboard focus + reduced-motion respected. No backend/realm changes.

### App Store — de-gate + memba_appstore_v2 (2026-07-07)
- **`VITE_ENABLE_APPSTORE` is no longer a safety-gated flag.** It was removed from `SAFETY_GATED_FLAGS` (frontend/src/lib/safeFlags.ts) now that `memba_appstore_v2` is deployed on test13 with a self-managed 2-of-2 admin and a **live-verified fee path** — a prod build with the flag enabled no longer fails. The `/apps` page can now ship to prod (Netlify flag flip is a separate operator action).
- **Frontend repointed to `gno.land/r/samcrew/memba_appstore_v2`** (was `_v1`): `APPSTORE_REALM_PATH` and the `lib/appStore` reads now target the live v2 realm.
- **Defense-in-depth pkgPath validation in `coerce`.** `fetchLiveApps` maps `coerce` over the realm's `ListLiveJSON` rows and the App Store detail view cross-links to `/explorer/{pkgPath}`, so `coerce` now drops any listing whose `pkgPath` fails `isSafeRealmPath` — a malformed/hostile on-chain path can never reach a qeval expression or an Explorer link. The existing `fetchApp` guard is unchanged.

### Block Party — light-theme legibility fix (2026-07-07)
- The `/game` board was styled dark-assumed and became unreadable in light theme: the board's "swipe to merge" hint used a hardcoded dark scrim, and scores / streak / modifier / error text used *fill* tokens (accent, gold, red) as text color — all low-contrast on a light surface. Now a new theme-aware `--color-k-scrim` token backs the hint and the text uses the design-system `-text` color variants, so the board, tiles, scores, badges, and game-over sheet all pass WCAG AA in **both** themes (the colorblind tile brightness ramp is unchanged). CSS-only; still dark behind `VITE_ENABLE_GAME`.

### Social feed — Wave 3: rich-text post bodies (2026-07-07)
- Feed posts now render **inline markdown** — **bold**, *italic*, `inline code`, and protocol-whitelisted `[links]` — instead of flat plain text. Scoped deliberately to inline formatting only: no headings / tables / lists / code fences (they don't fit a short post and invite visual spam), and no address auto-linking yet (the `/profile` route is network-scoped). **XSS-safe by construction** — a new `renderPostBody` escapes all content first, then injects only its own known tags with `javascript:`/`data:` URLs neutralized to `#` (the same escape-first approach the repo's `renderMarkdown` uses; verified with `<img onerror>` / `<script>` / `javascript:` tests). Only live post bodies are affected — the tombstone branch still suppresses hidden/deleted bodies. No realm change, no backend, no new flag. Behind `VITE_ENABLE_FEED`.

### Explorer — P1: cross-links, Playground hand-off & cleaner signatures (W9, 2026-07-06)
- **The Explorer stops being an island.** Realm surfaces in the **Directory** — the realm detail drawer and the realm cards — now link straight into `/explorer/<path>` through a new self-gating `<ExplorerLink>`: it renders nothing when `VITE_ENABLE_EXPLORER` is off, so it can never drop a user onto the coming-soon gate. Internal SPA links (`🔎 Explorer`), deliberately distinct from the existing external block-explorer / gnoweb links.
- **Source tab → Playground hand-off.** An "Open Playground ↗" link sits beside the existing copy-source control, so realm devs can take a contract's code to `play.gno.land` and experiment — read-only by construction (no in-app editor, no `qeval`, no execution surface).
- **Cleaner function signatures.** The Functions tab now strips the VM's internal `.uverse.` qualifier (`address`, not `.uverse.address`), including nested/composite types, and the source-parser fallback is centralised in a unit-tested `resolveFnList`. The deferred `qeval` read-console is formally closed as **read-only-by-construction** (see `docs/planning/spikes/SPIKE_GNOWEB_EXPLORER.md`). Still behind `VITE_ENABLE_EXPLORER`.

### App Store — `/apps` page (W9, 2026-07-06)
- **New `/apps` App Store surface** behind the **SAFETY-gated** `VITE_ENABLE_APPSTORE` (off; the `memba_appstore_v1` RegisterApp fee path isn't verified on-chain yet — the flag is in `SAFETY_GATED_FLAGS`, so a prod build fails if it's enabled). `/apps` lists live apps and `/apps/<pkgPath>` shows one app's detail, read from the realm's `ListLiveJSON` / `GetListingJSON` getters via ABCI `vm/qeval` (react-query, graceful empty/loading/error). Each app **cross-links to the Explorer** (`/explorer/<pkgPath>`) — "read the contract you're about to use". First-party apps open inline; third-party apps open in a new tab (never an iframe). **Security:** the URL-supplied pkgPath is validated against a strict realm-path shape before it reaches the qeval expression (prevents expression injection). Ships dormant; verified live on test13 (graceful-empty against the not-yet-deployed realm, 0 console errors) + gating e2e.

### Social feed — W8.2: serving-blocklist (operator takedown lever) (2026-07-06)
- The first half of the feed's **growth-safety gate**. The feed is open-write and post bodies are **permanent on-chain** (`PostCreated` event + `feed_raw_events`) — `DeletePost` only tombstones the projection — so illegal / must-not-serve content needs an **out-of-band operator suppression**. A new `feed_blocklist` table is **authoritative and independent of the indexer** (survives rebuild-from-raw; on-chain `UnhidePost`/`ModAction` can't reverse it, unlike `hidden`), and **every read path** — timeline, user feed, thread (root + replies), reply counts, and the stats/most-replied aggregates — excludes any blocklisted post. Managed via a bearer-gated, **fail-closed** `POST /api/feed/moderation` (disabled with 404 unless `FEED_MODERATION_BEARER` is set; block/unblock a post id, audited). Backend-only, no realm/deploy needed. The realm **moderator role** (fast on-chain moderation without owner-multisig-per-post) is the deploy-gated second half.

### Block Party — daily chain-seeded 2048 game (2026-07-06)
- New daily puzzle behind `VITE_ENABLE_GAME` / `BLOCKPARTY_ENABLED` (both off by default): one shared board a day seeded from an unpredictable Gno block (public verify script under `scripts/`), instant no-wallet play, and a wallet-optional **server-verified** leaderboard + streaks. The client submits only its move log; the server replays it for the authoritative score. Ships dark.

### Social feed — Wave 2: reaction bar (frontend) (2026-07-06)
- Posts gain a **reaction bar** — the live per-emoji counts (from `GetPostReactions`), with the wallet's own reactions highlighted, and a **one-per-emoji toggle** via a single on-chain `AddReaction`/`RemoveReaction` tx (a disconnected tap connects first). An **add-picker** exposes the realm's fixed 9-emoji set. Adds the `buildAddReactionMsg`/`buildRemoveReactionMsg` builders (ordinary Adena `vm/MsgCall`, no multisig path). **Off by default** behind `VITE_ENABLE_REACTIONS` — the flag is checked before any data hook, so a disabled build runs no query — and dark until the reaction-enabled `memba_feed_v1` realm is deployed to test13. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: reactions backend (indexer + counts RPC) (2026-07-06)
- Backend plumbing for on-chain reactions: the feed indexer now projects the realm's `ReactionAdded` / `ReactionRemoved` events into a rebuildable `feed_reactions` table (one row per post/emoji/wallet, idempotent), and a new public `GetPostReactions` RPC returns per-emoji **counts** (count-descending) plus, for a given viewer, **which emojis that wallet reacted with** — batched over a page of posts. Counts are always derived (never stored), so the projection can't drift from the event stream. TDD (dispatch idempotency/toggle/malformed-skip + RPC counts/viewer-flag). **Dark until the reaction-enabled `memba_feed_v1` realm is deployed to test13 (samcrew-deployer #61) and the frontend reaction bar lands; behind `VITE_ENABLE_FEED`.**

### Social feed — Wave 2: rich link previews (2026-07-06)
- External links in posts now upgrade to **rich preview cards** — title, description, site name, and a **thumbnail** — via a new server-side `GetLinkPreview` RPC that fetches OpenGraph/Twitter-card metadata. **SSRF-hardened**: the fetch reuses the existing dial-time IP guard (rejects loopback / private / link-local / **cloud-metadata** / ULA / CGNAT, DNS-rebind-safe), with an http/https + port allowlist, a redirect cap with per-hop re-validation, and time/size budgets. **Privacy**: the `og:image` is **proxied through the backend** behind a signed (HMAC) token — the reader's browser never touches the third-party host (`/api/link-image`), with a content-type allowlist (SVG rejected), a 2 MB cap, and `nosniff` + `CSP: default-src 'none'`. The frontend renders a fixed-aspect-ratio thumbnail (no layout shift) and **degrades gracefully** to the plain link card when disabled, still loading, on error, or if the image fails. Positive/negative server cache. **Off by default**, gated by `MEMBA_ENABLE_LINK_PREVIEWS` (backend) + `VITE_ENABLE_LINK_PREVIEWS` (frontend). Design + security-review checklist: `docs/planning/FEED_LINK_PREVIEWS_DESIGN_2026-07-06.md`.

### Social feed — Wave 2: live proposal unfurl cards (2026-07-06)
- On-chain unfurls extend to **DAO proposals**: paste a Memba proposal link (`/<network>/dao/<realm-path>/proposal/<id>`) into a post and it renders a **live card** with the proposal's **title, status, and yes-share**, read via `getProposalDetail` — the same multi-framework (GovDAO / basedao) render parse the proposal page uses. Skeleton while loading; **degrades to a `Proposal #<id>` card** (never a crash) when the read fails. Only the canonical `…/proposal/<number>` shape matches — a DAO home or `…/treasury/…` path stays a plain link. Completes the typed-card trio (token / validator / proposal) on one `lib/feedUnfurl` parse → `PostUnfurls` card path. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: live validator unfurl cards (2026-07-06)
- On-chain unfurls extend to **validators**: paste a Memba validator link (`/<network>/validators/<operator-address>`) into a post and it renders a **live card** with the operator's **moniker and server type**, read from the `gno.land/r/gnops/valopers` registry `Render` (the same source the validators page uses). Resolves by the canonical **operator** address, shows a skeleton while loading, and **degrades to a truncated-address card** (never a crash) when the address isn't a registered valoper (e.g. a genesis validator). Detection is precise — `/validators/hacker` and the 4-segment `/validators/valoper/…` subpath stay plain links. Reuses the typed-ref + card path from the token cards (`lib/feedUnfurl` `validator` ref); proposal cards are next. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: live token unfurl cards (2026-07-06)
- On-chain object unfurls go **live** for tokens: paste a Memba token link (`/<network>/tokens/<SYMBOL>`) into a post and it renders a **live card** reading the token's **name, supply, and holder count** straight from the GRC20 factory `Render` (the same on-chain read the token page uses) — a differentiator no web2 feed can match. Shows a skeleton while the read is in flight and **degrades gracefully** to a plain `$SYMBOL` card if the token is unknown or the read fails (never a crash, never fabricated numbers). Detection is precise — the path's leading segment must be a real network key and the symbol GRC20-shaped — so arbitrary `/x/tokens/y` links on other sites stay plain link cards. Extends `lib/feedUnfurl` with a typed `token` ref on the existing parse → card path (validator / proposal cards slot in next the same way). Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: two-pane desktop rail (2026-07-06)
- On wide screens (≥1024px) the feed is now a **two-pane layout** — the timeline on the left, a **sticky ~300px right rail** on the right that holds the live **stats** (posts / replies / authors) and the **"Most replied"** discovery list, both promoted out of the header and inline timeline. Below 1024px it **collapses to a single column** (header → composer → activity strip → timeline), so nothing is lost on mobile. Pure layout — reuses the existing `GetFeedStats` data (no new RPC, no realm change); the rail is where typed live-data cards and who-to-follow will grow. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: "most replied" trending list (2026-07-06)
- The home feed now surfaces a compact **"Most replied"** list — the top-replied visible posts (reply-count-descending, hidden/deleted excluded), each opening its thread. Extends `GetFeedStats` with a `most_replied` field (same indexed reply-count the timeline uses); renders nothing until at least one post has replies, so a fresh feed stays clean. A discovery/trending surface on the live-stats data path. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: live feed stats (2026-07-06)
- The feed header now shows **live counters** — total posts, replies, and distinct authors — from a new public `GetFeedStats` RPC (three indexed `feed_posts` counts, hidden/deleted excluded; no auth). A first, self-contained step toward the panel's "fill the desktop with live data" right rail (most-replied / who-to-follow land next on the same data path). Behind `VITE_ENABLE_FEED`.

### Explorer — read any realm in-app (W9 P0, 2026-07-06)
- **New `/explorer/*` realm viewer** behind `VITE_ENABLE_EXPLORER` (ordinary flag, off by default): deep-linkable `/explorer/r/<path>` shows any realm's live **Render** (`vm/qrender`), authoritative on-chain **Source** (`vm/qfile`, reusing the Directory's viewer), and exported **Functions** (`vm/qfuncs` signatures). Read-only by construction — three query paths only, no `vm/qeval`/execution surface (SEC-01) — needs no wallet and moves no funds. Verified live on test13 across multiple realms. Deferred to a later increment: the qeval read-console (reopens the SEC-01 surface) and an in-app code editor.

### Social feed — Wave 2: on-chain object unfurls (2026-07-06)
- **The differentiator.** Paste a **gno.land realm/package reference** (`r/ns/name`, `p/ns/name`, or a full `gno.land/r/...` URL) into a post and it renders as an **on-chain card** below the body — an accent-spined "on-chain" chip with the realm name + namespace, linking to gno.land — something no web2 feed can do. Other URLs render as compact link cards (host + open-in-new-tab). Deterministic parse (`lib/feedUnfurl`, capped per post as light anti-spam, no external fetch); the cards sit above the card's open-thread overlay so they're independently clickable. Typed live-data cards (token supply, validator uptime, proposal votes) slot into the same parse → card path as a follow-up. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: own-post edit & delete (2026-07-06)
- The author of a post can now **manage it**: a `•••` menu on your own posts opens **inline edit** (Save broadcasts `EditPost`, optimistic body + an "· edited" marker) and **delete** behind a confirm that **discloses on-chain permanence** ("removed from Memba, but the original text is public and permanent on-chain") — Delete broadcasts `DeletePost` and the card becomes a tombstone immediately, reconciled by the indexer. Wires the two ready-but-unwired builders (`buildEditPostMsg` / `buildDeletePostMsg`); no realm change. Behind `VITE_ENABLE_FEED`.

### Social feed — Wave 2: infinite scroll (2026-07-06)
- The feed no longer stops at the newest 20 posts. The home timeline and profile timelines are **cursor-paginated with infinite scroll** (`useInfiniteQuery` over the already-live `nextCursor`), with a **"Load older posts"** control that stops when history is exhausted. A **separate lightweight page-0 poll** drives a **"N new posts" pill** (click to pull the freshest posts to the top) — so background refresh never re-fetches the deep loaded pages (the classic infinite-query thundering-herd). Optimistic-post reconciliation now flattens across pages. Still behind `VITE_ENABLE_FEED`.

### Social feed — Wave 1: timestamps, identity, a11y, notifications, moderation & read-freely (#767, #768, #769, #772, #773, 2026-07-06)
- **Human timestamps.** Posts showed "block 12345"; they now show relative time ("2m", "3h", "Jun 6"), sourced from a new deterministic `block_ts` — the block *header* time denormalized at ingest, which is rebuild-stable (unlike the indexer's ingest wall-clock, which re-stamps on a rebuild-from-raw). Block height moves to a hover tooltip.
- **Identity.** A deterministic mono-glyph tile (hashed hue + the first two glyphs — on-brand, no identicon dependency) plus a resolved `@handle` where available (falls back to the short address).
- **Accessibility.** The whole card opens its thread via a single labelled overlay control — the body is plain text again, not a paragraph announced as one button; `:focus-visible` rings on every control; the light-theme author name uses the AA-safe accent token; the post body switches to the humanist sans for readable long-form prose.
- **A flag that responds.** Optimistic count bump that reverts on failure and surfaces the realm's actionable panic (already-flagged / daily budget / account-age) via an `aria-live` alert, instead of the old silent `catch {}`.
- **Reply notifications.** A connected wallet now sees when others reply to its posts — a new public `GetReplyNotifications` RPC (replies to your posts, by others, live, newest-first, with an unread count relative to a last-seen id) plus a badge + expandable list on the home feed; last-seen persisted per address.
- **Moderation-leak fix.** A hidden or deleted post (a `GetFeedThread` root can be a tombstone) no longer renders its body client-side — it shows a tombstone, mirroring the realm's own `renderPost` suppression.
- **On-chain permanence disclosed** in the composer (posting is public and permanent; "delete" only hides the projection, the text stays on-chain).
- **Read freely, connect on action.** The feed is fully readable without a wallet; the composer input is always shown and clicking **Post connects the wallet and sends in one action**; the flag is visible to everyone and connects on click. Still behind `VITE_ENABLE_FEED` — no funds, no multisig paths.

### Observability — backend RPC & DB-pool metrics on /metrics (#764, 2026-07-06)
- **RPC duration histogram** `memba_rpc_duration_seconds{procedure,code}` via a transparent Connect interceptor (panics are metered as `code="panic"` and re-propagate unchanged), plus **`memba_rpc_in_flight`** — a real-time saturation gauge that surfaces a handler wedged on the single-writer DB lock *before* it ever records a duration.
- **DB connection-pool metrics** from `db.Stats()`: `memba_db_connections_{open,in_use,idle}` gauges + `memba_db_wait_count_total` / `memba_db_wait_duration_seconds_total` counters (the single-writer SQLite contention signal). All served behind the bearer-gated `/metrics` (U-2). Alert thresholds in `OPS_RUNBOOK.md` §3.4.

### Security — /metrics fails closed in prod when METRICS_BEARER is unset (#766, 2026-07-06)
- Previously an unset `METRICS_BEARER` served `/metrics` unauthenticated (fail-open). Now, in prod (on Fly), a missing bearer returns **503** rather than exposing per-method latency + DB-contention internals; off-Fly it stays open for local scrapes; the bearer-set path is unchanged. No effect on current prod (the bearer is set — U-2); this closes the accidental-unset exposure window.

### Social feed — thread view + profile timeline + replies (2026-07-05)
- The feed is now **threaded**: clicking a post opens **`/feed/post/:id`** (the post + its replies, oldest-first) with an inline **reply composer**; clicking an author opens **`/feed/user/:address`** (their posts, newest-first). Both read the already-live `GetFeedThread` / `GetUserFeed` RPCs — no realm redeploy or backend change. Replies broadcast to `memba_feed_v1` via the ordinary Adena flow with the same optimistic-insert + reconcile as the home timeline. `PostCard` + `FeedComposer` were extracted to shared components (`components/feed/`) so all three views render identically; malformed post-id / address links show a graceful "Invalid" state; the sub-routes sit behind the same `VITE_ENABLE_FEED` gate (e2e-verified). Still behind the flag — no new flag, no funds.

### UX — nav placement, marketplace & blog redesign, validator reviews fix (2026-07-04)
- **Sidebar nav**: Feed now sits directly under Home at the top of the nav; Leaderboard and Extensions moved to the utility tail next to Feedback (manifest-driven — `navManifest.ts` / `Sidebar.tsx`).
- **Marketplace / Services / NFT hero**: replaced the generic glossy gradient banner with an on-brand terminal header — a mono "live on gno.land" eyebrow with a pulse, a sharp per-lane title, and a row of true on-chain trust chips (per-lane accent glow; theme-aware; no fabricated metrics).
- **Blog**: editorial redesign — masthead with an RSS link, a featured "latest" post with an accent spine and reading time, and a compact index list; richer article typography (headings, lists, blockquotes, code).
- **Validator reviews (fix)**: the validators table showed reviews for only one validator. Root cause — the table queried each row's *signing* address, but reviews are posted to the *operator* address once a valoper is registered (the profile's canonical subject). The table now resolves each row to that same canonical subject (operator address, with the signing address merged as an alias), so ratings appear for every reviewed validator and match the profile.

### Hardening — Wave 7 deep-review guards (2026-07-04)
- **My Listings cancel** now routes the NFT delist through `routeNftV3()` instead of calling the delist builder directly — so it passes the same `isRealmValid(NFT_MARKETPLACE_V3_PATH)` allowlist guard every other v3 write-call-site uses (the broadcast layer doesn't check engine paths, so that guard is the invariant). No behavior change on the happy path; defense-in-depth consistency.
- A four-angle deep review of the merged Wave 7 work (feed 5-layer realm→indexer→sqlite→RPC→UI contract, codebase-wide broadcast-builder/flag audit, adversarial security, docs/consistency) came back clean on correctness. Follow-ups: **added `feed.test.ts`** pinning the Amino wire contract (`vm/MsgCall` + no coins) for all five feed builders — the newest builders had zero coverage, the exact gap that let the token OTC lane's wrong message type ship; added the same round-trip assertions to the badge mint builders. Made the activity bot's success-path state-save failure loud (matching the error path). Documented the two ready-but-unwired feed builders (`buildEditPostMsg`/`buildDeletePostMsg`) as intentional next-increment landing pads. (The one real code finding — a feed-realm orphan-index leak reachable via `UnhidePost` — is fixed in the deployer realm before it deploys.)

### Tooling — W7.3: testnet activity bot (2026-07-04)
- **New `cmd/activitybot`** — a TESTNET-ONLY tool that generates bounded on-chain activity (feed posts, small transfers) so the feed/marketplace don't look like a ghost town during launch. Follows the `badge-mint` safety pattern: it never holds a private key in Go — it plans a bounded batch and either prints `gnokey` commands (default dry-run) or shells out to `gnokey` (`--broadcast`) using a key referenced by name from the keyring. Hard rails: a kill switch (`ACTIVITYBOT_ENABLED` must be `"true"`, else clean no-op), per-run + rolling-daily transfer caps (state file), per-transfer and per-tx-gas ceilings, and clean-exit-on-error (never panics mid-batch; the day counter only advances for actions actually sent). Ships with a scenario schema + a runbook (`docs/ACTIVITYBOT_RUNBOOK.md`) covering the throwaway-key setup, GitHub-Actions scheduling (Fly has no declarative cron), and rotation. Not wired into any running service.

### Marketplace — W7.1 PR1: My Listings management (2026-07-04)
- **New "My Listings" surface** in the unified marketplace: the connected wallet's own active listings across the live lanes (NFT v3.1 + Token OTC), each with a one-click **cancel/delist**. A connected-only tab plus a `/marketplace/my-listings` route (which prompts to connect on a shared/bookmarked URL). Aggregates the existing per-lane readers filtered by seller (paginated, resilient to one lane's RPC failing via `allSettled`); cancel reuses the existing `DelistNFT` / `CancelListing` builders over the ordinary Adena broadcast (no multisig, no new realm, no new flag). Optimistic removal that self-corrects if the tx reverts (the reconcile refetch trusts the chain), per-wallet state reset on account switch; graceful connect/empty/loading/error states. Closes the "no way to manage your own listings" gap.
- **Fix: the token OTC lane's write path was silently broken** — its message builders (`ListTokens` / `CancelListing` / `Fill`) emitted the Amino type `"vm/msg/call"`, which the shared broadcast path rejects (it only accepts `"vm/MsgCall"`), so every token list/cancel/fill would have thrown before reaching the wallet. Corrected all three to `"vm/MsgCall"` (matching every other builder) and added a round-trip test through `toAdenaMessages` so it can't regress. Surfaced by the My Listings token-cancel path; the lane had been gated off, so it was never exercised.

### Social feed — W7.2 P1: /feed UI (2026-07-04)
- **New `/feed` page** behind the ordinary `VITE_ENABLE_FEED` flag (no funds): a global on-chain timeline reading the indexed backend projection, with a wallet-gated composer (optimistic insert + reconcile against the indexer) and a per-post flag action — all broadcasting to the `memba_feed_v1` realm via the ordinary Adena flow (no multisig paths touched). Graceful empty/loading/error states; post bodies render as escaped plain text (zero XSS).
- Wired through the 4-mode nav (Explore), route meta + sitemap (paired), and both `.env.example` files; reachable in the mobile "More" sheet. Fixed a latent flag-badge gap — the sidebar's literal-reader `FLAG_ON` map was missing the feed flag, which would have badged an enabled feed as "soon" (the documented prod-bundle-env trap). Off by default until the realm is deployed (owner-executed).

### Social feed — W7.2 P0: indexer + timeline API (2026-07-04)
- **Feed indexer** — a new, fully decoupled event-tailing indexer for the `memba_feed_v1` realm (its own goroutine, cursor `feed_indexer_state`, and raw ledger `feed_raw_events`, separate from the NFT money-path tailer so neither can stall or corrupt the other). Projects `PostCreated`/`Edited`/`Deleted`/`Flagged`/`AutoHidden`/`ModAction` events into `feed_posts`; idempotent writes, single-block reorg-safe rollback. Off by default — starts only when `FEED_WATCHED_REALMS` is set (safe while the realm is pre-deploy).
- **Timeline RPCs (public, no auth):** `GetFeedTimeline` (home timeline — newest top-level posts, cursor-paginated, visibility-filtered; replies are read per-thread), `GetUserFeed` (one author), `GetFeedThread` (a post + its live replies, oldest-first, with a deleted-parent tombstone root). These serve the low-latency indexed projection for optimistic UI; the realm stays the source of truth. Reposts are deferred to P1 (the proto field is reserved, not shipped as an always-empty field).

### Stability — stale-deploy chunk crash on mobile fixed (2026-07-04)
- **"'text/html' is not a valid JavaScript MIME type" no longer crashes navigation** (owner-reported, frequent on mobile): after every deploy the autoUpdate service worker purges the previous build's chunks from live tabs, and the next lazy route load imports the SPA-fallback `index.html` as JS. The root ErrorBoundary already auto-reloaded for Chrome's phrasing of that failure but missed iOS Safari's — mobile users got the generic error card once per deploy. The matcher now covers WebKit's phrasings, and a new `vite:preloadError` handler recovers preload-stage failures before they throw. Both paths share a one-reload-per-session budget, so a genuinely broken deploy still shows the error card instead of loop-reloading.

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
- **Reviews subject continuity (#600, 2026-06-27).** When a validator registers a valoper its canonical address flips from the signing address to the operator address, stranding reviews posted before registration under the old key (hit live on `samourai-crew-1`: operator `g1n9y62…`, signing `g1k7asng8…`). The profile now reads reviews from the **union of {operator, signing}** addresses and merges them (`mergeReviewsByAuthor` — dedupe by author, prefer the canonical-subject review); new reviews still post to the operator address. Summary is computed client-side from the merged set. Posting is now **optimistic** (instant insert via `makeOptimisticReview`/`upsertReviewByAuthor`, marked "Posting…" with actions hidden until confirmed, reconciled by a bounded poll, show-stale-while-revalidating). The post button shows a "Select a rating to post" hint and the `connecting` state always clears so it can't stick disabled. The durable realm-level fix is specced in `docs/planning/archive/shipped-2026-07/REVIEWS_V2_SUBJECT_CANONICALIZATION_SPEC_2026-06-27.md` (`memba_reviews_v2` with a moderator-set canonical-alias map; v1 is immutable; team-deployed, then this bridge is retired).
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
  `docs/reports/archive/v7.1-phase0-signoff.md`.

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
