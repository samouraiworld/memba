# Quest UI Polish + Theme Toggle — Implementation Plan

> **Date:** 2026-04-09
> **Status:** PROPOSAL — Awaiting approval
> **Base:** v4.1 (main @ e13a73b) — 1,588 tests, Phase A just merged

---

## 1. Scope

Two complementary improvements:

**A) Quest UI Design Polish** — Fix 27 design quality issues across quest components (typography, contrast, spacing, responsiveness, light/dark theme compliance).

**B) Quick Theme Toggle** — Add an elegant, always-visible theme switch to the TopBar so users don't need to navigate to Settings or know about Cmd+K.

---

## 2. Quest UI Audit Findings

### 2.1 Critical Issues (Must Fix)

| # | Issue | File | Problem |
|---|-------|------|---------|
| 1 | **CandidatureUnlock button text invisible in light mode** | `candidatureunlock.css:83` | `color: #0a0a0a` on gradient bg — unreadable in light theme |
| 2 | **Locked progress bar invisible in light mode** | `candidatureunlock.css:55-58` | Hardcoded `#555`→`#888` gradient — disappears on white bg |
| 3 | **Difficulty colors hardcoded** | `QuestCard.tsx:18-23` | `#22c55e`, `#3b82f6`, `#f59e0b`, `#ef4444` — don't use design tokens |
| 4 | **Progress ring text illegible** | `questprogress.css:335` | `font-size: 8px` — below minimum readable size |
| 5 | **Glow effects vanish in light theme** | Multiple files | `rgba(0, 212, 170, *)` too subtle on white backgrounds |

### 2.2 High Priority Issues (Should Fix)

| # | Issue | File | Problem |
|---|-------|------|---------|
| 6 | **Quest card title too small** | `questprogress.css:282` | 12px with `line-through` on completed — nearly illegible |
| 7 | **Font weight inconsistency** | `questhub.css:225` vs `questprogress.css:284` | Same component: 600 vs 500 font-weight |
| 8 | **Description text 10px + truncated** | `questprogress.css:294` | Too small, `white-space: nowrap` truncates content |
| 9 | **Mono font for body text** | `questprogress.css:180-181` | JetBrains Mono at 11px for descriptions — hard to read |
| 10 | **Gap inconsistency: 6px vs 16px** | `questprogress.css:235` vs `questhub.css:165` | Quest grids wildly inconsistent |
| 11 | **Card padding: 10px vs 16px** | `questprogress.css:243` vs `questhub.css:180` | Expanded view cramped vs page view spacious |
| 12 | **Locked state opacity too low** | `questhub.css:201` | `opacity: 0.6` fails WCAG contrast |
| 13 | **XP not using tabular numbers** | `questhub.css:57-60` | Values misalign during animation |

### 2.3 Medium Priority Issues (Polish)

| # | Issue | File | Problem |
|---|-------|------|---------|
| 14 | **Toast ignores safe area insets** | `questhub.css:623-625` | Hidden behind notch on iPhones |
| 15 | **Celebration animation overshoots** | `questhub.css:718` | Cubic-bezier overshoot makes text unreadable mid-anim |
| 16 | **Hero section misaligned on mobile** | `questprogress.css:363-366` | Column layout no gap adjustment |
| 17 | **Leaderboard hides columns silently** | `leaderboard.css:114+` | Mobile `display: none` with no indicator |
| 18 | **"You" indicator too small** | `Leaderboard.tsx:104` | `0.75rem` — users miss their own row |
| 19 | **Prerequisite chain items look clickable** | `QuestDetail.tsx:172-184` | Current item styled like interactive |
| 20 | **Locked state missing icon** | `QuestCard.tsx:56` | Just text "Locked" — no 🔒 icon |
| 21 | **CandidatureUnlock spacing in expanded hub** | `QuestProgress.tsx:188-191` | Overlaps with grid, no padding context |
| 22 | **Verify button missing disabled state** | `QuestDetail.tsx:204-223` | Double-submit possible |
| 23 | **Icon sizes inconsistent** | Multiple | 1.5rem vs 2rem vs 24px — no visual rhythm |
| 24 | **Border radius inconsistency** | Multiple | Mix of `12px`, `var(--radius-lg)`, `var(--radius-md)` |
| 25 | **Mixed color token systems** | Multiple | `--color-k-accent` vs `--color-primary` vs raw rgba |
| 26 | **SVG ring text hidden from screen readers** | `QuestProgress.tsx:41` | `aria-hidden="true"` on critical info |
| 27 | **Color-only status indication** | Multiple | Green/blue/red without text alternative |

