---
title: Gno core pulse — what changed upstream and what it means for builders
date: 2026-07-04
description: A builder's digest of recent gnolang/gno changes — interrealm-v2 in production on test13, the NewBanker hardening, realm.Sub on the horizon, and stricter package deploys.
tags: gno-core, network
---

We track [gnolang/gno](https://github.com/gnolang/gno) commit-by-commit,
because Memba's realms live or die by it. Here's the recent window that
matters, from a builder's seat.

## Interrealm-v2 is the production reality

test13 launched with the interrealm-v2 model — `cross(cur)` calls,
`cur.Previous()` caller resolution, the `chain`/`runtime`/`unsafe` stdlib
split. Every Memba realm on test13 runs it, and our deploy pipeline
compile-gates client templates against a pinned interrealm-v2 toolchain so
drift fails in CI, not on-chain.

## NewBanker closed a caller-drain hole

Upstream now requires `NewBanker` to be constructed from a realm where
`IsCurrent()` is true — building one from `cur.Previous()` panics. Before the
fix, a crossing function could build a banker and move the *caller's* coins.
If you write realms that touch native coins: construct bankers with `cur`,
never with the previous realm, and treat any origin-send entrypoint as
user-call-only.

## realm.Sub() is coming — not here yet

Sub-realm identity tokens (`realm.Sub(subpath)`) landed on master with a tight
subpath grammar and total caps. test13 predates the merge, so nothing on the
current network can use it yet — but it's a genuine design lever for anything
that wants per-item derived addresses (think: one address per market pair or
per listing) without deploying a realm per item. We're planning around it,
not on it.

## AddPackage got stricter

Packages with no production `.gno` files are now rejected at `AddPackage`.
Deps-only or test-only directories that used to slip through won't on
post-upgrade networks. If your deploy tooling ships template or dependency
packages, make sure each carries at least one real source file.

## Event attributes now have teeth

`chain.emit` panics on over-cap attribute values instead of silently
truncating (with the cap itself raised to 4096). State-breaking for any realm
that emits unbounded user-controlled strings — cap what you emit at the realm
boundary before you redeploy on a post-change network.

---

Everything above is tracked with commit references in our
[breaking-changes assessment](https://github.com/samouraiworld/memba/blob/main/docs/planning/GNO_CORE_BREAKING_CHANGES.md),
fact-checked against the gno repo before it lands in the doc.
