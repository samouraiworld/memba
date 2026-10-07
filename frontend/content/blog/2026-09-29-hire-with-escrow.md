---
title: Hire with milestone escrow on mainnet
date: 2026-09-29
updated: 2026-10-06
description: Hire someone on gno.land mainnet with escrow_v4: milestones funded into a realm, a shareable contract page, and every limit shown before you sign.
tags: memba, marketplace, escrow, engineering
---

Paying for work on chain usually means trusting someone to hold the money. On
memba.club, the Market hires through `escrow_v4`, a realm on gno.land mainnet:
each milestone is funded into the contract, and the client releases it once the
work is delivered.

## What you get (product)

Hire someone you already know by address: the freelancer's address
(checksum-checked), a title, a description and milestones in GNOT, all checked
exactly as the realm checks them. The form spells out what the contract
commits: escrow per milestone, the platform fee taken at release, the storage
deposit refunded when the contract is archived, and at most five open
contracts per client. Or start from the one curated listing, Samourai Coop dev
services, quoted per project: its Hire button opens the same form with the
address locked.

Each contract has its own shareable page. It shows both parties in full, every
milestone with its status, amount and deadline, and only the calls your wallet
can make in that state: the client funds, releases, cancels and archives; the
freelancer marks a milestone delivered; and past a deadline, anyone can trigger
the refund or expiry the contract sets. A freelancer also finds the contracts
that name them, located through the indexer and read back from the realm before
they are shown. Since 6 October, Memba OS describes Market for what it is on
mainnet: hiring with milestone escrow.

## Under the hood (engineering scope)

`escrow_v4` refunds the storage deposit when a client archives a completed or
canceled contract, and has a bounded pause. While it is paused, funding is refused and Hire stays disabled, and the
page states before signing the block at which its other calls reopen, about seven days into the pause. Memba
parses the realm's JSON views strictly: an unexpected shape is refused, not
shown.

Every escrow call carries a storage deposit cap and a gas limit measured
against the deployed realm: contract creation scales with its text and
milestones, and the other calls cap their deposit at 0.2 GNOT. The builders
refuse text the realm would strip, so the stored text is the signed text, and
amounts must be whole ugnot. Only funding sends coins, and it sends exactly
that milestone's amount. Each call is sent once; when its outcome is unknown,
the page offers nothing until the contract has been read again.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Open
the [Market on memba.club](https://memba.club/os/market).