---

## 3. Theme Toggle Design

### 3.1 Current Access Points

| Method | Location | Discovery |
|--------|----------|-----------|
| Settings page | `/settings` → Appearance section | Low — requires navigation |
| Cmd+K command | CommandPalette → "Toggle Theme" | Medium — power users only |
| Keyboard shortcut | Mentioned in Settings tip | Low — hidden |

### 3.2 Proposed: TopBar Theme Toggle Icon

**Placement:** TopBar right side, between Notification Bell and Network Selector.

**Design:**
- Icon-only button: ☀️ (Sun) in dark mode, 🌙 (Moon) in light mode
- Phosphor icons: `Sun` / `Moon` (already in the icon library)
- Subtle hover effect with tooltip: "Toggle theme (⌘K)"
- Single click toggles instantly
- Smooth icon transition (fade or rotate)
- Size: 18px icon, 32px clickable area

**Why TopBar:**
- Always visible on all desktop viewports (768px+)
- High-traffic area — users naturally look top-right
- Icon-only keeps it compact (no text needed)
- Consistent with notification bell pattern (icon button with action)
- Doesn't crowd the sidebar (which is already dense)

**Mobile:** On mobile (< 768px), the TopBar items collapse into the hamburger/More menu. The toggle should be added to the MobileTabBar "More" sheet as well — a simple "Dark / Light" pill toggle in the settings section.

### 3.3 Alternatives Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| Sidebar bottom | Rejected | Hidden when collapsed (56px), takes nav space |
| Floating button | Rejected | Clutters UI, overkill for single toggle |
| Footer | Rejected | Not always visible, low discoverability |
| **TopBar icon** | **Selected** | Best visibility/space tradeoff |

---

## 4. Implementation Sprints

### Sprint 1 — Theme Toggle (Quick Win)

**Effort:** 1-2h

```
1.1: TopBar theme toggle button
  File: TopBar.tsx
  - Add Sun/Moon icon button between notification bell and network selector
  - onClick: toggleTheme() from themeStore
  - Show Sun icon in dark mode (switch to light), Moon in light mode (switch to dark)
  - Tooltip: "Switch to light/dark theme (⌘K)"
  - CSS: .k-topbar-theme-toggle — 32px clickable, 18px icon, hover glow

1.2: Mobile More sheet toggle
  File: MobileTabBar.tsx
  - Add theme section to the More bottom sheet
  - Two-button pill toggle: "🌙 Dark" | "☀️ Light"
  - Highlight active theme, click to switch

1.3: Icon transition animation
  - Smooth fade (opacity 0→1, 150ms) when icon changes
  - Or subtle rotate (180deg) on toggle

1.4: Update Settings page hint
  - Replace "Tip: use Cmd+K" with "Tip: click ☀️/🌙 in the top bar, or use ⌘K"
```

### Sprint 2 — Quest UI Critical Fixes

**Effort:** 2-3h

```
2.1: CandidatureUnlock light theme fix
  File: candidatureunlock.css
  - Replace #0a0a0a button text → var(--color-bg) or keep #000 (black on teal is fine)
  - Replace hardcoded gradient (#555→#888) → var(--color-text-muted)→var(--color-text-secondary)
  - Test both themes

2.2: Progress ring text size fix
  File: questprogress.css:335
  - Increase from 8px → 11px minimum
  - Ensure ring SVG viewBox accommodates larger text

2.3: Difficulty colors → design tokens
  File: QuestCard.tsx:18-23
  - Replace hardcoded hex with CSS variables:
    beginner: var(--color-success)
    intermediate: var(--color-info)
    advanced: var(--color-warning)
    expert: var(--color-danger)

2.4: Glow effects light theme adjustment
  - Add [data-theme="light"] overrides for glow effects
  - Use darker shadow/border instead of rgba glow on light backgrounds
  - Or increase glow opacity for light theme

2.5: Locked state opacity fix
  File: questhub.css:201
  - Replace opacity: 0.6 → keep opacity: 1, use desaturated colors instead
  - Or use filter: grayscale(0.4) which preserves contrast
```

