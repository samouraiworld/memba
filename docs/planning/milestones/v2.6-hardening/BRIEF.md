# v2.6 Brief — Hardening, OSS Prep & Revenue Foundation

> **Status**: 📋 IN PROGRESS
> **Scope**: 4 phases, 40+ tasks, 3-4 sessions
> **Branch**: TBD (feature branch from `dev/v2`)
> **Predecessor**: v2.5 Channels & Comms (PR #79)

## Motivation

The 22-perspective deep audit of Memba (14 milestones, 35K LOC, 687 tests) revealed:
- 1 critical live bug (board deploy failure on test11)
- 2 critical repo hygiene issues (binary + DB committed)
- 12 should-fix findings across security, architecture, UX, and documentation
- Significant documentation gaps blocking OSS community readiness
- Revenue model documented but unimplemented

This milestone addresses **all actionable findings** in a structured 4-phase plan.

## Acceptance Criteria

### Phase 0 — Critical Bug Fix
- [ ] DAO with Board plugin deploys successfully on test11
- [ ] Channel realm deploys successfully
- [ ] Candidature realm deploys successfully
- [ ] All existing deploy tests updated and passing

### Phase 1 — Hardening Sprint
- [ ] Binary + DB removed from repo and `.gitignore`'d
- [ ] React Error Boundary catches render crashes
- [ ] CSP meta tag in `index.html`
- [ ] Backend `/health` endpoint returns 200
- [ ] Dependabot alerts resolved (0 remaining)
- [ ] Sentry performance monitoring enabled
- [ ] BoardView decomposed (< 500 LOC main component)
- [ ] ABCI errors surfaced to users
- [ ] Gas fees configurable per-network

### Phase 2 — OSS Launch Prep
- [ ] README.md updated with current features + screenshots
- [ ] CONTRIBUTING.md exists with dev setup guide
- [ ] SECURITY.md exists with vulnerability disclosure policy
- [ ] GitHub issue + PR templates exist
- [ ] Makefile with common commands
- [ ] Command palette (Cmd+K) functional
- [ ] First-time user onboarding flow
- [ ] User-friendly error messages (no raw ABCI errors)

### Phase 3 — Revenue Foundation
- [ ] GnoSwap slippage selector + swap execution
- [ ] Executable proposals (auto-execute on quorum)
- [ ] Execution timeline in proposal view

## Quality Gates

| Check | Requirement |
|-------|-------------|
| Unit tests | ≥ 720 (target: +33 from current 687) |
| E2E tests | ≥ 119 (maintain or improve) |
| tsc errors | 0 |
| Lint errors | 0 |
| Build size | < 500KB |

## Dependencies

| Dependency | Phase | Risk |
|------------|-------|------|
| test11 chain `std` import format | Phase 0 | 🔴 Blocker — must investigate live |
| GnoSwap contracts on test11 | Phase 3 | 🟡 Medium — may not be deployed |
| `r/sys/users` upstream migration | Phase 1 | 🟡 Track only — migrate when ready |

## Deferred Items (v3.0+)

| Item | Target |
|------|--------|
| CSO-3 Jitsi JWT auth | v4.0 |
| GNO-2 `gno test` in CI | v3.0 |
| UX-1 Light mode toggle | v3.0 |
| UX-3 Presence dots | v3.0 |
| BT-2 Structured backend logging | v3.0 |
| DR-2 Backend API documentation | v3.0 |
| BC-3 Mempool monitoring | v3.0 |
