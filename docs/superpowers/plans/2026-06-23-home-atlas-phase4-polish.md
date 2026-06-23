# Home Atlas Redesign — Plan 4: Polish + follow-ups

> Frontend-only. No backend, no deploy. Branch `feat/home-polish` (off `main`@8f0b078, with Phases 0–2 merged). Subagent-driven, per-task review.

**Goal:** Clear the accumulated deferred follow-ups + the small polish items the visitor/member homes deserve — token cleanups, fonts, app-shell light parity, footer legibility, motion. No new features; no backend.

## Global Constraints
- Kodera tokens only; light + dark parity; teal=signal; mono=machine-truth; lowercase labels.
- a11y: real `<a>`/`<button>`, focus-visible, `prefers-reduced-motion` respected; no contrast regressions.
- Reuse existing primitives (`Door`, etc.). No backend/Go changes; no deploy. No new deps unless trivial + justified (self-hosting fonts may add a dev dependency or vendored font files — that's fine).
- Don't change behavior/IA of the shipped visitor/member homes — this is polish.
- Branch `feat/home-polish`; per-task commits; ZERO Claude attribution; no push without approval; never merge without approval.
- Verify per task: `cd frontend` → `npm run test`, `npm run build` (tsc+vite), `npm run lint`. Visitor home is preview-verifiable (logged-out); member home is not (needs wallet) — rely on tests + mockup for member-only changes.

## Task 4.1 — Component + token cleanups (the deferred follow-ups)
Small, related cleanups carried over from Phase 1/2 reviews:
1. Add `--color-k-danger-tint` + `--color-k-danger-border` tokens (`index.css` `:root` + `[data-theme="light"]`) and replace the quick-vote `rgba(255,71,87,…)`/`rgba(220,38,38,…)` literals in `home.css` (`.quick-vote-btn--no`) with them.
2. `ActionInbox` "all caught up" — render it through the `Door` primitive (`variant="action"`, empty-ish state) instead of the raw `.action-door--caught-up` div, for consistency. Keep the text + a11y.
3. `useYourWorlds` — expose a `refetch` (invalidate/refetch the per-world queries) and wire `YourWorldsPanel`'s error-state `onRetry` to it (currently a no-op).
4. Remove the unused `useOutletContext` call in `YourWorldsPanel`.
5. `NetworkHealthDoor` + `DirectoryDoor` — they accept a `networkKey` prop but re-derive from `useNetwork()`. Either use the passed prop for their hrefs (consistent with the other doors) or drop the prop from their signatures + the `ShowcaseBoard` call. Pick one; make it consistent.
- TDD the `refetch` (assert error onRetry calls refetch). Mechanical for the rest. Verify build/lint/test. Commit `chore: home polish — danger tokens, caught-up Door, your-worlds refetch, prop tidy`.

## Task 4.2 — Self-host fonts
- Inter + JetBrains Mono are loaded via render-blocking Google Fonts `<link>` (`index.html`). Self-host them (vendored woff2 + `@font-face`, or `@fontsource/*` dev deps) to remove the external render-blocking dependency + the CSP/offline fragility. Keep the same families/weights actually used (Inter 300–700, JetBrains Mono 400–600 — trim to used weights). Verify the fonts still render (preview the visitor home) + build/lint/test. Commit `perf: self-host Inter + JetBrains Mono (drop render-blocking Google Fonts)`.

## Task 4.3 — App-shell light parity + footer legibility + motion
1. **Sidebar light-mode parity:** verify whether the left sidebar (`Layout`/`Sidebar`) renders dark in light theme; if it's an unintended dark-only gap (not a deliberate choice), make it read from Kodera tokens so it respects `[data-theme="light"]`. (If it's intentional dark-rail design, leave it + note.)
2. **Footer legibility:** the alpha-disclaimer footer text is ~9px (unreadable on mobile) — bump to a legible size (≥11px) with adequate contrast (tokens).
3. **Motion:** add tasteful, `prefers-reduced-motion`-safe entrance/hover transitions where they elevate the home (door hover, CTA hover) — subtle, not flashy. Skip if already adequate.
- Preview the visitor home (light+dark, desktop+mobile) for the sidebar/footer changes. Build/lint/test. Commit `polish: sidebar light parity + footer legibility + subtle motion`.

## PR
- After tasks + preview: push `feat/home-polish`, open PR to `main`. Do NOT merge without explicit approval.
