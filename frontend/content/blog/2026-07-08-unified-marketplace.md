---
title: One Marketplace, fees to the DAO
date: 2026-07-08
description: How Memba runs NFTs, services, and token OTC as tabs in a single marketplace whose per-lane fees settle on-chain to the DAO treasury — and how the lanes gate themselves.
tags: memba, marketplace, nft, engineering
---

Most apps bolt on a marketplace as a separate destination per asset type — an
NFT page here, a services page there. Memba runs them as **lanes in one
marketplace**, so there's a single place to buy and sell, and a single fee spine
that funds the DAO.

## What you get (product)

`/marketplace` is one page with tabs:

- **NFTs** — a launchpad, collections, and offers, with creator royalties and
  provenance enforced on-chain.
- **Services** — hire talent with milestone escrow; funds release only when work
  is accepted.
- **Tokens** — peer-to-peer OTC swaps that settle atomically, no custody.

Each lane has its own hero and its own on-chain guarantees — but they share one
shell, one search, and one menu entry. There's no separate "NFT" or "Services"
item cluttering the nav; they're tabs. Old `/nft` and `/services` links redirect
into the right tab.

## Under the hood (engineering scope)

A **lane appears only when it's live** — meaning both its feature flag *and* its
backing realm are valid on the active network. A gated lane is unreachable via
its tab *and* a direct URL, so a half-deployed money path can't leak into
production. The lane set is data (`marketplace/lanes.ts`); the shell renders
whatever is live.

Fees are the point. Each lane's fee settles **on-chain to the Memba DAO
treasury** — the NFT engine is the config-reading v3.1 build, so the fee route is
a realm, not a promise. The token lane runs through an on-chain OTC engine with
atomic settlement; the service lane through milestone escrow with an on-chain
dispute freeze.

Safety is enforced at build time: flags whose on-chain enforcement is incomplete
live in a `SAFETY_GATED_FLAGS` list, and the production build **fails** if any of
them is set to `true` — from any source, including the deploy dashboard. So a
lane can't ship enabled before its money path is verified.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba).
