# Memba design system — colors, theming & contrast

Single source of truth for color in the Memba frontend. The goal: **one token set, two themes, high contrast everywhere, zero hardcoded colors in components.**

## The rule

**Never hardcode a color in a component** (`.tsx` inline style or a component `.css`). Always use a `var(--color-k-*)` token. Hardcoded hex/`rgba()` are dark-assumed and become unreadable (or wrong) in light theme — this is the single biggest source of light-theme contrast bugs.

Exceptions (the only places a literal color is allowed): the token definitions in `index.css`; intentionally theme-independent surfaces (code-syntax highlighting, a category accent used as a *dot/border* not a text/background); chart series colors that are validated for both themes.

## Tokens (`frontend/src/index.css`)

Defined once on `:root` (dark, the default) and overridden in `[data-theme="light"]`. Every token has a light value — adding a token means adding **both**.

| Token | Role | Contrast target |
|-------|------|-----------------|
| `--color-k-bg` | page background | — |
| `--color-k-panel` / `--color-k-elevated` | surfaces / raised cards | — |
| `--color-k-edge` / `--color-k-edge-hover` | borders | ≥3:1 vs adjacent surface for meaningful borders |
| `--color-k-text` | primary text | **≥7:1** on bg (light: `#16161d` ≈15:1) |
| `--color-k-dim` / `--color-k-muted` | secondary text / eyebrows / hints | **≥4.5:1** on bg (light: `#4b5563` ≈7:1) |
| `--color-k-accent` (+ `-hover`, `-subtle`, `-tint`, `-border`) | **teal = community / Memba** | text-on-surface ≥4.5:1 |
| `--color-k-govdao` (+ tints) | **gold = Layer-1 governance (GovDAO)** | light uses darker gold `#9a7b1f` for legibility |
| `--color-k-amber` / `-warning` | warning / amber accents | ≥4.5:1 as text |
| `--color-k-danger` (+ tint/border) | destructive / errors | ≥4.5:1 as text |
| `--color-k-featured-bg` / `-border` | featured surface | — |

### Color semantics (locked)
- **Teal** = community / Memba surfaces.
- **Gold** = Layer-1 governance (GovDAO) — visually distinct from teal.
- **Amber/Danger/Success** = status only (warning / error / ok), never decorative.

## Contrast standard

Target **WCAG AA**: **≥4.5:1** for normal text, **≥3:1** for large text (≥18.66px bold or ≥24px) and meaningful UI borders/icons. Primary text aims higher (≥7:1). Tint backgrounds (`-subtle`/`-tint`) are for fills *behind* same-family dark text or as accents — never put low-contrast text on them.

When a token resolves to a colored fill (badge/pill/tag), text on it must use the **same color family's dark stop**, not black/gray.

## Adding or changing a color

1. Prefer an existing token. If none fits, add a `--color-k-*` token to **both** the `:root` and `[data-theme="light"]` blocks in `index.css`.
2. Verify both themes meet the contrast target (e.g. WebAIM contrast checker, or the audit below).
3. Use the token in the component. Do not inline the literal.

## Verifying (light theme especially)

- Local dev can serve **stale CSS** — verify on the Netlify deploy-preview (`deploy-preview-<PR>--memba-multisig.netlify.app`) or prod, in **both** themes, via Playwright.
- Automated: a light-mode contrast scan over each route flags any text node below 4.5:1 (see §13 of the redesign plan). Treat findings as bugs.

## Status (§13 sweep)

Light token contrast is AA-tuned (this doc + the `#4b5563`/`#16161d` bump). The remaining work is replacing the ~1,800 hardcoded color usages across components with tokens, audit-driven, area by area — tracked in `docs/planning/HOME_AAA_REDESIGN_AND_AUDIT_PLAN_2026-06-25.md` §13.