### Sprint 3 — Quest UI Typography & Spacing

**Effort:** 2-3h

```
3.1: Font size hierarchy cleanup
  - Quest card title: standardize to 13px, font-weight: 600 across both views
  - Quest description: increase from 10px → 12px, allow wrapping
  - Hero description: switch from JetBrains Mono to system-ui for body text
  - Completed strikethrough: use color dimming instead (more readable)

3.2: Spacing standardization
  - Quest grid gap: standardize to var(--space-3) = 12px (compromise between 6/16)
  - Card padding: standardize to var(--space-3) = 12px
  - Use design system spacing tokens consistently

3.3: XP tabular numbers
  File: questhub.css
  - Add font-variant-numeric: tabular-nums to XP display
  - Ensures digits align during counter animation

3.4: Icon size standardization
  - Quest card icon: 20px
  - Celebration icon: 28px
  - Ring icon: size prop (keep flexible)
  - Standardize via --quest-icon-sm/md/lg tokens
```

### Sprint 4 — Quest UI Polish & Mobile

**Effort:** 2-3h

```
4.1: Toast safe area insets
  File: questhub.css:623
  - Add padding-bottom: env(safe-area-inset-bottom, 24px)
  - Prevents toast from hiding behind iPhone notch

4.2: Leaderboard mobile improvements
  - Add "swipe for more →" hint when columns are hidden
  - Increase "You" indicator size to 0.875rem with accent color
  - Add horizontal scroll indicator

4.3: Quest card locked state
  - Add 🔒 icon before "Locked" text
  - Prerequisite chain: make current item visually distinct (not clickable)

4.4: Verify button protection
  File: QuestDetail.tsx
  - Add disabled state during verification
  - Show spinner alongside "Verifying..." text
  - Prevent double-click with ref guard

4.5: Celebration animation polish
  - Reduce overshoot in cubic-bezier
  - Add 200ms delay before text appears (let scaling finish)

4.6: Accessibility improvements
  - Remove aria-hidden from progress ring percentage text
  - Add aria-label to status badges with text description
  - Add focus-visible indicators on details/summary elements
```

---

## 5. Expert Review

### CSO
Theme toggle in TopBar is fine — no security concern. Quest difficulty colors using CSS variables is correct (prevents hardcoded values that could be manipulated via CSS injection in edge cases).

### UX/UI Expert
**TopBar toggle is the right call.** Users expect theme toggles in the top-right area (GitHub, VS Code, Discord all do this). Icon-only with tooltip is clean. The Sun/Moon swap is universally understood.

**Quest concerns:** The 8px ring text is a genuine accessibility failure. The font inconsistency between QuestHub and QuestProgress expanded view suggests the two were built separately and never harmonized — Sprint 3 addresses this correctly.

**Recommendation:** Consider a subtle transition on the entire page when theme toggles (100ms fade) to prevent the jarring flash of colors changing.

### Senior Fullstack Engineer
**Theme toggle:** The `toggleTheme()` function already exists in themeStore — integration is trivial. React state doesn't need to know about theme changes since CSS variables handle everything. Just re-render the icon after toggle.

**One concern:** `getTheme()` reads from DOM (`document.documentElement.dataset.theme`). In TopBar, you'll need to trigger a re-render when theme changes. Use a small `useState` + `useEffect` that listens to theme changes, or use `useSyncExternalStore` with the themeStore.

**Quest fixes:** The difficulty colors in QuestCard.tsx can use CSS variables in inline styles via `var()` strings — this works in React. No need to refactor to CSS classes.

### Mobile User
The More sheet toggle is essential. On mobile, the TopBar is compressed — the icon may not be visible. Having it in the More sheet (which is easily accessible via the bottom tab) is the right mobile pattern.

---

## 6. Sprint Execution Order

```
Sprint 1  Theme Toggle (TopBar + Mobile)    [1-2h]  ← Quick win, high visibility
Sprint 2  Quest Critical Fixes              [2-3h]  ← Light theme compliance
Sprint 3  Quest Typography & Spacing        [2-3h]  ← Visual consistency
Sprint 4  Quest Polish & Mobile             [2-3h]  ← Final polish

Total estimated: 7-11h
```

**Branch:** `feat/v4.1-quest-theme-polish`
**PR:** Single PR with all 4 sprints (cohesive change set).

---

*This plan will not be executed until explicit user approval is received.*
