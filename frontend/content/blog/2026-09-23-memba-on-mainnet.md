---
title: Memba moves to gno.land mainnet
date: 2026-09-23
updated: 2026-10-01
description: Memba 7.7.0 runs on gno.land mainnet: wave-1 realms, backend and indexers moved, mainnet @usernames, and Block Party's daily board seeded from a mainnet block.
tags: memba, mainnet, release
---

Memba 7.7.0 runs on gno.land mainnet, `gnoland-1`. Mainnet launched on 12
September and became Memba's default network on the 17th; on 23 September
Memba's own realms, its backend and its indexers followed.

## What you get (product)

The first wave of Memba realms is published on `gnoland-1` under the samcrew
namespace. The App Store, reviews, feedback, badges and the social feed run
there, and quest attestation followed the next day. Old links to the retired
Pearl testnet open the same page on mainnet with a one-time notice, and a saved
Pearl choice opens gno.land.

From 24 September, usernames work the mainnet way. Register goes through `r/sys/namereg/v0`, the
public registrar, with its `nym-` name format and the exact price read from the
realm. A `/u/<name>` link resolves through the registry's `ResolveName`, and
says so when the registry cannot be reached instead of claiming the user does
not exist. The home snapshot reports indexer progress and a featured DAO only
when they belong to the current chain.

The games came along. Space Invaders ends a run on a results card (score, wave,
accuracy, best chain) with one-tap sharing. Block Party Daily saves your run as
you play, counts down to the next board at 00:00 UTC, and keeps Undo for
Practice only.

## Under the hood (engineering scope)

The backend and indexer default to mainnet: generic reads use `rpc.gno.land`,
the home snapshot, feed and pollers use Samourai's own mainnet node, and recent
activity and address history come from the mainnet tx-indexer. Block Party's
daily board is seeded from a `gnoland-1` block read from a single node whose
chain identity is checked, and a public verifier lets anyone recompute it.

Signing surfaces were hardened first. Confirmations show every address in
full, reveal invisible and text-direction characters as `[U+XXXX]` markers, and
refuse a DAO call whose storage deposit cap exceeds 10 GNOT unless you approve
that exact amount. The quest voucher key signs only for the chain it was made
for, since the attestation message carries no chain id, and each attestation
sends a 1.6 GNOT deposit cap with a 50M gas limit, about twice the most it was measured to use.

A new wallet's first sign-in completes on mainnet. On 23 September, activation
went through gno.land's `r/demo/profile` realm.

**Updated 1 October.** Memba now activates a fresh address by sending 1 ugnot
to itself.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Open
Memba on mainnet at [memba.club](https://memba.club).
