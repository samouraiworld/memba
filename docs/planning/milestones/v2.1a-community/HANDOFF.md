# v2.1a — Community Foundation (HANDOFF)

> **Date**: 2026-03-08 | **Session**: v2.1a close

---

## What Was Completed

### Features (5/5)
- ✅ **Channel Realm v2** — Discord-like channels with role-based ACL, token-gated writes, threads, replies, rate limiting, admin actions, @mentions
- ✅ **$MEMBA GRC20 Token** — `$MEMBATEST`/`$MEMBA`, 10M supply, 2.5% fee
- ✅ **MembaDAO Candidature Flow** — submit/approve/reject, re-candidature cost, self-approval guard
- ✅ **IPFS Avatars** — Lighthouse upload, 256×256 WebP resize, `ipfs://` canonical save
- ✅ **MembaDAO Bootstrap** — config, deployment orchestrator, status checker

### Audit
- 5-round deep review: 23 findings, 15 fixed, 5 deferred (low risk)
- See [AUDIT.md](AUDIT.md) for full findings table

### Documentation
- CHANGELOG.md, ROADMAP.md, MASTER_ROADMAP.md all updated
- `.env.example` updated with `VITE_LIGHTHOUSE_API_KEY`

### PR
- PR #74 created: `feat/v2.1a-channel-realm` → `dev/v2`
- 3 commits: `ba3947d` (feature), `5aa28f3` (R4 fixes), `9dd9c65` (docs sync)

---

## What Remains

### For PR #74 Merge
- [ ] CI must pass on PR #74
- [ ] Manual review by zôÖma

### Deferred v2.1a Items (fold into v2.1b)
- `formatTokenAmount` trailing zeros (cosmetic)
- CID regex V1-strict enforcement
- E2E test IDs for new components
- BoardView inline styles → CSS classes
- `assertIsMember` cross-realm guard (Gno limitation)

### v2.1a Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| Any DAO can create channels with role-based permissions | ✅ code gen ready |
| Messages 100% on-chain | ✅ Gno realm |
| $MEMBA token exists with correct allocation | ✅ config + helpers |
| Users can submit candidature | ✅ realm + flow |
| 2-member approval + 10 $MEMBA airdrop | ✅ code gen |
| 6 standard channels with permissions | ✅ `MEMBA_CHANNEL_DEFS` |
| IPFS avatars upload + display | ✅ Lighthouse + AvatarUploader |
| Tests pass | ✅ 529/529 |
| Audit completed | ✅ 5 rounds |
| Docs updated | ✅ CHANGELOG, ROADMAP, MASTER_ROADMAP |

---

## Gotchas

1. **`assertIsMember` is a no-op**: Gno doesn't support cross-realm imports yet. Channel write access depends on `adminAddr` check only. When Gno adds stable cross-realm imports, update the guard.
2. **Mixed tab styles in EditMessage**: The multi-replace tool caused inconsistent indentation between `EditMessage` (literal tabs) and `DeleteMessage` (escaped tabs). Both are valid Go — `gofmt` normalizes them. No runtime impact.
3. **Lighthouse API key**: Required for IPFS uploads. Without it, AvatarUploader falls back to DataURL (dev mode). Add `VITE_LIGHTHOUSE_API_KEY` to `.env`.
4. **Token deployment**: $MEMBA token helpers exist but the token hasn't been deployed on-chain yet. Deployment requires running `buildCreateMembaTokenMsgs()` and broadcasting via Adena.

---

## Test Results

```
Tests: 529/529 (22 files)
TSC:   0 errors
Lint:  0 errors
Build: clean (496KB / 145KB gzip)
```
