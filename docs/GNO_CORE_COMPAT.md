# Gno Core Compatibility — Migration Playbook

> **Date:** 2026-03-30 · **Memba:** v2.21.0 · **Baseline:** 959 tests, 0 TS errors
>
> Step-by-step migration instructions for each tracked upstream PR.
> See also: [GNO_CORE_BREAKING_CHANGES.md](planning/GNO_CORE_BREAKING_CHANGES.md)

---

## Architecture: How Memba Absorbs Upstream Changes

Memba's frontend parses on-chain Render() output via regex-based parsers.
As of v2.21.0, these parsers use a **strategy pattern**:

```
ABCI query functions (parser.ts)
  └─ getActiveBoardParser() → BoardParser interface
       ├─ boardParserV1 (parserV1.ts) — current, regex-based
       └─ boardParserV2 (parserV2.ts) — skeleton for boards2 hub
```

GovDAO function names are **configurable constants**:
```
GOVDAO_VOTE_FUNC    = "MustVoteOnProposalSimple"  (builders.ts)
GOVDAO_PROPOSE_FUNC = "Propose"                   (builders.ts)
```

When an upstream PR changes the format, update the relevant parser version
or constant — all consumers automatically pick up the change.

---

## P0: gno#5037 — boards2 Safe Functions + Hub Sub-Realm

**Status:** Open · **Risk:** HIGH · **Effort:** 2-4h · **Act when:** Merged to testnet

### What Changes
- New `gno.land/r/gnoland/boards2/v1/hub` sub-realm with read-only functions
- Render() output format may change for board listings and threads
- Board paths may shift from `boards2/v1` to `boards2/v1/hub`

### Migration Steps

1. **Detect the new format** — Query `Render("")` on the hub path after merge:
   ```bash
   gnokey query vm/qrender -data "gno.land/r/gnoland/boards2/v1/hub" ""
   ```

2. **Capture format samples** — Save real Render() output for:
   - Board home (channel list)
   - Thread list per channel
   - Thread detail with replies
   - ACL endpoint

3. **Implement parserV2** — Update `frontend/src/plugins/board/parserV2.ts`:
   - Implement `parseBoardHome()` for new format
   - Implement `parseThreadList()` for new format
   - Implement `parseThreadDetail()` for new format
   - Keep `parseACL()` and `parseMentions()` (unlikely to change)

4. **Update format detection** — In `parser.ts`, update `getActiveBoardParser()`:
   ```typescript
   export function getActiveBoardParser(): BoardParser {
       // Detect V2 format markers in Render() output
       // e.g., JSON response, hub-specific headers, etc.
       return boardParserV2  // or keep V1 as fallback
   }
   ```

5. **Update integration tests** — Add V2 format samples to:
   - `plugins/board/parser.integration.test.ts`
   - `plugins/board/board.test.ts`

6. **Update board path detection** — If hub uses a different path:
   - Update `detectChannelRealm()` in `parser.ts`
   - Update `BoardPlugin` in `plugins/board/index.tsx`

### Files to Modify
| File | Change |
|------|--------|
| `plugins/board/parserV2.ts` | Implement new format parsers |
| `plugins/board/parser.ts` | Update `getActiveBoardParser()` detection |
| `plugins/board/parser.integration.test.ts` | Add V2 format test samples |
| `plugins/board/board.test.ts` | Add V2 unit tests |
| `pages/ChannelsPage.tsx` | May need path updates if hub changes paths |

### Regression Checklist
- [ ] Board home loads with channel list
- [ ] Thread list renders for each channel
- [ ] Thread detail shows body + replies
- [ ] ACL-based channel permissions work
- [ ] @mention parsing still works
- [ ] `detectChannelRealm()` finds the correct realm
- [ ] All 959+ tests pass

---

## P0: gno#5222 — GovDAO T1 Multisig Rewiring

**Status:** Open · **Risk:** MED-HIGH · **Effort:** 0-4h · **Act when:** Merged to testnet

