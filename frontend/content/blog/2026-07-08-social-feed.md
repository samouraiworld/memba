---
title: A social feed that unfurls the chain
date: 2026-07-08
description: Memba's feed turns on-chain objects — proposals, tokens, validators — into rich, typed previews pulled from the chain. The product and the indexer behind it.
tags: memba, feed, engineering
---

A crypto social feed is usually just Web2 posts with wallet avatars. Memba's
**feed** does the one thing a Gno-native feed can: when you drop an on-chain
object into a post, it *unfurls* into a live, typed preview.

## What you get (product)

Post and reply. Paste a proposal, a token, or a validator and the feed
renders a rich card for it — pulled from the chain, not a link scraper. A
two-pane desktop rail keeps trending and context beside the thread. Reactions
and rich link previews are built and ship behind their own flags, lighting up
as the realm layer lands, and there's a serving-blocklist lever for legal and
safety operations. Every post carries an honest permanence disclosure —
on a public chain, "delete" is not what people assume, and the UI says so.

## Under the hood (engineering scope)

The differentiator is **typed on-chain unfurls**: the feed recognizes gno.land
object references and resolves them through read-only queries into structured
previews, rather than fetching an arbitrary URL. External link previews are
guarded against SSRF — the backend, not the browser, fetches them, and only
after validating the target.

The reaction subsystem — realm entrypoints, an indexer projection, and the UI —
is built end-to-end and ships dark, waiting on the next feed-realm deploy that
carries the reaction entrypoints on-chain; the indexer tails feed events and
reconstructs counts with reorg-safety (it stays a few blocks behind the chain
tip). Posts carry block-time timestamps so ordering matches the chain, not the
server clock. The whole surface is gated behind `VITE_ENABLE_FEED` — an ordinary
flag, no funds move through it.

Everything landed test-first and flag-gated, so the feed can mature in
production behind the flag without exposing an unfinished surface.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba).
