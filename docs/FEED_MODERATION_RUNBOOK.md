# Feed Moderation Runbook

Operational procedure for suppressing, restoring and auditing feed content.
Public policy (what we promise users): [`MODERATION_POLICY.md`](MODERATION_POLICY.md).

> **⚠️ Read the rollback warning in §5 before you touch `VITE_ENABLE_FEED`.**
> The obvious rollback disables the moderation console and the public
> transparency page at exactly the moment you need them.

---

## 1. The endpoint

```
POST /api/feed/moderation
Authorization: Bearer <FEED_MODERATION_BEARER>
Content-Type: application/json

{"post_id": 123, "action": "block", "reason": "why", "by": "who"}
```

- **`post_id` is a JSON *number*, not a string.** The decoder is `uint64`; a
  quoted `"123"` is rejected as a bad request. (This exact mistake shipped once
  and made every console action 400 — see #998.)
- **If `FEED_MODERATION_BEARER` is unset the endpoint returns `404`, not `401`.**
  A 404 here means *the capability is switched off*, not *wrong URL*. This is
  fail-closed by design: no bearer ⇒ no takedown capability at all.
- `reason` and `by` are free text and are stored. Keep them factual — they are
  operator notes retained in the database.

### Actions — exact names

| Action | Effect |
|---|---|
| `block` | Add to the serving blocklist. Hard suppression honored by every read path. **Atomically clears any serving override**, so a later `unblock` can't resurrect the post as override-visible. |
| `unblock` | Remove from the blocklist. |
| `override_serve` | Force a wrongly flag-brigaded post back to full visibility. |
| `clear_override` | Revert an `override_serve`. |

> The action is **`override_serve`**. Some planning docs call it `serve_override`
> — that spelling returns `400`. Copy from this runbook, not from a plan.

`override_serve` returns **409** if the post does not exist, is a deleted
tombstone, or is blocklisted. That is deliberate: you cannot vouch for content
you cannot see, and a serve-override must never re-serve must-not-serve content.
`block` stays pre-emptive (suppression is the safe direction).

---

## 2. Suppressing a post (the common case)

```bash
curl -sS -X POST "$MEMBA_API/api/feed/moderation" \
  -H "Authorization: Bearer $FEED_MODERATION_BEARER" \
  -H 'Content-Type: application/json' \
  -d '{"post_id": 123, "action": "block", "reason": "illegal content", "by": "ops:<name>"}'
```

**Rule: blocklist first, classify second.** For anything plausibly illegal,
`block` immediately, then assess. Illegal content is never quarantined,
never serve-overridden, and never restored.

---

## 3. Restoring a flag-brigaded post

A post auto-hidden by community flags (not by a moderator) is reversible with one
call — no multisig, no ceremony:

```bash
curl -sS -X POST "$MEMBA_API/api/feed/moderation" \
  -H "Authorization: Bearer $FEED_MODERATION_BEARER" \
  -H 'Content-Type: application/json' \
  -d '{"post_id": 123, "action": "override_serve", "reason": "reviewed, brigade", "by": "ops:<name>"}'
```

Use the console at `/feed/mod` for the queue view; it calls this same endpoint
with an operator-pasted bearer held in `sessionStorage` (never `localStorage`,
never baked into the build).

---

## 4. The drill (do this when the bearer is first set, and after any rotation)

The growth gate counts this item as done at **drill**, not at merge.

1. Pick a disposable live post; note its `post_id`.
2. `block` it.
3. Verify the body is gone from **every** read path:
   - `GetFeedTimeline` (main timeline)
   - `GetUserFeed` (author profile)
   - `GetFeedThread` (thread view, including as a *reply* inside someone else's thread)
   - `GetFlaggedPosts` (moderation queue)
   - `GetReplyNotifications`
   - `GetFeedStats` (counts)
   - The permalink page and its **link-preview / OG edge function** — this one is
     served from Netlify's edge with a 60s `private` cache, so allow up to a
     minute before concluding it leaked.
4. `unblock` it. Verify it returns on all of the above.
5. Record the date, who ran it, and anything surprising, in §7 below.

**A drill that only checks the timeline is not a drill.** The thread-as-reply and
OG-preview paths are where a leak actually hides.

---

## 5. ⚠️ Rollback coupling — read before disabling the feed

The documented feed rollback is "flip `VITE_ENABLE_FEED` back to false". Be aware
of what that also does:

**`/feed/mod` (the moderation console) and `/feed/transparency` (the public
audit log) are both mounted inside `<FeedGate>`.** Turning the flag off removes
both — so the rollback you would reach for during a content incident is the same
switch that takes away your console and your public accountability page.

If you need to stop serving the feed during an incident:

- **Prefer targeted `block` calls.** They are surgical, instant, honored
  everywhere, and leave the console and transparency page working.
- **Only flip `VITE_ENABLE_FEED` off** for a non-content emergency (a rendering
  or performance failure). If you do, moderate via `curl` against the endpoint —
  it is backend-side and keeps working with the frontend flag off.

---

## 6. What is *not* wired

Do not promise these; they do not run today.

- **No erasure / raw-event scrub.** `block` stops all serving and survives an
  index rebuild, but the body remains in the raw-event store. See
  `MODERATION_POLICY.md` § "Erasure requests".
- **No tombstone sweep in production.** `cmd/activitybot` implements it, but the
  production image builds only `./cmd/memba` and no Fly process or workflow runs
  it.
- **No abuse alert.** The `/metrics` gauges exist (bearer-gated); the alert rule
  is not wired into gnomonitoring. Rule + scrape config are in PR #1002's body.

---

## 7. Drill log

| Date | By | Result | Notes |
|---|---|---|---|
| _(not yet run — see §4)_ | | | |
