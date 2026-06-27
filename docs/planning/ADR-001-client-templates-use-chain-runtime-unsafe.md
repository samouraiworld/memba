# ADR-001 — Client realm templates use `chain/runtime/unsafe`

**Status:** Accepted (2026-06-27)
**Context doc:** `CLIENT_DEPLOY_GNO_API_REGRESSION_AUDIT_AND_PLAN_2026-06-27.md`

## Context

test13's interrealm-v2 gno upgrade moved realm-introspection symbols
(`PreviousRealm`, `CurrentRealm`, `OriginSend`, `OriginCaller`) out of `chain/runtime`
into `chain/runtime/unsafe`, and added a `cur realm` parameter to `banker.NewBanker`.
Gno offers two ways for a realm to learn its caller:

1. **Crossing functions** — exported funcs are invoked with `cross(fn)(...)`; the realm
   reads the caller via the *safe* introspection API. This is the canonical interrealm model.
2. **`chain/runtime/unsafe`** — a pragmatic package exposing `PreviousRealm()` etc. directly,
   usable without full crossing ceremony.

Our **server-side deployed `_v2` realms** (candidature, escrow, agent, channels, badges,
reviews, tokenfactory, nft_market_v3_1) all use option (2) and are live on test13.

## Decision

The **frontend code-generation templates emit option (2)** — `chain/runtime/unsafe` —
mirroring the deployed `_v2` realms exactly.

## Rationale

- **Proven on-chain.** The `_v2` realms compile *and run* on test13; copying their exact
  pattern is the lowest-risk path to unbrick client-side deploys.
- **Minimal blast radius.** The fix is a symbol/import substitution, fully covered by the
  `gno`-backed compile gate (`templates.compile.test.ts`).
- Templates already carry the `cur realm` crossing signature on exported functions, so
  migrating to full crossing semantics later is incremental, not a rewrite.

## Consequences

- Generated user realms depend on `chain/runtime/unsafe`. If gno deprecates that package,
  the templates must migrate to full crossing semantics — the compile gate will flag it the
  moment it stops type-checking, so the failure mode is loud, not silent.
- "unsafe" here is a gno package name, not a security judgment: the realms still gate every
  mutating call on `unsafe.PreviousRealm().Address()` membership/admin checks.

## Alternatives considered

- **Full crossing semantics now** — rejected for this fix: larger change, no on-chain
  precedent in our codebase to copy, and not required to unbrick deploys. Revisit if gno
  pushes crossing as the only supported path.
