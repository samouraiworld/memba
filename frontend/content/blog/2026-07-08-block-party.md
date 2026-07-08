---
title: Block Party — a daily puzzle seeded by the chain
date: 2026-07-08
description: Block Party is a chain-seeded daily 2048 you can play without a wallet. Here's the product and the byte-identical TypeScript/Go engine that keeps the daily fair.
tags: memba, games, blockparty, engineering
---

Games are how a lot of people first touch a chain. Memba's first game, **Block
Party**, is a daily 2048 whose board is seeded by the chain — so everyone plays
the *same* daily puzzle, and no one can reroll for an easier one.

## What you get (product)

Play the **Daily** — a puzzle everyone shares that day — or **Practice** any
time. There's a leaderboard for the daily. Crucially, you can play fully
**without connecting a wallet**; connecting is optional and only matters when you
want to put a score on the board. The game is designed to be the low-friction
front door, not a wallet gate.

## Under the hood (engineering scope)

The daily seed is derived from a chain value, so the board is deterministic and
identical for every player that day. The move engine exists twice — once in
TypeScript (the browser) and once in Go (the backend) — and the two are
**byte-identical**, verified against shared test vectors. That parity is what
lets the backend trust a client's replay: it can re-run the exact same engine and
get the exact same result.

Because scoring is validated server-side (and, in the reward phase, gated per
submission by a signature), the leaderboard is *checked*, not merely claimed — we
don't call it "trustless," because it isn't; it's verified. The game ships dark
behind `VITE_ENABLE_GAME` / `BLOCKPARTY_ENABLED`, and bounded integer casts in
the engine are explicitly annotated so the security linter stays honest.

Block Party is the template: more wallet-optional, chain-seeded games are on the
way, all playable first and connectable second.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba).
