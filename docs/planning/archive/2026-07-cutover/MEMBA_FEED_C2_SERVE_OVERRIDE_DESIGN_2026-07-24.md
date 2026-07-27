# Feed v2 Wave C.2 — Serve-Override Lever (design spec)

**Date:** 2026-07-24 · **Status:** design APPROVED (owner chose "ship (A) only, defer (B)") · **Scope:** backend-only, zero realm deploy.

## 1. Problem
Memba's feed is open-write; the realm `memba_feed_v1` auto-hides a post (`PostAutoHidden`, projected to `feed_posts.hidden=1`) the instant the on-chain flag count crosses a threshold. A handful of sybils can therefore **flag-brigade** a legitimate post into silence. Today the *only* reversal is an on-chain `ModAction unhide` signed by the realm multisig — slow and ceremonial. We want a fast, safe operator lever to restore a wrongly-brigaded post.

## 2. What was rejected (4-lens design review, 2026-07-24) and why
The Jul-13 plan's C.2 row proposed **default public "quarantine"**: serve *every* flag-auto-hidden post's body to the anonymous public behind a click-through veil (`quarantined=true`), gated on `VITE_ENABLE_FEED`. Four independent expert lenses converged against it:
- **Security — UNSAFE.** `PostAutoHidden` fires automatically *before any human review*, and the auto-hidden set is enriched for illegal content. Default-serving it behind a "view anyway" veil makes un-reviewed illegal content *more* accessible than today's exclusion. The plan's "illegal never quarantines" rule is a manual takedown racing an automatic, instant exposure it cannot win.
- **API/ops — mis-gated.** `VITE_ENABLE_FEED` is a *frontend* build flag and cannot gate a *backend* serving change; the backend serves the OG crawler + direct RPC callers regardless, so flagged bodies would hit the public wire ungated. The OG edge function (`frontend/src/lib/feedOg.ts`) keys `isTombstone` on the `hidden` bit — clearing it to render a veil would leak moderated bodies into permanent third-party unfurl caches.
- **UX — doesn't earn its complexity now.** At current scale flag-hidden ≈ spam/abuse, not brigaded-legit speech; a blanket "view anyway" mis-applies the contested-speech pattern and invites clicking through exactly what flags meant to suppress. Transparency comes from C.5's public log, not a per-post reveal button.
- **Data-integrity — NEEDS-CHANGES.** (see §4) plus: **drop `hidden_cause`** (derivable + rebuild-trap), add `idx_feed_posts_served` (avoid a home-timeline filesort), `reply_count` semantics must be pinned.

**Conclusion:** the operator lever (below) alone delivers the anti-brigade goal, safely. The public veil is deferred to its own future spec.

## 3. Approved design — operator serve-override (A only)
A moderator, holding `FEED_MODERATION_BEARER`, force-serves a wrongly-brigaded post back to **full** visibility with one curl. Nothing serves un-reviewed content; the only posts that become visible are ones a human explicitly vouched for. Security guardrail G1 ("human-gated, fail-closed") holds *by construction*.

