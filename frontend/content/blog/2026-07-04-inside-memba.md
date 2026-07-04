---
title: Inside Memba — what's live on gno.land test13 today
date: 2026-07-04
description: A tour of Memba's shipped surface — multisig wallets, DAO governance, the marketplace, validators, and the on-chain directory — all running on gno.land test13.
tags: memba, features
---

Memba is a Gno-native multisig wallet and DAO governance app. Everything below
is live on [test13](https://memba.samourai.app/test13/) right now — not a
roadmap, a tour.

## Multisig, the Gno way

Create a shared wallet with your co-signers, propose transactions, sign with
[Adena](https://www.adena.app/), broadcast when the quorum is in. Every
signature is verified against the exact canonical sign-bytes the chain sees,
and the review card shows you the full recipient, the network, and an
irreversibility warning before anything moves.

## DAO governance

Spin up a DAO from a template, invite members, open proposals, vote, and read
the on-chain result — plus an AI analyst that reads proposals from ten
perspectives and grades DAO health. Candidature flows let outsiders apply and
members vote them in.

## One marketplace, fees to the DAO

NFTs (launchpad, collections, offers), token OTC swaps, and service escrow run
through a single marketplace whose per-lane fees settle on-chain to the Memba
DAO treasury. The NFT engine is the config-reading v3.1 — the fee spine is a
realm, not a promise.

## Validators, with receipts

The validator table shows voting power, uptime, participation, and — new this
week — community review stars from an on-chain reviews realm, with the latest
comments one hover away. A hacker view streams live consensus telemetry when
you want the raw feed.

## A directory that reads the chain

Packages, DAOs, realms, tokens, and users — with the actual on-chain source
for every realm, fetched straight from the chain (`vm/qfile`), not scraped
from a website. Read the contract before you trust it.

## Quests and on-chain XP

The GnoBuilders program pays XP for real activity, settles it cryptographically
on-chain through an attestation realm, and ranks everyone on a public
leaderboard.

---

Memba is built by [Samourai Coop](https://samourai.world) and developed in the
open at [github.com/samouraiworld/memba](https://github.com/samouraiworld/memba).
New here? Start at the [directory](https://memba.samourai.app/test13/directory)
and read some source.
