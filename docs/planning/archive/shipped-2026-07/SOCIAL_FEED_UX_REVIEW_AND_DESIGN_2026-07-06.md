# Social Feed — Deep UX / UI / Code Review + Design Proposals

> **ARCHIVED 2026-07-09 — SHIPPED**: Wave 1 (#775) + Wave 2 (#777/#779/#780) + reactions/unfurls/link-previews/rich-text (through #805), behind `VITE_ENABLE_FEED`.

> **ARCHIVED 2026-07-09 — SHIPPED**: Wave 1 (#775) + Wave 2 (#777
**Date:** 2026-07-06 · **Scope:** `/feed` (memba_feed_v1 → indexer → RPC → UI) · **Reviewed against:** `origin/main @ f9793e4` (PR #763 P1.5 merged 08:13)
**Author:** CTO review pass · **Status:** for owner decision (proposals, not yet implemented)

> ⚠️ **State note:** local tree was stale (last local main `#761`). Fetched `origin/main`; the current feed is the **P1.5** build (thread view + profile + replies), *not* the flat P1 in the pinned screenshot. The screenshot shows the older deployed frontend or a mid-post `posting…` state. This review is against merged main.

---

## 1. What exists today (accurate)

| Layer | State |
|---|---|
| **Realm** `memba_feed_v1` | Mature, hardened. Open-write global feed. B1 render-DoS bounds (AVL live indexes, never iterates `nextPostID`), B2 tombstone hard-GC, B3 pause policy, flag pipeline (threshold=5, account-age + per-day budget), owner moderation. Holds **no funds**. Cursor JSON reads + bounded gnoweb Render. |
| **Indexer** | Fully decoupled tailer (own cursor `feed_indexer_state`, own raw ledger `feed_raw_events`), idempotent projection into `feed_posts`, single-block reorg rollback. Gated by `FEED_WATCHED_REALMS`. |
| **RPCs** (public, no auth) | `GetFeedTimeline` (top-level, cursor-paginated), `GetUserFeed`, `GetFeedThread` (root + live replies, oldest-first, tombstone-root aware). |
| **Frontend** | `/feed` (home), `/feed/post/:id` (thread + reply composer), `/feed/user/:address` (read-only profile). Shared `PostCard` + `FeedComposer`. Optimistic insert + reconcile. Flag action. Behind `VITE_ENABLE_FEED` via `FeedGate`. |

**Genuinely strong — do not regress:**
- Security posture: XSS-safe (React-escaped plain text; realm also `sanitizeForRender` for gnoweb), no funds, no multisig paths, decoupled indexer can't stall the money-path tailer.
- Honesty contract: empty/loading/error states are real; absent data omitted, never faked.
- Optimistic UX with bounded reconcile (no unbounded array growth, timers cleaned up).
- Cursor pagination is **built at every layer** — the API can already page; the UI just doesn't call it yet.

---

## 2. UX / UI findings (prioritized)

### P0 — breaks the core experience
1. **No human-readable time.** The proto carries only `block_h`; the UI literally renders **"block 12345"**. A user cannot tell a 30-second-old post from a 3-week-old one. This is the single biggest "feels broken" signal.
   → *Fix (cheap):* the indexer already stores `feed_posts.created_at` (ingest DATETIME ≈ post wall-clock within lag). Add `created_ts` (unix) to the proto + one line in `scanFeedPosts`; render **relative time** ("2m", "3h", "Jul 4"). Precedent exists (reviews realm resolves block→time via `/block?height=N`), but the indexer timestamp is one column away and needs no extra RPC.
2. **No identity — bare `g1…` addresses.** No avatar, no name. The feed reads anonymous/robotic; every post looks identical. → deterministic identicon (address-seeded) as the zero-cost floor; resolve Memba/`r/` usernames + avatars where available. Reuse whatever the Profile/Directory pages already use.
3. **Dead desktop layout.** A 640px centred column inside a full-width app = the exact "manage emptiness" failure the Home redesign (#584) fixed. On a wide viewport the page looks unfinished (see screenshot: ~70% empty). → give the page a purpose-built shell (right rail or framed column), not a lonely stripe.
4. **No pagination in the UI.** Only the newest 20 posts ever load; `nextCursor` is plumbed through the API and returned but **never consumed**. The feed has no history. → infinite scroll / "Load older".

### P1 — clearly incomplete for a "social feed"
5. **Flag UX is a dead click.** No confirm, no count feedback, no undo; the realm's `already flagged` / budget / age-gate panics are **swallowed** (`catch {}`), so a rejected flag silently does nothing. Local `flagged` state is per-mount and not server-derived (re-flag after refresh → silent realm reject). → optimistic count bump + surface actionable realm messages (same pattern the composer already uses).
6. **Author can't manage their own posts.** `buildEditPostMsg` / `buildDeletePostMsg` exist and are tested but **unwired** — no edit/delete affordance. → `•••` menu on own posts (Edit inline, Delete with confirm).
7. **No reply affordance on the timeline.** You must open the thread to reply; the reply-count button is the only path in, and it's unlabeled as "reply". → explicit Reply action on the card.
8. **Silent 20s content swap.** Background poll replaces the list with no "N new posts" pill; can jump scroll / drop the user's read position. → new-posts pill + prepend on demand; pause polling on hidden tab.
9. **Plain text only.** URLs, `@address` mentions, `#hashtags` are not linkified. Kills discovery and cross-linking. → safe linkify (house `markdownLite` + DOMPurify pattern already used by `/blog`).
10. **Thin engagement.** Replies + flag only. No like/react, no repost (realm field **reserved** for P1, not wired), no "copy link" despite deep-linkable `/feed/post/:id`. → at minimum a share/permalink; reactions/reposts are the growth levers.
11. **Optimistic reply doesn't bump the thread root's `replyCount`.** Root shows stale count until reconcile.

### P2 — polish / a11y
12. **Accessibility:** the whole post body is a `<button>` labeled with the entire body text (screen reader announces the paragraph as one button); author is a second nested-ish control. Prefer a card-level link/affordance + a small "Open thread" control, or an overlay-link pattern.
13. Monospace terminal aesthetic is on-brand but heavy for long social text — consider a readable body face while keeping mono for meta/handles.
14. No per-action loading beyond `disabled`; `maxLength = MAX+100` paste-then-warn is a subtly confusing counter.
15. Profile page: no pagination, no post/reply distinction, no follow, no "back to thread" from a standalone reply.

---

## 3. Code findings

- **`sameContent` reconciliation keys on `author + body`.** Two identical posts, or an edit landing during reconcile, mis-match. Low real-world impact (cooldown blocks rapid dupes) but a known sharp edge — documented, acceptable for now; a client nonce echoed by the realm would be the clean fix (realm doesn't emit one today).
- **`nextCursor` is dead capability** end-to-end in the UI (see P0-4).
- **Reply count = correlated `COUNT(*)` subquery per row** in `feedPostSelect`. Fine at launch scale; denormalize a `reply_count` column (maintained by the dispatcher) before the feed gets large.
- **Poll never pauses on `visibilitychange`** — background tabs keep hitting the RPC every 20s.
- **Flag errors swallowed** (P1-5) — the one place the UI hides an actionable on-chain message.
- Realm/indexer/RPC are clean; the `UnhidePost` orphan-index leak was already caught + fixed (deployer #57). No new correctness issues found in the realm.

**Deferred-by-design (correctly):** media/CIDs (realm supports up to 4; not carried past the realm — P2 pinning pipeline), reposts (reserved), moderation board (W8.2 daokit modboard). These are *intentional* gaps, not bugs.

---

## 4. Design proposals

Three directions, increasing ambition. They compose — A is the foundation for B is the foundation for C.

### Direction A — "Make it feel alive" (essentials) — **recommended first, 1 PR wave**
The smallest set that turns "looks broken" into "feels like a product." All low-risk, no funds, no new realm.
- **Relative timestamps** (expose indexer `created_ts`).
- **Identity:** identicon + resolved name where available.
- **Infinite scroll** (wire the existing cursor).
- **Own-post edit/delete** (wire existing builders).
- **Flag that responds:** optimistic count + surfaced realm messages.
- **Copy-link / permalink** on every post.
- **Layout fix:** frame the column properly (header, subtle rail or bounded card canvas) so desktop isn't 70% empty.

*Return:* highest UX-per-effort. Ships the difference between "demo" and "usable."

### Direction B — "Social-grade" — next wave
- **Two-pane layout:** timeline + right rail (feed stats from `GetStatsJSON`, "trending"/most-replied, who-to-follow, ecosystem callouts) — mirrors the Home "fill the emptiness with live data" win.
- **Rich text:** linkify URLs / `@mentions` (→ profile) / `#hashtags` (→ filtered view).
- **Reactions** (lightweight, could be off-chain-cheap or a realm counter) and **new-posts pill**.
- **Reposts** (wire the reserved realm field + `PostReposted` dispatcher).
- **Media** once the pin pipeline lands.

### Direction C — "Ecosystem timeline" (strategic, W8+)
Position the feed as the **on-chain activity spine** of Memba, not a standalone Twitter clone:
- Unify with the **Home activity feed** — validators, DAO votes, marketplace, NFT mints, multisig as first-class *post kinds* alongside user posts, with type-filter chips (the Home feed already does verb-first humanized titles + diversity caps — reuse that engine).
- **Follows + a personalized timeline**, notifications.
- This is what the `FeedGate` copy already promises ("a single global timeline of ecosystem activity", "follows and reposts coming next") — C makes the promise real and is a genuine differentiator vs a generic feed.

**Recommendation:** ship **A now** (converts the feature from fragile-demo to real), then **B**. Hold **C** as the roadmap bet — it's where the feed becomes a moat, but it depends on A+B and on the W8.2 moderation board for open-write safety at scale.

### Cross-cutting: open-write safety before you turn up the volume
The feed is **open-write**. Damping (cooldowns, flag budget, account-age) is deliberately *not* brigade-proof (the realm comments say so). Before any growth push (activity bot, launch marketing), the **W8.2 moderation board** (reversible mod actions + audit, daokit role) should land — otherwise the first coordinated spam/brigade is an owner-only firefight.

---

## 5. Suggested sequencing (if A is approved)

1. Proto + indexer: `created_ts` on `FeedPost` (P0-1). *(backend, ~small)*
2. `PostCard`: relative time + identicon + name resolution + copy-link (P0-1,2 / P1-10).
3. `FeedPage`/`FeedProfile`/`FeedThread`: infinite scroll via existing cursor (P0-4).
4. Own-post `•••` Edit/Delete (P1-6).
5. Flag: optimistic + surfaced errors (P1-5).
6. Layout shell so desktop isn't empty (P0-3) — can be minimal in A, full rail in B.

Each is independently shippable behind the existing flag; none touches funds or multisig.

---

---

## 6. Expert panel (4 independent lenses) — synthesis

Four independent audits (product/social-UX, visual/UI+a11y, frontend architecture, on-chain/security+T&S) reviewed the merged feed and this doc. They **converged** on the top symptoms but **corrected three of my calls** and surfaced issues I missed.

### Consensus (high confidence)
- **"block 12345" is the #1 broken-feel signal** — all four agree relative time is the first fix.
- **Bare `g1…` identity is #2** — the feed is unscannable without visual differentiation.
- **The swallowed flag error is a real bug** — every lens flagged `catch {}` in `PostCard.flag`: a rejected/duplicate/budget-blocked flag silently no-ops.
- **Land the moderation board before any growth push** — the security lens calls this *under*-stated, not over-.

### Corrections to my review (I got these wrong)
1. **⛔ Timestamp source — my fix was wrong.** I proposed exposing the indexer's `created_at` (ingest wall-clock). Security lens: that's **non-deterministic** — it lags the tailer, and a rebuild-from-raw **re-stamps every post to rebuild-time**. Correct source = **`block_h` → block time, denormalized once at ingest into an indexed `block_ts` column from the block header** (deterministic, survives rebuild, reorg-safe). Never `CURRENT_TIMESTAMP`. Display relative time from `block_ts`.
2. **⛔ On-chain permanence is undisclosed — the biggest honesty gap, and it wasn't in my findings.** `DeletePost` clears realm state but the body lives in the `PostCreated` event (and `feed_raw_events`) **forever**. "Delete" = projection-hide, not delete. The UI **must** disclose this at compose *and* delete. This is a **GDPR / illegal-content** reality — a **hard blocker** for a public growth push without a serving-blocklist mechanism. My §1 "honesty contract, never faked" praise was overstated on exactly this point.
3. **↕ Priority inversion — A is ordered by implementation risk, not engagement.** Product lens: Direction A ships *legibility* (you can now read the void) but **zero reason to return**. The retention loop — **"someone replied to you"** notifications — is buried in Direction C but is buildable *today* from `PostCreated`+`replyTo`, already emitted and indexed. Pull it forward.

### Issues the review missed (added by the panel)
- **`PostCard` never reads `hidden`/`deleted`** (frontend) — a flag-hidden or tombstoned **root** post can render its body client-side. Client-side moderation-suppression gap; add a tombstone render.
- **`sameContent` reconciliation is MED, not "low"** (frontend) — reposts and short duplicate replies ("gm", "+1") are *normal* social behavior; content-only matching drops or double-renders them, and the `onPosted` guard even blocks a legitimate second identical post. Reads as "my post failed."
- **Light-theme contrast bug** (visual) — `.feed-post__author` uses `--color-primary` (`#00a88a`, ~2.7:1) as *text* → **fails WCAG AA**. Token file already ships the fix: `--color-k-accent-text` (`#0f6e56`).
- **Body-as-`<button>` is a P0/P1 a11y defect, not P2** (visual) — a screen reader announces the whole paragraph as one button's name. Fix = card-level **overlay-link** (`<a>::after{inset:0}`, actions `z-index:1`).
- **Missing `:focus-visible`** across all chrome-reset feed buttons (visual) — keyboard users get no focus ring.
- **Flag-brigade is cheaper than spam-flooding** (security) — ~5 age-gated sybils (one post + a one-time ~1–2h wait, farmable in parallel) auto-hide a post *instantly*; reversal is a slow multisig-per-post `UnhidePost`. The asymmetry favors the attacker.
- **`MaxRepliesPerPost` churn-refill** (security) — deleting a reply frees a slot, so reply-bombing can evade the 500 cap indefinitely; count lifetime, not live.
- **Cold-start / ghost town** (product) — nobody asked "what does post #1 see?" The activity-spine idea (Direction C) actually *solves* cold-start, which argues against putting C last.
- **No OG/share cards** on `/feed/post/:id` (product) — off-platform distribution is how feeds grow; "copy-link" is the weakest form of it.
- **Infinite-query gotcha** (frontend) — don't `refetchInterval` an infinite query (refetches *every* loaded page). Poll **page-0 only** → "N new posts" pill; keep optimistic-prepend in local state above `data.pages`.

### Panel design specs (concrete, adopt these)
- **Identity = mono-glyph tile, NOT jazzicon/blockies** (off-brand). 40px (32px mobile) **rounded square** (`--radius-md`), 1px border, address-hashed muted tint (`hsl(H,22%,14%)` dark / `hsl(H,40%,92%)` light), first 2 chars after `g1` in mono. Swap to `<img>` when a Memba/`r/` avatar resolves (reuse `DashboardIdentityCard`'s avatar path); glyph is the fallback.
- **Typography split:** mono stays for *chrome* (handle, address, time, counts); **body → `--font-sans` (Inter, already a token) at 15px/1.55**. Long social prose in mono is genuinely harder to read — make this non-optional.
- **Layout:** ship the **framed-canvas** first (bordered surface + contextual header around the 640px column) — a rail with no data *doubles* the emptiness. Add the right rail only in Wave 2, **backed by `GetStatsJSON` + most-replied** (the real "fill emptiness with live data" per Home #584).
- **Post-card hierarchy:** body (15/normal/`--color-text`) > name (13/600) > actions (13/secondary) > handle+time (10–12/muted). Block height moves to a `title=` tooltip, off the top line entirely.

---

## 7. Revised sequencing (supersedes §5)

The panel's re-order: merge legibility + one retention hook + the safety/correctness must-fixes into Wave 1; defer scale/polish.

**Wave 1 — "Legible · a reason to return · safe to show"**
- `block_ts` denormalization (indexer + proto) → **relative time** *(the corrected P0-1)*
- **Identity:** mono-glyph tile + name resolution
- **Reply notifications:** "your posts got N replies" surface *(pulled from C — the retention loop; data already on-chain)*
- **Flag that responds:** optimistic count + surfaced realm errors via `aria-live`
- **`PostCard` reads `hidden`/`deleted`** → tombstone render *(moderation-leak fix)*
- **Permanence disclosure** at compose + delete *(honesty/legal)*
- **a11y:** overlay-link body, `:focus-visible`, light-theme author token
- **Framed-canvas layout** (no rail yet)

**Wave 2 — scale + creator comfort**
- Infinite scroll (page-0 poll + "N new" pill; `useInfiniteQuery`)
- Own-post edit/delete (`•••`)
- Reactions (author-visible counts)
- Right rail backed by `GetStatsJSON` + most-replied
- Fix `sameContent` reconciliation (client-id keying / short TTL)

**Wave 3+ (Directions B→C)** — reposts (reserved field), rich text (links/@/#), OG share cards, activity-spine unification, follows + personalized timeline.

**Growth-push gate (must exist before activity bot / marketing):**
1. Moderation board **or** an interim hot-key moderator role (instant reversal, not multisig-per-post)
2. Serving-blocklist for illegal content/CIDs (chain is immutable; the only lever is refusing to index/serve)
3. Server-side automated `SweepTombstones` cron + a flag/abuse dashboard off the existing events
4. `block_ts` + permanence disclosure shipped (Wave 1)

---

---

## 8. Product DNA — the "great, smooth mix" of X · SoundCloud · Instagram · Facebook

Target: a feed that feels like the best of all four. The trap is building all four literally — you get a bloated, incoherent app. The craft is **one skeleton, layered capabilities, and a Memba-native twist none of the four have.**

### What each contributes (and what we drop)

| App | What we take | How it maps on-chain | Cost / verdict |
|---|---|---|---|
| **X / Twitter** | The **skeleton**: short posts, threads, reposts + quote-posts, follows, @mentions, #hashtags, "N new posts" pill, notifications, trending. | Mostly built or one realm field away (`RepostOf` reserved; follows = a graph; notifications derive from indexed `PostCreated`+`replyTo`). | **Core.** 80% of the build. Already closest to this. |
| **Facebook** | **Rich link cards**, **reactions** (beyond a single flag), **communities/groups**, nested comments, "what's on your mind" composer. | Groups = **Memba DAOs/Orgs already exist** → per-community *scoped* feeds. Link cards → see the twist below. | **High fit.** Groups-via-DAOs is nearly free and very on-brand. |
| **Instagram** | **Visual-first** image/carousel posts, **grid profile**, double-tap like, Explore/discovery. | Image posts need the **media pipeline** (CIDs → pin → serve). Realm already stores `MediaCIDs` (max 4); backend doesn't carry them, no pin proxy yet. | **Gated on media pipeline.** The realm plumbing exists; the pin/serve + moderation layer doesn't. |
| **SoundCloud** | **Audio posts** w/ waveform player, creator-as-artist profiles, continuous "next up" play, timestamped comments on a track. | Audio = same media pipeline (audio CIDs) + a player. Timestamped comments = novel, far-future. | **Media-pipeline-gated + specialized.** Only worth it if audio/creators are a real Memba use case. |

**Dropped, honestly:**
- **Instagram/SoundCloud "Stories" / ephemerality** — *impossible to do honestly on an immutable public ledger.* Content is permanent on-chain; a "disappearing" story would be a UI lie. Drop it, or it becomes an off-chain-only layer that breaks the everything-on-chain ethos.
- **SoundCloud timestamped-audio-comments** — deferred indefinitely; high complexity, narrow payoff.

### The synthesis stack (coherent, not a clone)

```
  ┌─ Memba-native twist:  ON-CHAIN OBJECT UNFURLS ─────────────┐
  │  paste a proposal / NFT / token / validator / realm link → │
  │  it renders as a LIVE card (vote state, price, supply,     │
  │  uptime). This is Facebook link-unfurl × the activity      │
  │  spine — and NO web2 feed can do it. The differentiator.   │
  ├────────────────────────────────────────────────────────────┤
  │  RICH MEDIA        image · carousel · audio (IG + SC)       │  ← media pipeline
  │  RICH CARDS        reactions · quote-repost (FB + X)        │
  │  COMMUNITY         global feed + per-DAO/Org feeds (FB grp) │
  ├────────────────────────────────────────────────────────────┤
  │  SKELETON (X)  posts · threads · follows · notifications ·  │
  │                mentions · hashtags · new-posts pill · trend │
  └────────────────────────────────────────────────────────────┘
```

The **on-chain-object unfurl** is the strategic bet: it's the one thing X/IG/FB/SC structurally *cannot* do, it directly fulfills the FeedGate "single global timeline of ecosystem activity" promise, and it reuses the Home activity-feed humanizer that already exists. That's how the mix becomes a **Memba** product, not a worse Twitter.

### Two architectural decisions to lock NOW (so Wave 1 doesn't paint us in)

1. **Media pipeline** — even though media ships later, design it now: `MediaCIDs` → backend pin (or pin-service) → an image/audio **serving proxy** with a **serving-blocklist** (the security lens' hard requirement — the chain is immutable, so refusing-to-serve is the *only* takedown lever for illegal content). Decide: self-pin vs. a pinning service; proxy vs. direct gateway. Getting the schema + proxy + blocklist right is the gate for everything IG/SoundCloud.

2. **Reaction model — the cost tension.** On-chain per-like = a wallet popup + gas + latency per tap = kills the IG/SC instant-like feel. Options:
   - **(a) On-chain reactions, aggressively optimistic** — instant local UI, background broadcast, reconcile. Stays on-ethos; every like is still a tx (gas, connected wallet, can fail). *Recommended for launch.*
   - **(b) Off-chain reactions** — instant + free + no wallet, but not censorship-resistant/portable and breaks the on-chain ethos.
   - **(c) Hybrid** — off-chain instant "like" for dopamine + an optional on-chain **endorse/tip** as the strong, portable signal. *Recommended evolution.*

### The one strategic fork (drives Wave 2 vs Wave 3 ordering)

**Is Memba's feed discourse-first (X/FB) or media/creator-first (IG/SoundCloud)?** Memba today is governance/community/DAO/marketplace — which argues **discourse-first, with on-chain-object unfurls as the near-term differentiator and media as a fast-follow once the pin pipeline + blocklist land.** But you named IG + SoundCloud explicitly, so if creators/media are the growth thesis, the media pipeline jumps from Wave 3 to Wave 2. This is a cheap decision to make now and expensive to reverse later.

---

## 9. Target experience map → revised waves (refines §7)

Wave 1 is unchanged and **fork-independent** (legibility + retention hook + safety — no media, no reactions). The mix lands in Waves 2–4:

| Capability | Source apps | Wave (discourse-first) | Notes |
|---|---|---|---|
| Relative time · identity tile · reply notifications · flag-fix · permanence disclosure · a11y · framed layout | X | **Wave 1** | Fork-independent. The legibility + retention + safety floor. |
| **On-chain object unfurls** (proposal/NFT/token/validator) | FB × Memba | **Wave 2** | The differentiator. Mostly FE + a resolver; **no new realm**. Elevated. |
| Reactions (model decided above) | IG/FB | **Wave 2** | Optimistic; decide (a)/(c). |
| Infinite scroll · edit/delete · "N new" pill · live right rail | X | **Wave 2** | Scale + creator comfort. |
| Quote-repost + repost | X | **Wave 3** | Realm `RepostOf` reserved; wire it. |
| Rich text (links · @ · #) · OG share cards | X/FB | **Wave 3** | Off-platform distribution. |
| **Media posts** (image → carousel → audio + waveform) | IG/SC | **Wave 3** *(→ Wave 2 if media-first)* | Gated on pin pipeline + serving-blocklist. |
| Follows + For-You / Following tabs | X | **Wave 3** | Needs a follow graph. |
| Per-community feeds (global + your DAOs) | FB groups | **Wave 4** | Reuses existing DAO/Org membership. |
| Grid profile · Explore/trending · creator profiles | IG/SC | **Wave 4** | Media-dependent. |

**Growth-push gate still applies** (moderation lever + serving-blocklist + sweep cron + Wave-1 safety) — and now the **media serving-blocklist is a hard prerequisite** for any IG/SoundCloud media wave.

---

---

## 10. Wave 1 — implementation plan (per-PR, TDD, behind `VITE_ENABLE_FEED`)

Fork-independent. Each PR is independently shippable, flag-gated, and follows the house TDD + auto-merge gates. `PostCard` is touched by several — sequence the card PRs to avoid self-conflict (order below does).

| # | PR | Layer | Depends on | Core work | Key tests |
|---|---|---|---|---|---|
| 1 | **Deterministic timestamps** | indexer + proto + FE | — | Migration `019`: `feed_posts.block_ts`; tailer writes it **from the block header** at ingest (not `CURRENT_TIMESTAMP`); backfill existing rows via `/block?height=N` or leave `0`→"unknown". Proto `int64 block_ts = 12`. RPC scans it. FE `relativeTime()` util; PostCard shows "2h", block height → `title=` tooltip. | header→`block_ts` mapping; rebuild-from-raw is stable; relative-time formatting; `0`→graceful. |
| 2 | **Tombstone render (mod-leak fix)** | FE | — | `PostCard` reads `hidden`/`deleted` → renders "post removed/hidden" instead of body. Covers the `FeedThread` root path. | hidden/deleted → tombstone, never body; thread root tombstone. |
| 3 | **Permanence disclosure** | FE | — | Composer helper line: "Posts are public & permanent on-chain." (Delete-time disclosure ships with the delete affordance in W2.) | disclosure present on composer. |
| 4 | **Identity — mono-glyph tile + name** | FE | 1 (card head) | `FeedAvatar` (address→`hsl` tint, rounded square, first 2 chars after `g1`); resolve Memba/`r/` name+avatar where available (reuse `DashboardIdentityCard` path), tile is the fallback. New card head layout. | deterministic tile per address; avatar-resolves swap; fallback. |
| 5 | **Flag that responds** | FE | 4 | Optimistic count bump; surface realm panics (`already flagged`/budget/age) via `aria-live` (reuse composer error pattern). *Note:* "have I already flagged" isn't realm-readable per-viewer today → interim is optimistic + error-surfacing; a durable "flagged" state needs an indexed flagger set (W2 follow-up, logged). | error surfaced not swallowed; disabled post-flag; count bumps. |
| 6 | **a11y + framed layout** | FE + CSS | 4,5 | Overlay-link card (`body` = `div`, card-level `<a>::after{inset:0}`, actions `z-index:1`); `:focus-visible` on all feed buttons; light-theme author → `--color-k-accent-text`; `aria-label` on reply/flag; ≥24px targets. Framed-canvas page shell; **body → `--font-sans`**, chrome stays mono; hierarchy per §6. | axe clean; contrast AA both themes; keyboard focus visible. |
| 7 | **Reply notifications ("you got replies")** | backend + FE | 1 | The retention hook. New RPC `GetReplyNotifications(author, sinceCursor)` deriving from indexed `feed_posts` (replies to my authored posts, excluding my own), newest-first + unread count. FE: a badge on the Feed nav + a lightweight "N new replies" surface on `/feed` when connected; persist last-seen locally. | replies to my posts count; my own replies excluded; since-cursor paging; unread count. |

**Sequencing:** PRs **1 · 2 · 3** are independent (safety/correctness/backend) — parallelizable. **4 → 5 → 6** are the `PostCard`/layout chain (sequential, same files). **7** is the largest and the highest product value; it can run in parallel with the card chain (backend-led). Realistic shape: 2 short waves of PRs, ~7 PRs total, all behind the existing flag so nothing is user-visible until the flag flips.

**Not in Wave 1 (deliberately):** infinite scroll, edit/delete, reactions, media, reposts, on-chain unfurls, follows — those are Waves 2–4 per §9, and several are gated on the media pipeline + moderation lever decisions in §8.

**Coordination:** a parallel session is active (worktrees: block-party, chunk-error, sig-verified — none on feed). Before starting, add a `docs/planning/SESSION_SYNC.md` entry claiming the feed surface, and build in a fresh `feat/feed-wave1-*` worktree (never on `main`; PR per item; no merge without owner approval).

---

*Deliverable of record for this session — 4-lens expert panel + the X/SoundCloud/Instagram/Facebook product-DNA synthesis + Wave-1 per-PR plan. Visual mockup accompanies (before → card taxonomy → Direction A/B/C).* 
