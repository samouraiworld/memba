# v2.1b Audit — Validators & Notifications

> Branch: `feat/v2.1b-validators-notifications`
> Audit Date: 2026-03-08
> Findings: 33 total (3 critical, 9 important, 12 minor, 9 nits)
> Fixed: 15/15 Must Fix + Should Fix ✅

## Audit Methodology

Two-round deep review from 18 expert perspectives:
- **Round 1** (10 perspectives): CTO, Security, Performance, UX, Testing, Architecture, SRE, Data Integrity, Accessibility, Code Quality
- **Round 2** (8 perspectives): Race Conditions, DX, Production-Readiness, Gno-Native, Multi-DAO, Error Recovery, Keyboard/Focus, Data Integrity

## Critical Fixes Applied

| ID | Issue | Fix |
|----|-------|-----|
| C1 | Misleading faucet docstring about membership | Removed, updated to "per-address keys" |
| C2 | Validator polling 5s = 48 RPCs/min | 30s + Page Visibility API |
| C3 | Notifications hardcode single DAO | daoPath now optional (null = sync-only) |

## Important Fixes Applied

| ID | Issue | Fix |
|----|-------|-----|
| I1 | ABCI query format for proposals | Documented as best-effort |
| I2 | Notification link wrong slug | Proposal # in link + title |
| I3 | Missing AbortController | AbortSignal in rpcCall |
| I4 | Visibility check placement | Moved to interval callback |
| I5 | No refresh indicator | "Refreshing…" pulse animation |
| I6 | Notification dedup race | Monotonic `_idCounter` |
| I7 | Redundant validator fetch | Prefetched validators param |
| I8 | Missing ARIA focus trap | aria-expanded, role=menu, focus return |
| I9 | Faucet FIFO cooldown bypass | Per-address localStorage keys |

## Remaining (Nice-to-Have, NOT blocking)

| Finding | Impact | Status |
|---------|--------|--------|
| `buildFaucetMsgSend` returns `object` | DX | Deferred |
| Validators `per_page=100` no pagination | Future-proofing | Deferred |
| `sanitizeText` regex: unclosed tags | Near-zero risk | Deferred |

## Quality Gates

| Metric | Value |
|--------|-------|
| Unit tests | 415/415 ✅ |
| TypeScript errors | 0 ✅ |
| Lint errors | 0 ✅ |
