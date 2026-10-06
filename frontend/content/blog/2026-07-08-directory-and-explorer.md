---
title: The Directory — one place to discover and read gno.land
date: 2026-07-08
updated: 2026-09-28
description: How Memba's Directory brings DAOs, tokens, packages, realms, and users together while labeling curated listings, verified reads, and source-viewer limits.
tags: memba, directory, explorer, engineering
---

Discovery on a smart-contract chain has a trust problem: a listing can be
mistaken for proof that its target was read and verified. Memba's **Directory**
labels curated namespace listings separately from chain-verified reads, and
lets you inspect source before you trust a package or realm.

## What you get (product)

The Directory is a single tabbed hub:

- **Packages, DAOs, Realms, Tokens, Users** — browse curated listings and
  verified reads, with their limits and provenance shown in each tab.
- **GovDAO & Leaderboard** — governance activity and the XP leaderboard in the
  same place.
- **Source viewer** — open a package or realm card to read chain-backed source.
  The deeper Explorer tab for `Render()`, source, and exported functions remains
  feature gated in the public beta.

Previously the Explorer was a separate feature with its own menu entry. Its
deep-dive tab now lives inside the Directory when enabled; existing
`/explorer/...` links redirect there and keep the realm path. In the public
beta, the Directory's listing and source drawers remain available while that
tab is off.

## Under the hood (engineering scope)

The gated Explorer tab is **read-only by construction**. It uses the ABCI
query types `vm/qrender`, `vm/qfile`, and `vm/qfuncs`, never `vm/qeval`, so
there is no execution surface to abuse (SEC-01). Source is fetched through
chain-verified `vm/qfile` reads. If those reads fail, the source is unavailable;
the viewer does not substitute an unverified gnoweb copy.

The active realm rides the URL as shareable state
(`/directory?tab=explorer&realm=r/x/y`), parsed and validated by a small pure
schema (`directoryUrl.ts`) that caps input length and only emits the realm param
on the Explorer tab. Rendered Markdown is sanitized with DOMPurify before it
touches the DOM. The dedicated tab is gated behind `VITE_ENABLE_EXPLORER`; a
deep-link to that tab falls back to the default when the flag is off.

Cross-links across the app (a realm card, a DAO drawer, the App Store's "read
the source" button) all route through one helper so the link target and the
viewer agree on path normalization — no drift between "where the link points"
and "what the viewer expects."

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Start
at the [mainnet Directory](https://memba.club/mainnet/directory) and
read some source.