### 3.1 Migration `026_feed_serving_overrides.sql`
```sql
-- Out-of-band operator serving override (feed v2 plan C.2). Sibling of
-- feed_blocklist: ops-only, NOT derived from chain events, never written by the
-- indexer, NOT touched by rollbackFeedFromHeight, survives rebuild-from-raw.
-- PRESENCE of a row = force-serve this post to full visibility despite a
-- flag-auto-hide. It can NEVER beat a blocklist row or a deleted tombstone —
-- read-path precedence resolves those first (see §3.3), so an override can never
-- become a blocklist/delete bypass. clear_override deletes the row.
CREATE TABLE IF NOT EXISTS feed_serving_overrides (
    post_id  INTEGER PRIMARY KEY,               -- realm post id (top-level or reply)
    reason   TEXT NOT NULL DEFAULT '',
    added_by TEXT NOT NULL DEFAULT '',           -- operator identity for audit
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The home timeline is served by idx_feed_posts_visible (reply_to, hidden,
-- deleted, post_id DESC), which PINS hidden=0. Honoring a serve-override means a
-- hidden=1 row can now be visible, so the read path can no longer pin hidden in
-- the index and would fall back to "USE TEMP B-TREE FOR ORDER BY" on the feed's
-- hottest query. This index pins the columns that stay equality (reply_to=0,
-- deleted=0) and walks post_id DESC directly; hidden/override/blocklist become
-- residual filters on the tiny survivor set. GATE: EXPLAIN QUERY PLAN on the new
-- GetFeedTimeline query MUST read USING INDEX idx_feed_posts_served with NO TEMP B-TREE.
CREATE INDEX IF NOT EXISTS idx_feed_posts_served
    ON feed_posts (reply_to, deleted, post_id DESC);
```
- **No `hidden_cause` column.** In the deployed realm `hidden=1 AND deleted=0` ⟺ flag-caused (there is no mod-hide-without-delete event), so the column carries zero serving information and its migration-backfill-vs-dispatcher-write split is a rebuild-divergence trap. Add it only in the same future migration that introduces a real `ModAction hide` event.
- **No `direction` column.** This PR ships force-**serve** only (presence = serve). A symmetric `override_hide` lever overlaps `feed_blocklist` and is deferred (add a column/table when a real need appears).

