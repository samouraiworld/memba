---
title: Validators, with receipts
date: 2026-07-08
description: Memba's validator view shows voting power, uptime, and participation — plus community review stars from an on-chain reviews realm and a live consensus telemetry feed. The product and the data plumbing.
tags: memba, validators, engineering
---

Picking a validator usually means trusting a leaderboard you can't audit. Memba's
**validator view** shows the numbers *and* their sources — including community
reviews that live on-chain, not in a database we control.

## What you get (product)

The validator table shows voting power, uptime, and participation for the active
network. Each validator carries **community review stars** — with the latest
comments one hover away — and a canonical profile at `/validators/:address`. For
operators and the curious, a **hacker view** streams live consensus telemetry
when you want the raw feed instead of the summary.

## Under the hood (engineering scope)

Reviews are read from an on-chain **reviews realm**, keyed to the operator
address (not the signing key), so a review follows the validator you actually
delegate to. Review timestamps are block heights, resolved to dates via the
chain — dates you can independently verify, not server-stamped.

Telemetry is aggregated carefully: `/net_info` is node-local, and a single RPC
behind sentries sees only a partial peer set, so Memba unions several
well-connected nodes to reconstruct the real network topology. Validator monikers
and uptime come from the gnomonitoring API. The moniker/host edge cases that
plague naive validator pages (mainnet-host bugs, partial peer lists) are handled
explicitly rather than papered over — the goal is a table you can trust enough to
stake behind.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). See the
[validators](https://memba.samourai.app/test13/validators).
