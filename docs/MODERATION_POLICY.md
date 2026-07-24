# Memba Feed — Moderation Policy

_Last updated: 2026-07-24._

The Memba social feed is an **open-write, on-chain** feed: every post's body is
recorded permanently in the `memba_feed_v1` realm on Gno. Moderation therefore
cannot "delete" anything from the chain — it can only change what the app
**serves**. Our commitment is **disclosed labeling, not silent deletion**: when
content is suppressed, the fact of that action is recorded in a public,
tamper-evident log (shown at `/feed/transparency`).

## What can happen to a post

| State | What it means | Who triggers it | Body served? |
|---|---|---|---|
| **Live** | Normal, visible everywhere. | — | Yes |
| **Flag-hidden** | The community flagged it past a threshold, so it's auto-hidden from discovery pending review. | Community (on-chain flags) | No (hidden) |
| **Restored** | An operator reviewed a flag-hidden post and vouched for it; it's visible again. | Operator (`override_serve`) | Yes |
| **Author-deleted** | The author removed it; the body is wiped from the projection. | Author | No (tombstone) |
| **Moderator-removed** | A moderator removed it on-chain; the body is wiped. | Moderator (on-chain) | No (tombstone) |
| **Blocklisted** | Illegal / must-not-serve content, suppressed on every read path that serves our index. | Operator | Never (see *Erasure requests* for the two chain-relay endpoints) |

## Principles

1. **Community flags are a label, not a verdict.** Anyone can flag; enough flags
   auto-hide a post from discovery, but a wrongful "brigade" is reversible by an
   operator with a single action — it is not an expensive, irreversible takedown.
2. **Illegal content is blocklisted first.** Genuinely illegal or must-not-serve
   content is hard-suppressed on every surface and is never quarantined or restored.
3. **Nothing is silently deleted.** Every flag, auto-hide, and moderator action is
   emitted as an on-chain event and mirrored into the public moderation log. This
   page proves the moderation that has happened; it is not curated by us.
4. **This page does not display who flagged a post** — only *that* it was
   community-flagged (to avoid retaliation and preserve the incentive to flag).
   Moderator actions, which carry accountability, do show the acting address.
   Be aware this is a display choice, not anonymity: flagging is an on-chain
   action, so the flagger's address is already public in the `PostFlagged` event,
   and our public moderation API relays it. Do not flag expecting to be
   unidentifiable.
5. **The chain's history is permanent.** Because every body is recorded in the
   block that created it, most of what we can do is a serving-layer decision —
   plus removing the body from the contract's current state. That is the limit of
   what any operator, including us, can promise. See **Erasure requests** below
   for exactly what we can and cannot do.

## Erasure requests — what we can and cannot do

We state this precisely rather than generally, because the difference matters.

**What we do on a valid erasure request:**

1. **We blocklist the post.** Every Memba read path that serves our indexed feed
   — timeline, thread, profile, permalink and link previews — stops serving it.
   The blocklist is authoritative and operator-only: it is not derived from chain
   events, no on-chain activity can reverse it, it **survives a full rebuild of
   our index**, and it stays in force until we ourselves lift it.
2. **We remove the body from the feed contract's current state**, via an on-chain
   moderator removal, so the realm itself stops serving it too.

**What we cannot do:**

- **We cannot erase the body from the chain's history.** Every post body is
  permanently recorded in the block that created it. Anyone running a node, block
  explorer or third-party indexer keeps that copy regardless of what we do. Step
  2 changes the contract's current state, not the history behind it.
- **Two of our endpoints relay the chain directly, and a blocklist cannot filter
  them.** `/api/render` returns a realm's own `Render()` output, and
  `/api/indexer` passes queries through to a public transaction indexer. They
  serve what the chain still holds rather than our index — so until step 2 is
  executed, a blocklisted body can still be read through them. We would rather
  document that than let "blocklisted" imply a completeness it does not have.
- **We do not yet scrub the stored copies.** Blocklisting suppresses a post at
  read time rather than deleting it, so the body remains **both in our served
  index and in the raw-event ledger** of ingested chain events. Scrubbing both is
  planned work, not a capability we have today, and we would rather say so than
  imply otherwise.

If you need content erased, or believe a post was wrongly hidden or removed,
email **contact@samourai.coop**. Wrongful auto-hides are restored quickly.
Blocklist and erasure decisions are made by the operators against this policy.

(Security vulnerabilities go to **security@samourai.coop** instead — see
[`SECURITY.md`](../SECURITY.md).)

## Old tombstones

Removed and blocklisted posts leave a tombstone so threads keep their shape. The
feed realm supports permanently purging old tombstones on-chain, but **Memba does
not currently operate that sweep in production** — tombstones persist until it is.