### 3.2 Endpoint — extend `POST /api/feed/moderation` (same bearer)
Two new `action` values on the existing fail-closed, bearer-gated, constant-time handler (`feed_moderation.go`); reuse the existing `{post_id, action, reason, by}` body and `{ok, post_id, action}` response:
- `override_serve` → `INSERT INTO feed_serving_overrides ... ON CONFLICT(post_id) DO UPDATE` (idempotent). **Reject (409) unless the post EXISTS and is neither deleted nor blocklisted** (`EXISTS(feed_posts WHERE post_id=? AND deleted=0) AND NOT EXISTS(feed_blocklist WHERE post_id=?)`) — you can't vouch for content you can't see, and a pre-emptive override on a future id would auto-restore it unreviewed. (Hardening from review lens A. `block` stays pre-emptive — suppression is the safe direction, so the asymmetry is intentional.)
- `clear_override` → `DELETE FROM feed_serving_overrides WHERE post_id = ?` (idempotent no-op if absent).
- `block` clears any override **in the same transaction** as the blocklist insert (atomic — a partial apply can't leave an override a later unblock would resurrect; hardening from review lens B).
- Both emit a `slog.Warn("feed moderation: ...", "postId", "by", "reason")` line — audit parity with `block`/`unblock`.
- The bearer gate sits before the action switch and is untouched; `GetFlaggedPosts` shares only the pure `feedModBearerOKHeader` helper — no coupling, no regression.

### 3.3 Read-path precedence (total, first match wins)
Resolved in one place, honored by every read path:

| # | Condition | State | Body | Appears in |
|---|---|---|---|---|
| 1 | `post_id ∈ feed_blocklist` | HARD TOMBSTONE | never | nowhere; thread-root → 404 |
| 2 | `deleted = 1` | TOMBSTONE | `''` (already wiped) | thread root only (anchor) |
| 3 | `hidden = 1 AND EXISTS(serve-override)` | **FORCE-SERVED** | full | everywhere, as a normal post (effective `hidden=false`) |
| 4 | `hidden = 1` (no override) | HIDDEN | — | **nowhere (tombstone, exactly as today)** |
| 5 | `hidden = 0` | LIVE | full | everywhere |

Blocklist (1) and deleted (2) sit **above** the override, so `override_serve` can never resurrect illegal or deleted content (and couldn't anyway — row-2 bodies are wiped in the projection).

Concretely, `GetFeedTimeline` / `GetUserFeed` / `GetFeedThread` (root + replies) change from
`hidden = 0 AND deleted = 0 AND NOT EXISTS(blocklist)` to:
```sql
deleted = 0 AND NOT EXISTS(blocklist)
AND (hidden = 0 OR EXISTS(SELECT 1 FROM feed_serving_overrides o WHERE o.post_id = p.post_id))
```
and the scanned `hidden` value becomes the **effective** hidden — `hidden = 1 AND NOT overridden` — so a restored post presents `hidden=false` and renders as a normal post everywhere (timeline, profile, permalink, OG) with **no proto change and no frontend change**.

**Scope of the effective-hidden computation:** it applies to the **public** read paths only (`GetFeedTimeline`, `GetUserFeed`, `GetFeedThread` root + replies). The bearer-gated `GetFlaggedPosts` queue is **left exactly as-is this PR** — it keeps raw `hidden` and its `(flag_count > 0 OR hidden = 1)` predicate, so an overridden post still surfaces in the moderation queue (via `flag_count > 0`). Surfacing per-post override status *in the queue response* is C.4's additive job on the bearer-gated response, not this PR. Implementation note: keep `feedPostSelect` (shared with `GetFlaggedPosts`) returning raw `p.hidden`; compute effective-hidden via a `LEFT JOIN feed_serving_overrides` (or `NOT EXISTS`) column in the public-read queries specifically — do not blanket-rewrite the shared select.

### 3.4 Explicitly NOT changing
- **No proto change** (no `quarantined` field — that belongs to the deferred (B)).
- **No frontend change** (a restored post is a normal post; PostCard/OG already render `hidden=false` posts correctly).
- **`GetFeedStats` (counts + `idx_feed_posts_most_replied`) and `GetReplyNotifications` keep excluding `hidden=1`** — a restored post's *parent counters* are never re-ranked or pushed; only the post itself becomes visible.
- **`reply_count` = organic-live count** (022 triggers unchanged; they count `hidden=0 AND deleted=0 AND NOT blocklisted`). A force-served *reply* renders without moving its parent's `reply_count`; this is documented, not a bug. Do not extend the 022 triggers (reopens their blast radius).
- **`feed_serving_overrides` stays OUT of `rollbackFeedFromHeight`** (feed_tailer.go), exactly like `feed_blocklist`.

## 4. Test plan (TDD — watch each fail first)
1. **Migration:** 026 applies; table + index exist; `EXPLAIN QUERY PLAN` on the new timeline query uses `idx_feed_posts_served`, **no `TEMP B-TREE`**.
2. **Endpoint:** unset bearer → 404; wrong bearer → 401; `override_serve` upserts (idempotent); `clear_override` deletes (idempotent no-op when absent); `override_serve` on a deleted/blocklisted post → 409; both emit audit logs.
3. **Read precedence (per row of §3.3):** blocklisted stays hidden even with an override; deleted stays a tombstone even with an override; flag-hidden + override → visible with `hidden=false` in timeline/user-feed/thread-root/replies; flag-hidden without override → absent (as today); live unaffected.
4. **Isolation:** override never appears in `GetFeedStats` counts / most-replied / `GetReplyNotifications`; `reply_count` unchanged by an override.
5. **Reorg:** `rollbackFeedFromHeight` leaves `feed_serving_overrides` intact.

## 5. Deferred — (B) public quarantine veil (future spec, do NOT build here)
If ever built it must: be gated by a **new backend** fail-closed flag (e.g. `FEED_QUARANTINE_SERVING`, unset=off), NOT `VITE_ENABLE_FEED`; be **permalink-scope only** (never timeline/notifications/trending); keep the proto `hidden` bit set and add `quarantined` to the OG tombstone guard; ship frontend-dark-first; and carry security guardrails G2–G9 (blocklist-first fail-closed, mod/deleted never quarantine, no metadata leakage, block/erase clears overrides). Brigade prevention is better solved realm-side (weighted flagging / raised threshold).

## 6. Downstream
- **C.4** (mod console) consumes this: enrich the **bearer-gated** `GetFlaggedPostsResponse` (additive) with per-post override status if the console needs it — never the public `FeedPost`.
- Pre-existing, orthogonal note (not this PR): `GetModerationLog` emits the flagger address publicly (`feed_moderation_rpc.go`) — a retaliation/chill vector worth a separate look (the address is already public on-chain, but the API amplifies it).
