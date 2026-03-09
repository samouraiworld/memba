# v2.0-θ — UX Polish & Layout Fixes

> **Date**: 2026-03-07 | **Branch**: PR #71 → `dev/v2`
> **Tests**: 360/360 unit | **Build**: Clean

## Overview

Post-η polish: sidebar fixed positioning, logo alignment, footer safeguards, loader cleanup, CSP update.

## Key Changes

- **Sidebar fixed positioning** — sidebar stays in place during scroll
- **Logo alignment** — centered branding in sidebar header
- **Footer safeguard** — prevents footer from overlapping content on short pages
- **ConnectingLoader cleanup** — removed redundant loader states
- **CSP update** — `netlify.toml` Content-Security-Policy tightened
- **Phosphor icon migration** — remaining emoji → SVG in wizard presets

## Documentation Updates

- Updated CHANGELOG, ROADMAP, and milestone summaries
- Updated MASTER_ROADMAP with full milestone tracking (α → θ)

## Quality Gates

- 360 unit tests (18 files)
- 0 TypeScript errors
- 0 Lint errors
- Build clean
