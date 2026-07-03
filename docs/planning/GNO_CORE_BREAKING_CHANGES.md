# Gno Core PRs — Breaking Change Impact Assessment

> **Date:** 2026-07-03 (re-baselined; originally 2026-03-30) · **Memba:** v7.2.x · **Status:** re-baselined per the verified audit plan §5 ([MEMBA_VERIFIED_AUDIT_AND_AAA_PLAN_2026-07-01.md](MEMBA_VERIFIED_AUDIT_AND_AAA_PLAN_2026-07-01.md))
>
> **2026-06-24 update:** the NFT-relevant upstream PRs (#5747 / #5792 / #5745) and a chain-feature matrix (test13 / master / gnoland1.1) are tracked in [GNO_CORE_COMPAT.md § 2026-06-24](../GNO_CORE_COMPAT.md#2026-06-24--nft-relevant-upstream-prs--chain-feature-matrix). Mainnet is gated on gnoland1 upgrading to ≥ #5669 (interrealm-v2 Phase 3).
>
> **2026-07-03 re-baseline:** added the event-attribute rows (#5857 / #5858) and marked the interrealm-v2 stdlib migration ✅ COMPLETED. The original 2026-03-30 boards2/govdao matrix is retained below for tracking.
>
> **2026-07-03 (W5.6) upstream sweep:** post-test13-go-live window (Jun 16 → Jul 3, master `dfe49509f`) reviewed commit-by-commit — see [Upstream sweep](#upstream-sweep-jun-16--jul-3-2026) below. **No breaking changes for realms already deployed on test13**; three forward-looking rules for NEW realm code.
>
> Migration playbook: [GNO_CORE_COMPAT.md](../GNO_CORE_COMPAT.md)

## Interrealm-v2 stdlib migration — ✅ COMPLETED

The interrealm-v2 stdlib move (`chain`/`runtime`/`unsafe` symbols, `NewBanker(+cur)`,
`cross(cur)`) has **landed and Memba is migrated**: all deployed Memba realms on test13
run interrealm-v2 (`_v2` / `v3_1` set), `samcrew-deployer` is coherent with them, and
generated client templates are compile-gated in CI against a pinned interrealm-v2 gno
toolchain (`7b2888c3b`, `.github/workflows/gno-test.yml`, `REQUIRE_GNO=1`). No further
action for deployed realms. Residual (tracked in the audit plan, not here): the
deprecated v1 realms still on the old API are quarantined, not redeployed.

## Upstream sweep (Jun 16 → Jul 3, 2026)

Window: test13 go-live → master `dfe49509f`, reviewed commit-by-commit during Program
Compound planning (five-lens review, 2026-07-03). Verdict: **zero breaking changes for
the deployed test13 realm set.** Three items bind FUTURE code:

| Upstream | Change | Memba rule / impact |
|----------|--------|---------------------|
| `7cb5a01e9` (Jul 2) | **`NewBanker(RealmSend/RealmIssue)` now requires a realm with `IsCurrent()==true`** — constructing one from `cur.Previous()` panics (closes a caller-drain hole: a crossing function could otherwise build a banker and send the *caller's* coins) | **Standing rule for every future banker-using realm** (DAO-v2 treasury W8.1, app-store fee path, wugnot fallback, AMM): construct bankers with `cur`, never `cur.Previous()`. In-house precedent: `memba_token_otc_v1` (`otc.gno:194`). Deployed realms already comply. |
| `cf93ef5f7` + `4b5c7be93` (Jul 1–2) | **`realm.Sub(subpath)`** sub-realm identity tokens (tight subpath grammar, total cap) | **Not on test13** (chain genesis predates the merge; arrives at the next network upgrade). Design lever only — per-pair / per-listing derived addresses in the roadmap's Part 4 annexes; never a dependency. |
| `52ba34b78` (Jul 1) | **`AddPackage` rejects packages with no production `.gno` files** | Binds deploys to post-upgrade networks: every template/deps dir must ship ≥1 non-test `.gno`. samcrew-deployer templates comply today; the pinned-gno compile gate is the tripwire. |
| `9a6c4ef5a` · `084554b8b` · `349755959` | mempackage prod/test blob split · `PreprocessGasPerByte` default fix · `go/types` GoVersion pin | Transparent to realm code — no action. |

## Priority Matrix

| Prio | PR | Risk | Effort | When to act |
|------|-----|------|--------|-------------|
| 🔴 P0 | [#5858](https://github.com/gnolang/gno/pull/5858) `chain.emit` hard-caps attr values → panic | MED (state-breaking, forward-looking) | 1-2h | Before any mainnet / post-#5858-network redeploy |
| 🟡 P1 | [#5857](https://github.com/gnolang/gno/pull/5857) `MaxEventAttrLen` 1024→4096 | LOW (config; pairs with #5858) | 0 | Monitor |
| 🔴 P0 | [#5037](https://github.com/gnolang/gno/pull/5037) boards2 safe functions + `hub` sub-realm | HIGH | 2-4h | When merged |
| 🔴 P0 | [#5222](https://github.com/gnolang/gno/pull/5222) govdao T1 multisig rewiring | MED-HIGH | 0-4h | When merged |
| 🟡 P1 | [#5139](https://github.com/gnolang/gno/pull/5139) boards2 members via GovDAO proposals | MED | 0-1h | When deployed |
| 🟡 P1 | [#5250](https://github.com/gnolang/gno/pull/5250) betanet config | MED | 1-2h | Betanet launch |
| 🟢 P2 | [#5244](https://github.com/gnolang/gno/pull/5244) remove ownable from r/sys/names | LOW | 0 | Monitor |
| 🟢 P2 | [#5039](https://github.com/gnolang/gno/pull/5039) realm.SentCoins() | NONE | 0 | Future feature |
| 🟢 P2 | [#5217](https://github.com/gnolang/gno/pull/5217) gas metering fix | LOW | 0 | Monitor |

## Memba Integration Surfaces at Risk

| Surface | Key files | What could break |
|---------|-----------|------------------|
| **boards2 Render()** | `plugins/board/parserV1.ts`, `parserV2.ts`, `parser.ts` | Board listing/thread format changes — V2 parser skeleton ready |
| **GovDAO functions** | `lib/dao/builders.ts` (`GOVDAO_VOTE_FUNC` constant) | `MustVoteOnProposalSimple` rename → update constant |
| **GovDAO memberstore** | `lib/dao/config.ts`, `members.ts`, `voteScanner.ts` | Tier table format, memberstore path changes |
| **GovDAO proposals** | `lib/dao/proposals.ts` | `# GovDAO` header format, proposal rendering |
| **r/sys/users** | `lib/dao/shared.ts`, `lib/config.ts` | Username resolution (safe for now) |
| **Betanet config** | `lib/config.ts` | New chain IDs, RPC URLs, trusted domains |

## P0 Details

### #5857 / #5858 — event attribute caps (merged Jun 25, 2026)

- **#5857** raises `MaxEventAttrLen` from 1024 to 4096 (config change; pairs with #5858).
- **#5858** makes `chain.emit` **panic** on over-cap attribute *values* instead of
  silently truncating them — **state-breaking** for any realm that can emit an
  unbounded, user-controlled string.
- **Memba exposure — narrow, forward-looking.** Deployed realms emit via the migrated
  `chain.Emit`. The only realistically user-controlled, unbounded emitted value is
  `agent_registry` `AgentRegistered` → `"name"` (endpoint/version/pricing are length- or
  enum-capped). `collections.SetCollectionMeta` emits an arbitrary `"value"` but is
  `assertPlatformAdmin`-gated. Reviews/candidature/token-OTC/feedback emit only bounded
  IDs/addresses.
- **Risk materializes on the next network running post-#5858 gno (mainnet / next
  testnet), not on current test13.**
- **Action:** cap emitted string lengths at the realm boundary before any mainnet
  redeploy (see audit plan §5).

### #5037 — boards2 safe functions
- Adds `gno.land/r/gnoland/boards2/v1/hub` sub-realm with read-only functions
- If Render() output format changes → `parser.ts` regex breaks
- If boards served from `hub` → `queryRender` board path needs updating
- **Test:** `queryRender(rpcUrl, "gno.land/r/gnoland/boards2/v1", "")` after merge

### #5222 — govdao T1 multisig
- Critical: `builders.ts` L28 calls `MustVoteOnProposalSimple` — if renamed, all voting breaks
- Check memberstore still at `gno.land/r/gov/dao/v3/memberstore`
- **Test:** `queryRender(rpcUrl, "gno.land/r/gov/dao", "")` after merge

## Post-Merge Regression Checklist

```bash
# Run after any P0/P1 PR merges to testnet
cd frontend && npm run build
cd frontend && npm test -- --run
cd frontend && npx playwright test --project=chromium --reporter=list
```

Manual checks:
1. Navigate to `/dashboard` → verify GovDAO voting works
2. Navigate to `/channels` → verify demo board loads
3. Navigate to any DAO → verify members list loads
4. Cast a test vote → verify tx broadcast succeeds
