---
title: The Directory — one place to discover and read gno.land
date: 2026-07-08
description: How Memba's Directory unifies DAOs, tokens, packages, realms, users, and a read-only realm Explorer into a single deep-linkable hub — and how it reads the chain directly.
tags: memba, directory, explorer, engineering
---

Discovery on a smart-contract chain has a trust problem: most explorers show you
a scraped, cached view of what a contract *claims* to be. Memba's **Directory**
takes the opposite stance — everything it shows is read straight from gno.land,
and you can open the source of any realm before you trust it.

## What you get (product)

The Directory is a single tabbed hub:

- **Packages, DAOs, Realms, Tokens, Users** — browse the on-chain namespace,
  filtered and searchable across every tab at once.
- **GovDAO & Leaderboard** — governance activity and the XP leaderboard in the
  same place.
- **Explorer** — the deep-dive: paste any realm path and read its live
  `Render()` output, its full **source**, and its exported **functions**.

Previously the Explorer was a separate feature with its own menu entry. As of
this release it's a tab inside the Directory, so discovery is one coherent
flow — *browse* (find a realm) → *deep-dive* (read it) — under one nav item at
`/directory`. Old `/explorer/...` links still work; they redirect in and keep
your realm path.

## Under the hood (engineering scope)

The Explorer is **read-only by construction**. It issues exactly three ABCI
queries — `vm/qrender`, `vm/qfile`, and `vm/qfuncs` — and never `vm/qeval`, so
there is no execution surface to abuse (SEC-01). Source is fetched from the chain
via `vm/qfile` first, with a gnoweb fallback only if the RPC can't be reached —
so what you read is what the chain returns, not content scraped from a website.

The active realm rides the URL as shareable state
(`/directory?tab=explorer&realm=r/x/y`), parsed and validated by a small pure
schema (`directoryUrl.ts`) that caps input length and only emits the realm param
on the Explorer tab. Rendered Markdown is sanitized with DOMPurify before it
touches the DOM. The whole viewer is gated behind `VITE_ENABLE_EXPLORER`, so it
ships dark until enabled — a deep-link to the tab simply falls back to the
default when the flag is off.

Cross-links across the app (a realm card, a DAO drawer, the App Store's "read
the source" button) all route through one helper so the link target and the
viewer agree on path normalization — no drift between "where the link points"
and "what the viewer expects."

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Start
at the [Directory](https://memba.samourai.app/test13/directory) and read some
source.
