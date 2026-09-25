# os/kit

Shared building blocks for Memba OS native app windows (mockup v4).

- `AppShell` — a window with a left-hand section nav (Settings-style apps: DAOs, multisig, wallet).
- `Table` — tabular data with sortable-looking headers and optional row click/Enter (holdings, proposals, members).
- `StatGrid` — a handful of small metrics in cards (balances, counts, totals).
- `Toggle` — a single on/off setting.
- `Loading` / `Empty` / `ErrorState` — the three states any async view can be in; use these, not ad-hoc markup.
- `NotOnMainnet` — wraps a feature that isn't live on gnoland-1 yet; still viewable, actions stay disabled.

Rules: one accent color per view, no emoji icons (use `Icon` from `../shell/icons`), only the OS states above (no bespoke spinners/banners), and container queries (`@container os-window`) for responsive layout — never viewport `@media` queries, since a window's size is unrelated to the browser's.
