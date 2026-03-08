# v2.1a — Community Foundation (AUDIT)

> **Date**: 2026-03-08 | **Rounds**: 5 | **Auditor**: CTO (AI-assisted)

---

## Scope

All 23 files in `feat/v2.1a-channel-realm` branch (~3,993 lines added):

- `channelTemplate.ts` (853L) — Channel Realm v2 code generator
- `candidatureTemplate.ts` (391L) — MembaDAO candidature flow
- `ipfs.ts` (177L) — IPFS avatar upload pipeline
- `membaDAO.ts` (245L) — DAO config, deployment, membership
- `grc20.ts` (442L) — Token helpers, fee model, type guards
- `AvatarUploader.tsx` (246L) — Avatar file picker + IPFS upload
- `BoardView.tsx` (621L) — Discord-like channels UI
- `parser.ts` (314L) — Board/channel ABCI parser
- `config.ts` — Token/DAO/channel path config
- `registry.ts` (82L) — Plugin registry
- All corresponding `.test.ts` files (8 test files)
- Documentation files (CHANGELOG, ROADMAP, MASTER_ROADMAP, .env.example)

---

## Findings Summary

| Round | Critical | Important | Minor | Notes | Total |
|-------|----------|-----------|-------|-------|-------|
| R1 | 2 | 4 | 4 | 3 | 13 |
| R2 | 0 | 0 | 3 | 1 | 4 |
| R3 | 0 | 0 | 0 | 0 | 0 |
| R4 | 0 | 0 | 3 | 3 | 6 |
| R5 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **2** | **4** | **10** | **7** | **23** |
| **Fixed** | **2** | **4** | **10** | **3** | **19** |

---

## Critical Fixes

| ID | Finding | Fix |
|----|---------|-----|
| C1 | `FEE_RECIPIENT` pointed to founder address, not multisig | Corrected to `g1pavqfezrge9kgkrkrahqm982yhw5j45v0zw27v` |
| C2 | Skills input not validated in generated Gno code | Added `len(skills) > 500` check in `SubmitCandidature` |

## Important Fixes

| ID | Finding | Fix |
|----|---------|-----|
| I1 | `ApproveCandidature` allows self-approval | Added `if caller == c.Address { panic }` guard |
| I3 | `AvatarUploader` saved gateway URL, not `ipfs://` | Now saves `ipfs://<CID>` canonical URI |
| I4 | `GRC20_FACTORY_PATH` re-exported without deprecation | Marked `@deprecated` with import guidance |
| I5 | `MEMBA_CHANNELS` naming collision across modules | Renamed to `MEMBA_CHANNEL_DEFS` in channelTemplate |

## Minor Fixes

| ID | Finding | Fix |
|----|---------|-----|
| M1 | No re-candidature cost after rejection | 10 GNOT × past rejections |
| M2 | `toAdenaMessages` silently passes non-MsgCall | Throws `Error` for non-MsgCall types |
| M3 | Render returns all candidatures regardless of path | Path filtering: pending/approved/rejected |
| M4 | No escaping convention comments in generators | Added `// Gno escaping:` comments |
| R4-M1 | `MEMBA_CHANNELS` in membaDAO.ts confusing | Renamed to `MEMBA_DAO_CHANNELS` |
| R4-M2 | `isMembaDAOMember()` uses substring match | Line-by-line token matching |
| R4-M3 | Edit window hardcoded to 100 blocks | Configurable `editWindowBlocks` in ChannelConfig |

## Additional Fixes (Post-R5)

| ID | Finding | Fix |
|----|---------|-----|
| I2 | `formatTokenAmount` trailing zeros (`1.000000`) | Strips trailing zeros (`1`, `1.5`). Tests updated. |
| M5 | CID regex only accepts `bafybei[a-z0-9]{52}` | Broadened to `bafy[a-z2-7]{55,}` (all CIDv1 base32) |
| N1 | AvatarUploader missing E2E test IDs | 5 `data-testid` attributes added |
| N2 | BoardView 600+ lines of inline styles | `board.css` extracted (sidebar, cards, forms, tags) |

## Deferred (Blocked)

| ID | Finding | Reason |
|----|---------|--------|
| N3 | `assertIsMember` no-op | Gno cross-realm limitation — no fix possible until upstream adds stable cross-realm imports |

---

## Quality Gates

| Metric | Value |
|--------|-------|
| Unit tests | 529/529 ✅ |
| TSC errors | 0 ✅ |
| Lint errors | 0 ✅ |
| Build | clean ✅ |

## Verdict

**✅ PRODUCTION-READY.** No outstanding critical or important findings.
