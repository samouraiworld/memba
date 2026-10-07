---
title: Validator health that describes the present
date: 2026-09-13
updated: 2026-09-14
description: On gno.land mainnet, Memba's validator badges follow the live signing window, say why a validator is flagged, and show scores beside their inputs.
tags: memba, validators, engineering
---

On mainnet's first day, a validator page could say "Down" directly above a
strip of 100 perfectly signed blocks. Both figures were real; only one
described the present. Memba's validator view now reports what a validator is
doing now, and says why whenever it flags one.

## What you get (product)

The health badge follows the live signing window. When the recent blocks and a
long-window uptime average disagree, the live window wins and the badge names
the conflict, instead of contradicting the strip beside it. A handful of good
blocks does not count as a recovery, and an old incident ages out instead of
pinning a validator to Down for good. The home page's health panel needs
positive evidence before it says healthy: a monitoring outage reads as unknown.

On a phone, a Degraded or Down card states its reason as visible text, since a
touch screen cannot show a tooltip, and screen readers hear the health state
too. Percentages are rounded, and a missing value shows a dash rather than 0%.

Each validator's own page shows the monitoring service's 0–100 reliability
score for the last 24 hours, the week, the month and the year, always beside
what produced it: sign rate, missed blocks, downtime and incidents. A window
without data says "No data", never zero. The list does not rank validators by
score.

## Under the hood (engineering scope)

Scores come from gnomonitoring's scored validator report through a client with
a no-data guard: a window that carries neither signing nor failure evidence is
an absence of information, and an unreachable endpoint returns nothing rather
than an empty set. A second client reads gnomonitoring's chain-health view. It
replaced a browser-side parser for the node's `/dump_consensus_state` debug
endpoint that had never worked (it called `.find` on an object and swallowed
the error); retiring it also removed two polls that sent about 60 requests a
minute per open tab for nothing.

The roster no longer re-fetches a hundred immutable blocks every thirty
seconds: committed blocks are cached and only new heights are requested. The
Network tab's governance readiness panel computes fault tolerance with tm2's
integer quorum from the live voting powers, reads GovDAO membership, and offers
no button to act on either. Since 14 September, the page-size control has a
label for screen readers.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). See the
[validators on memba.club](https://memba.club/os/validators).
