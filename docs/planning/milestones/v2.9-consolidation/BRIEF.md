# v2.9 — Consolidation & Main Merge

> **Predecessor:** v2.7 Monitoring Integration (16 milestones shipped)
> **Branch:** `dev/v2`
> **Goal:** Stop adding features. Fix UX, wire unfinished components, decompose monoliths, expand tests, then merge `dev/v2` → `main`.

## Scope

### Phase 1: Critical UX Fixes

| # | Task | Files | Est. |
|---|------|-------|------|
| 1.1 | **Restore footer socials** — add 5 missing icons (X, Instagram, YouTube, LinkedIn, Telegram) | `Layout.tsx` | 15 min |
| 1.2 | **Deployment modal** — convert `DeploymentPipeline` from inline to modal overlay | `DeploymentPipeline.tsx`, `.css`, `.test.tsx` | 45 min |

### Phase 2: Feature Completion

| # | Task | Files | Est. |
|---|------|-------|------|
| 2.1 | **Wire JitsiMeet → channels** — detect 🔊/🎥 channel types, render JitsiMeet | `BoardView.tsx` | 1-1.5h |
| 2.2 | **MultisigHub completion** — list saved multisigs, action buttons, responsive | `MultisigHub.tsx`, `multisig-hub.css` | 1-1.5h |

### Phase 3: Tech Debt & Refactoring

| # | Task | Files | Est. |
|---|------|-------|------|
| 3.1 | **BoardView decomposition** (675 LOC → 5 components) | `BoardView.tsx` → `ThreadList`, `ThreadView`, `ComposeThread`, `BoardHeader` | 2-3h |
| 3.2 | **CSP sync + docs** — add comments explaining dual-config | `index.html`, `netlify.toml` | 15 min |
| 3.3 | **E2E expansion** — 5 new spec files (validators, extensions, directory, cmd-k, channels) | `e2e/` | 2h |
| 3.4 | **Cleanup pass** — unused imports, commented code, TODOs | Various | 30 min |

### Phase 4: Pre-Merge Audit

| # | Task | Est. |
|---|------|------|
| 4.1 | Full 216-file diff review | 1-2h |
| 4.2 | Security checklist (XSS, CSP, secrets, RPC allowlist) | 30 min |

### Phase 5: Main Merge

| # | Task | Est. |
|---|------|------|
| 5.1 | `git merge --no-ff dev/v2` + tag `v2.9.0` | 15 min |
| 5.2 | Post-merge verification (Netlify, Sentry, smoke test) | 15 min |

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| 1 | Footer shows 7 social icons (X, Instagram, YouTube, GitHub, LinkedIn, Telegram, Email) |
| 2 | Deployment flows show modal overlay (not inline at page bottom) |
| 3 | Voice/video channels render JitsiMeet when selected in BoardView |
| 4 | MultisigHub lists saved multisigs with balances and action buttons |
| 5 | BoardView is decomposed into ≤5 components, each ≤200 LOC |
| 6 | 5 new E2E spec files pass |
| 7 | 216-file diff reviewed with no security issues |
| 8 | `main` branch updated and production deployed at `memba.samourai.app` |
| 9 | `npm test`, `tsc`, `lint`, `build`, `playwright test` all pass with 0 errors |

## Estimated Total: ~10-13 hours (2-3 sessions)

## Key Files

| File | LOC | Action |
|------|-----|--------|
| [Layout.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/layout/Layout.tsx) | 238 | Footer socials |
| [DeploymentPipeline.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/ui/DeploymentPipeline.tsx) | 230 | Modal conversion |
| [BoardView.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/plugins/board/BoardView.tsx) | 675 | Decomposition + JitsiMeet |
| [JitsiMeet.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/components/ui/JitsiMeet.tsx) | 164 | Wire into BoardView |
| [MultisigHub.tsx](file:///Users/zxxma/Desktop/Code/Gno/Memba/frontend/src/pages/MultisigHub.tsx) | ~188 | Completion |
| [netlify.toml](file:///Users/zxxma/Desktop/Code/Gno/Memba/netlify.toml) | 22 | CSP sync |
