---
title: DAO governance, with an AI analyst reading every proposal
date: 2026-07-08
description: Spin up a DAO, run candidature, vote on-chain — and get a multi-perspective AI read on every proposal and the DAO's health. The product and the realms behind Memba governance.
tags: memba, dao, governance, engineering
---

Governance tools usually stop at "here's a proposal, click vote." Memba adds the
part that actually helps people decide: an **AI analyst** that reads each
proposal from up to ten angles and grades the DAO's health — free, and on by default.

## What you get (product)

Create a DAO from a template, invite members, open proposals, vote, and read the
on-chain result. **Candidature** lets outsiders apply and existing members vote
them in, so a DAO can grow without handing out keys. On every proposal, the
analyst summarizes intent, flags risks, and offers up to ten independent perspectives;
it also scores overall DAO health so members get signal, not just a vote count.

## Under the hood (engineering scope)

DAOs are backed by Memba's governance realms (the `_v2` set deployed on test13
under interrealm-v2), built on gnodaokit. Proposals, votes, and results are
on-chain; the app reads them via `vm/qrender` and renders the live state, never a
cached copy.

The analyst runs **backend-side across free-tier LLMs** — the API keys never
reach the client — and caches results with a short TTL so repeated reads are
cheap. Governance actions that touch funds are treated with care: treasury
spending stays behind a kill-switch until the on-chain banker path is fully
enforced, so the UI never invites a deposit into a path that can't yet pay out.
That caution is deliberate — a governance app that loses treasury funds has
failed at its one job.

---

Built by [Samourai Coop](https://samourai.world), in the open at
[github.com/samouraiworld/memba](https://github.com/samouraiworld/memba). Browse
DAOs in the [Directory](https://memba.samourai.app/test13/directory).
