# v2.0-θ — UX Polish & Layout Fixes

**Status**: 🟡 IN REVIEW  
**PR**: [#71](https://github.com/samouraiworld/memba/pull/71) → `dev/v2`  
**Commits**: `f3ed30b` (Phosphor migration) + `a7ccea0` (layout fixes)  
**Date**: 2026-03-07

## Summary

Follow-up to the v2.0-η audit, implementing all remaining Medium/Low findings plus user-reported bugs from deploy preview testing.

## Changes

| Category | Scope | Files |
|----------|-------|-------|
| P0 Layout | Sidebar fixed positioning, logo alignment, footer safeguard | index.css |
| P0 Branding | ConnectingLoader: 72px logo, no borders | ConnectingLoader.tsx |
| P1 Icons | 30+ emoji → Phosphor migration (10 pages) | Dashboard, DAOList, DAOHome, ProposalView, ProposeDAO, CreateDAO, TokenView, ImportMultisig, TransactionView, UserRedirect |
| P1 React | MobileTabBar TAB_DEFS, LayoutContext syncTimedOut | MobileTabBar.tsx, Layout.tsx, layout.ts |
| P2 UX | Disabled plugin BottomSheet close + inline hint | MobileTabBar.tsx |
| P2 DX | JSDoc on WizardStepPreset | WizardStepPreset.tsx |
| P2 E2E | 8 emoji selector updates | dao.spec.ts, smoke.spec.ts |

## Quality Gates

- 360/360 unit tests (18 files)
- 93/93 E2E tests (Chromium + Firefox)
- 0 lint errors, clean build
- Backend: `go test -race` pass, `go build` clean

## Next Session Ideas

- **Extensions/Plugins page** — dedicated page showing upcoming extensions with descriptions and status (coming soon, available, under development)
- Further audit items from v2.0-η post-merge review
