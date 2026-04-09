# Light Theme Fix + Report UX Improvements — Implementation Plan

> **Date:** 2026-04-09 (v2 — added Light Theme Sprint 0)
> **Status:** PROPOSAL — Awaiting approval
> **Base:** v4.1 (main @ 66d0d11) — PR #286 merged

---

## 0. Light Theme — Remaining Issues (NEW)

### Root Cause

Phase A (#285) replaced 400+ hardcoded hex colors (`#f0f0f0`, `#888`, etc.) but did **not** touch `rgba()` patterns. There are two broken categories:

1. **`rgba(0,0,0,...)` / `rgba(13,13,13,...)` dark overlays** (45 instances) — Create grey stains on the light `#f8f9fa` background. Inputs, cards, and panels look muddy.

2. **`rgba(255,255,255,0.0x)` subtle whites** (304 instances) — Create near-invisible cards, borders, hovers on light backgrounds. Elements visually disappear.

### The Directory Page (User-Reported)

The worst offender. Key issues:

| Element | Current CSS | Problem |
|---------|-------------|---------|
| `.dir-search` input | `background: rgba(13,13,13,0.8)` | Dark grey input on white bg |
| `.dir-search` border | `border: 1px solid rgba(255,255,255,0.06)` | Invisible border |
| `.dir-card` | `background: rgba(13,13,13,0.6)` | Grey card on white bg |
| `.dir-card` border | `border: 1px solid rgba(255,255,255,0.04)` | Invisible border |
| `.dir-search--global` | `background: rgba(0,0,0,0.3)` | Grey overlay |
| `.dir-govdao-card` | `background: rgba(255,255,255,0.02)` | Invisible card |
| `.dir-govdao-card:hover` | `background: rgba(255,255,255,0.035)` | Invisible hover |
| `.drawer-panel` | `background: rgba(16,16,16,0.97)` | Dark drawer on light |
| `.source-view` | `background: rgba(0,0,0,0.3)` | Grey code viewer |

### Systematic Fix — New Design Tokens

Add new semantic tokens to `tokens.css` for the missing surface levels:

```css
:root {
    /* Existing */
    --color-bg: #0a0a0a;
    --color-bg-card: #0c0c0c;
    --color-bg-hover: rgba(255, 255, 255, 0.02);
    
    /* NEW — Surface hierarchy */
    --color-surface: rgba(255, 255, 255, 0.03);    /* Subtle card/panel bg */
    --color-surface-hover: rgba(255, 255, 255, 0.06); /* Card hover */
    --color-surface-active: rgba(255, 255, 255, 0.08); /* Active/pressed */
    --color-surface-input: rgba(255, 255, 255, 0.05);  /* Input/search fields */
    --color-overlay: rgba(0, 0, 0, 0.6);           /* Modal/drawer backdrop */
    --color-overlay-light: rgba(0, 0, 0, 0.3);     /* Lighter overlay */
}

[data-theme="light"] {
    /* NEW — Light theme surfaces */
    --color-surface: rgba(0, 0, 0, 0.02);
    --color-surface-hover: rgba(0, 0, 0, 0.04);
    --color-surface-active: rgba(0, 0, 0, 0.06);
    --color-surface-input: #ffffff;
    --color-overlay: rgba(0, 0, 0, 0.4);
    --color-overlay-light: rgba(0, 0, 0, 0.15);
}
```

### Pages Affected

| Page CSS File | `rgba(0,0,0)` | `rgba(255,255,255,0.0x)` | Total |
|---------------|---------------|--------------------------|-------|
| `directory.css` | 4 | 25+ | ~30 |
| `marketplace.css` | 6 | 15+ | ~20 |
| `validators.css` | 3 | 12+ | ~15 |
| `nft-gallery.css` | 6 | 10+ | ~16 |
| `nft-launchpad.css` | 4 | 8+ | ~12 |
| `freelance.css` | 4 | 8+ | ~12 |
| `channels.css` | 3 | 8+ | ~11 |
| `questhub.css` | 1 | 5+ | ~6 |
| `proposalview.css` | 2 | 6+ | ~8 |
| `organizations.css` | 1 | 5+ | ~6 |
| `alerts.css` | 0 | 5+ | ~5 |
| `daomembers.css` | 1 | 3+ | ~4 |
| Component CSS files | 8 | 15+ | ~23 |
| **TOTAL** | **~45** | **~130+** | **~170** |

Note: Many of the 304 `rgba(255,255,255,...)` instances are legitimate on colored backgrounds (accent overlays, gradient stops). The ~130 that need fixing are on neutral backgrounds/cards/inputs.

---

## Implementation Plan

### Sprint 0 — Light Theme Surface Tokens + Global Fix (NEW)

**Effort:** 3-4h

```
0.1: Add new surface tokens to tokens.css
  - --color-surface (subtle card bg)
  - --color-surface-hover (card hover)
  - --color-surface-active (pressed/active)
  - --color-surface-input (input/search fields)
  - --color-overlay (modal/drawer backdrop)
  - --color-overlay-light (lighter overlay)
  - Both :root (dark) and [data-theme="light"] values

0.2: Fix Directory page (priority — user-reported)
  File: directory.css
  - .dir-search: bg rgba(13,13,13,0.8) → var(--color-surface-input)
  - .dir-search border: rgba(255,255,255,0.06) → var(--color-border)
  - .dir-card: bg rgba(13,13,13,0.6) → var(--color-surface)
  - .dir-card border: rgba(255,255,255,0.04) → var(--color-border)
  - .dir-search--global: bg rgba(0,0,0,0.3) → var(--color-surface-input)
  - .dir-govdao-card: bg rgba(255,255,255,0.02) → var(--color-surface)
  - .drawer-panel: bg rgba(16,16,16,0.97) → var(--color-bg-card)
  - .source-view: bg rgba(0,0,0,0.3) → var(--color-bg-card)
  - All remaining rgba hover/border values → tokens

0.3: Fix all other page CSS files (batch sed)
  Strategy: For each file, replace patterns:
  
  Cards/panels:
    rgba(13,13,13,0.6-0.8) → var(--color-surface-input) or var(--color-bg-card)
    rgba(0,0,0,0.15-0.3) backgrounds → var(--color-surface) or var(--color-overlay-light)
    rgba(255,255,255,0.02-0.03) backgrounds → var(--color-surface)
    rgba(255,255,255,0.04-0.06) backgrounds → var(--color-surface-hover)
    rgba(255,255,255,0.08) backgrounds → var(--color-surface-active)
    
  Inputs/fields:
    background: rgba(dark) on inputs/selects → var(--color-surface-input)
    
  Borders:
    border: rgba(255,255,255,0.04-0.08) → var(--color-border)
    
  Hovers:
    :hover background rgba(255,255,255,0.0x) → var(--color-surface-hover)
    
  Overlays (keep as rgba — intentionally dark):
    Modal/drawer overlays rgba(0,0,0,0.5-0.8) → var(--color-overlay)
    Lighter overlays rgba(0,0,0,0.3) → var(--color-overlay-light)
    
  Hardcoded dark backgrounds:
    #0d0d0d → var(--color-bg)
    #1a1a2e → var(--color-bg)
    rgba(16,16,16,0.97) → var(--color-bg-card)

0.4: Fix component CSS files
  Same patterns as 0.3 applied to:
  - questprogress.css (3 remaining rgba(0,0,0) — already partially fixed)
  - onboarding-wizard.css
  - connectwalletprompt.css
  - command-palette.css
  - DeploymentPipeline.css
  - dao-rooms.css
  - coming-soon.css

0.5: Verify — visual spot check + build + tests
  - Check Directory page in light theme
  - Check 5 most-used pages in light theme
  - Confirm dark theme has no regressions
```

### Sprint 1 — Report Section Reorder + Default Repo

**Effort:** 1-2h

```
1.1: Reorder NarrativeReportView sections (rendered HTML)
  New order:
    1. Period Header
    2. 📊 Stats
    3. ⭐ Highlights
    4. 📋 Waiting for Review (NEW section from waitingForReview + reviewed)
    5. 🚧 In Progress
    6. 🚧 Blockers
    7. 🎉 Merged (moved to bottom)
    8. 👥 Active Contributors

1.2: Reorder generateReportMd() to match
  Same order for copy-paste markdown output.

1.3: Default selectedRepos to gnolang/gno
  Change: new Set() → new Set(["gnolang/gno"])

1.4: Fix multi-select UX
  Show "gnolang/gno" text (not "1 repo selected") when only gno is selected
```

### Sprint 2 — Waiting for Review Section + Deduplication

**Effort:** 2-3h

```
2.1: Add dedicated "📋 Waiting for Review" section
  Combines waitingForReview + reviewed arrays
  Each PR appears in only ONE status section (no duplicates)

2.2: Remove "By Repository" from rendered view
  Keep in markdown only. Rendered view uses per-status sections.
  Each PR listed once under its status (Waiting/InProgress/Blocked/Merged).

2.3: Improve Highlights heuristic
  Use number of reviews (comments/approvals) instead of title length
```

### Sprint 3 — PR Format + Emoji Indicators

**Effort:** 2-3h

```
3.1: PR line format in markdown
  Target: - emoji title - url - author (N ✅, N 💬, N 🔄)

3.2: PR line format in rendered HTML
  Show review stats inline as small badges

3.3: Team filter in markdown header

3.4: Improved copy feedback (green flash on button)
```

---

## Execution Order

```
Sprint 0  Light Theme Surface Fix        [3-4h]  ← Fixes grey cards/inputs globally
Sprint 1  Report Reorder + Default Repo  [1-2h]  ← User's primary report request
Sprint 2  Waiting for Review + Dedup     [2-3h]  ← Structural report improvement
Sprint 3  PR Format + Emoji              [2-3h]  ← gno-skills parity

Total: 8-12h
```

**Branch:** `feat/v4.1-light-theme-report-v2`

---

*This plan will not be executed until explicit user approval is received.*
