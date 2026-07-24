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
| **Blocklisted** | Illegal / must-not-serve content, suppressed on every surface. | Operator | Never |

## Principles

1. **Community flags are a label, not a verdict.** Anyone can flag; enough flags
   auto-hide a post from discovery, but a wrongful "brigade" is reversible by an
   operator with a single action — it is not an expensive, irreversible takedown.
2. **Illegal content is blocklisted first.** Genuinely illegal or must-not-serve
   content is hard-suppressed on every surface and is never quarantined or restored.
3. **Nothing is silently deleted.** Every flag, auto-hide, and moderator action is
   emitted as an on-chain event and mirrored into the public moderation log. This
   page proves the moderation that has happened; it is not curated by us.
4. **Flaggers are not doxxed here.** The public log records *that* a post was
   community-flagged, not *who* flagged it (to avoid retaliation and preserve the
   incentive to flag). Moderator actions, which carry accountability, do show the
   acting address.
5. **The chain is permanent.** Because bodies live on-chain forever, suppression is
   a serving-layer decision — and that is the limit of what any operator, including
   us, can promise. See **Erasure requests** below for exactly what we can and
   cannot do.

## Erasure requests — what we can and cannot do

We state this precisely rather than generally, because the difference matters.

**What we do on a valid erasure request:** we **blocklist** the post. That
permanently stops it being served through every Memba surface — timeline, thread,
profile, permalink, search, link previews and the public API. The blocklist is
authoritative and operator-only: it is not derived from chain events, no on-chain
activity can reverse it, and it **survives a full rebuild of our index**.

**What we cannot do:**

- **We cannot remove the body from the chain.** The Gno blockchain is public,
  permanent and outside our control. Anyone running a node, block explorer or
  third-party indexer retains the content regardless of what we do. This policy
  covers **Memba's own serving infrastructure only**.
- **We do not yet scrub our internal raw-event store.** Alongside the served
  index, we retain the raw on-chain events we ingested, which include post
  bodies. Blocklisting stops all serving, but the body remains in that internal
  store. Scrubbing it is planned work, not a capability we have today, and we
  would rather say so than imply otherwise.

If you need content erased, or believe a post was wrongly hidden or removed,
email **security@samourai.coop** — the same monitored inbox as our security
disclosures. Wrongful auto-hides are restored quickly. Blocklist and erasure
decisions are made by the operators against this policy.

## Old tombstones

Removed and blocklisted posts leave a tombstone so threads keep their shape. The
feed realm supports permanently purging old tombstones on-chain, but **Memba does
not currently operate that sweep in production** — tombstones persist until it is.
