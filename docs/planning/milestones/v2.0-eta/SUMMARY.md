# v2.0-η — UX Audit Sprint

> **Date**: 2026-03-07 | **Branch**: PR #70 → `dev/v2`
> **Tests**: 360/360 unit | **Build**: Clean

## Overview

18-issue cross-perspective UX audit — 4 phases (A–D), P0–P3 fixes.

## Phases

| Phase | Focus | Items |
|-------|-------|-------|
| A (P0) | ConnectingLoader gate fix | `<Outlet>` always renders, page-level guards, `isLoggingIn` context |
| B (P1) | Plugin routes, syncing timeout, footer | DAO-scoped plugin links, 10s timeout + retry, contrast/z-index fixes |
| C (P1) | Phosphor icon migration | `@phosphor-icons/react` replaces emoji across 6 files |
| D (P2) | UX polish | `.k-main` CSS, tier tooltips, `aria-live` on ConnectingLoader |

## Key Changes

- **P0: ConnectingLoader gate** — `Layout.tsx` no longer blocks all page content during wallet sync
- **Plugin sidebar routes** — links now route to `/dao/{lastVisitedDAO}/plugin/{id}`
- **Phosphor Icons** — all navigation emoji icons replaced with SVG icons
- **Accessibility** — `role="status"` + `aria-live="polite"` on ConnectingLoader

## Quality Gates

- 360 unit tests (18 files)
- 0 TypeScript errors
- 0 Lint errors
- Build clean
