# os/kit

Shared building blocks for Memba OS native app windows (mockup v4).

- `AppShell` — a window with a left-hand section nav (Settings-style apps: DAOs, multisig, wallet).
- `Table` — tabular data (holdings, proposals, members). Columns with `sort` get real sortable headers (`aria-sort`, none → ascending → descending); `pageSize` adds a pager; `onRowClick` needs `rowLabel` (the open button's name) and opens through a real button in `openColumn` (default: the first column).
- `StatGrid` — a handful of small metrics in cards (balances, counts, totals).
- `CardGrid` / `Card` — a responsive grid of small cards (DAOs, apps, collections); `Card` is a button only when it has `onClick`.
- `Segmented` — a few views of the same thing (Day / Week / Month); `Chips` — filters with optional counts (All / Open 3).
- `Pill` — a one- or two-word status, toned `ok` / `warn` / `err` / `neutral`; `Gate` — the slim bar saying why an action is off and what unlocks it.
- `Toggle` — a single on/off setting.
- `Loading` / `Empty` / `ErrorState` — the three states any async view can be in; use these, not ad-hoc markup.
- `NotOnMainnet` — wraps a feature that isn't live on gnoland-1 yet; still viewable, actions stay disabled.

Rules: one accent color per view, no emoji icons (use `Icon` from `../shell/icons`), only the OS states above (no bespoke spinners/banners), container queries (`@container os-window`) for responsive layout — never viewport `@media` queries, since a window's size is unrelated to the browser's — and both themes come from the `--os-*` tokens (never hard-coded colours).