### What Changes
- GovDAO T1 tier may become a multisig-based voting mechanism
- `MustVoteOnProposalSimple` function may be renamed or removed
- Memberstore tier format may change

### Migration Steps

1. **Check function names** — After merge, verify on testnet:
   ```bash
   gnokey query vm/qeval -data "gno.land/r/gov/dao" "MustVoteOnProposalSimple(0, \"YES\")"
   ```
   If this errors with "unknown function", the name has changed.

2. **Update vote function constant** — In `frontend/src/lib/dao/builders.ts`:
   ```typescript
   export const GOVDAO_VOTE_FUNC = "NewFunctionName"  // update to match
   ```

3. **Check memberstore format** — Query the memberstore:
   ```bash
   gnokey query vm/qrender -data "gno.land/r/gov/dao/v3/memberstore" ""
   ```
   If tier format changed, update `parseMemberstoreTiers()` in `config.ts`.

4. **Check proposal format** — Query proposals:
   ```bash
   gnokey query vm/qrender -data "gno.land/r/gov/dao" ""
   ```
   If proposal format changed, update `parseProposalList()` in `proposals.ts`.

5. **Run integration tests** — The new tests in `integration.test.ts` will
   catch format mismatches automatically.

### Files to Modify
| File | Change |
|------|--------|
| `lib/dao/builders.ts` | Update `GOVDAO_VOTE_FUNC` constant |
| `lib/dao/config.ts` | Update `parseMemberstoreTiers()` if format changed |
| `lib/dao/proposals.ts` | Update `parseProposalList()` if format changed |
| `lib/dao/integration.test.ts` | Update test samples |

### Regression Checklist
- [ ] GovDAO proposals list loads
- [ ] Voting on GovDAO proposals works (YES/NO/ABSTAIN)
- [ ] Proposal execution works
- [ ] Tier distribution displays correctly
- [ ] Member list loads with correct voting power
- [ ] All 959+ tests pass

---

## P1: gno#5139 — boards2 Members via GovDAO Proposals

**Status:** Open · **Effort:** 0-1h · **Act when:** Deployed to testnet

### What Changes
Board moderator/member management goes through GovDAO proposals instead of direct admin calls.

### Migration Steps
1. Check if `AddMember`/`RemoveMember` on boards still work directly
2. If gated behind proposals, update any board management UI (none currently in Memba)
3. Monitor only — no Memba code changes expected unless we add board admin features

---

## P1: gno#5250 — Betanet Config

**Status:** Open · **Effort:** 1-2h · **Act when:** Betanet launch

### Migration Steps
1. Add new network entry to `NETWORKS` in `frontend/src/lib/config.ts`
2. Add chain ID, RPC URL, user registry path, faucet URL
3. Add RPC domain to `TRUSTED_RPC_DOMAINS`
4. Update `getExplorerBaseUrl()` with betanet URL
5. Test network switching to the new chain

### Files to Modify
| File | Change |
|------|--------|
| `lib/config.ts` | Add betanet network config + trusted domain |
| `docs/DEPLOYMENT.md` | Document betanet deployment steps |

---

## P2: gno#5217 — Gas Metering Fix

**Status:** Open · **Effort:** 0 · **Action:** Monitor

Gas costs for realm deployment may change. Monitor deploy fee in `MEMBA_DAO.deployFee`
and template gas configs. No code changes expected unless fees increase significantly.

---

## Quick Reference: Post-Merge Regression Suite

```bash
# Run after any tracked PR merges to testnet
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run
cd frontend && npx eslint .
cd frontend && npm run build
cd backend && go test -race -count=1 ./...

# Manual smoke tests
# 1. /dashboard → GovDAO proposals load
# 2. /channels → Board renders
# 3. Vote on a GovDAO proposal → tx succeeds
# 4. Create a Memba DAO → deploy tx succeeds
# 5. Network switch → app reloads correctly
```
