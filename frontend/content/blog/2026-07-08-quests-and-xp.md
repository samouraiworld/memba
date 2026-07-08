---
title: Quests and on-chain XP — rewards you can verify
date: 2026-07-08
description: The GnoBuilders program pays XP for real activity and settles it through an on-chain attestation realm, ranked on a public leaderboard. The product and the settlement path.
tags: memba, quests, gnobuilders, engineering
---

Points programs are easy to fake and easy to distrust. Memba's **GnoBuilders**
quests pay XP for real activity and back it with an **on-chain attestation
realm** — so the reward path is verifiable, not just something we assert.

## What you get (product)

Complete quests — connect a wallet, explore the app, take part in governance,
find the odd easter egg — and earn XP that ranks you on a public leaderboard.
Progress is per-wallet, and completing a quest surfaces a toast so the feedback
is immediate rather than silent. It's the on-ramp: quests teach the app by
rewarding you for using it.

## Under the hood (engineering scope)

Verified activity settles through an **attestation realm** on test13, which
records a signed voucher on-chain rather than trusting the browser. The public
leaderboard and XP totals you see are a **backend projection over that verified
activity** — the attestation realm is the settlement mechanism, not the table's
live data source (that path is still rolling out). The client tracks progress
offline-first (so it works before you're authenticated) and syncs to the backend
once you have a token, keyed to your wallet address so two wallets never share
progress.

Honesty about limits is part of the design: verifiers that aren't fully on-chain
yet are treated as such, and rewards that depend on a signature say so — we don't
dress up an optimistic counter as a settled one.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Start a
[quest](https://memba.samourai.app/test13/quests).
