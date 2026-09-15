# Validators — light and true black proof

Status: first proof following D-01 through D-06; ready for discussion, not implemented.

![Validators in Light and Black](assets/validators-light-black-v1.png)

The visual order is the same in both themes: network/account context, page purpose, tabs, compact metrics, search/filter controls, then the table. The information uses the available width instead of sitting inside nested narrow containers.

## Theme contract

**System** is the default preference. It resolves to Light or Black and follows OS changes while the app is open. An explicit Light or Black choice overrides the OS until the user chooses System again. Preserve previous explicit light/dark choices during migration; treat a stored legacy dark choice as Black in the new preference UI. The existing internal resolved `data-theme="dark"` value can remain for compatibility; preference and rendered theme should be separate concepts.

The existing `themeStore.ts` already consults system preference at startup when no preference is stored. The gap is an explicit System option and ongoing synchronization, not an absence of system detection.

Black means `#000000` for the page canvas, sidebar, topbar, ordinary panels and table. Separate regions using spacing, thin neutral rules, focus outlines and typography. Gray can be used for readable secondary text and borders; it must not become the large surface color. No blue-tinted black, slate panels, glow or glass. Menus/dialogs can retain black fills with stronger outlines; layered interactions need clear boundaries and focus treatment.

Light stays within A's neutral canvas/white surface direction. Both themes have independently validated foreground, focus and status colors; do not merely invert the palette. The generated raster is illustrative, not a pixel-accurate color or contrast specification; the written `#000000` contract is authoritative.

## Desktop proposal

| Area | Proposed behavior |
|---|---|
| Header | Validators, selected network and wallet state; preserve existing availability/mismatch notices. No invented secure/synced certification. |
| Tabs | Validators, Candidates, Network nodes. Preserve current route/query behavior, keyboard interaction and counts from actual sources. “Advanced telemetry” can relabel the existing hacker-view entry while preserving its URL. |
| Summary | Four compact metrics: active count, voting power, block height and block time. Peer/node information remains in its own tab. An actual health exception appears above the list when relevant. |
| Default table | Identity, health, voting power, share, participation, uptime, explicit detail link. Sortable columns use accessible buttons and announce sort state. |
| Toolbar | Existing search/page size/pagination retained. Health filter and column chooser are explicit new presentation behaviors, separately scoped and tested. |
| Details | Use the existing validator detail route first. Do not introduce a drawer, new query or new data service simply for visual effect. |
| Wide/expert columns | Preserve active-since, profile/source link, reviews, missed blocks, transaction contribution, last downtime and signature history. Make these reachable via optional columns and/or the existing detail route; verify exact mapping before any column is hidden by default. |

Participation and uptime remain distinct because their data sources/windows can differ. Do not rename, aggregate or recompute them during the redesign. Defaulting to an easier-to-scan view must not remove operator comparisons. The small four-row sketch is not sufficient to validate a large roster.

Show full identity through existing copy/source/details interactions. Keep table row semantics and avoid making the whole row an ARIA button around nested controls; the existing `Validators.table.test.tsx` specifically protects this behavior.

## Responsive and state specification proposal

- **Wide desktop / 1,920 px:** fluid workspace with measured gutters; table and controls fit the usable area. Numeric columns align right.
- **Desktop / 1,440 px:** default columns fit without horizontal scrolling; expert columns may scroll within the table with identity pinned. Keep the entire application within the viewport.
- **Laptop / 1,280 px:** explicitly verify the width failure found during the audit. Collapse navigation when appropriate and reduce secondary columns before reducing readability.
- **Tablet / 768 px:** adapt toolbar and metric wrapping; choose table/list layout based on actual available content width.
- **Mobile / 390 px, plus 320 px reflow:** title, compact health/summary and search before the first validator. List items show identity, health, voting power/share and uptime, with clear detail access. Participation and other metrics remain accessible. Avoid a full viewport of stacked summary cards.
- **Loading:** preserve page structure with a bounded list skeleton; separate initial loading from background refresh.
- **Stale or partial telemetry:** retain known rows, label their freshness accurately and mark unavailable fields as unknown rather than zero or healthy.
- **Empty and no search results:** explain which case occurred; retain controls and clear-filter recovery.
- **Unavailable network/RPC:** distinguish missing data from missing feature capability and wallet mismatch; preserve current guards.
- **Polling:** preserve selected filters, pagination and focus. Any change to automatic sorting/reordering needs explicit behavioral review; never silently change the comparator or polling interval.

## Proof limitations and review criteria

The image uses illustrative addresses, numbers, health labels and connection state. It does not certify actual validator health. Tiny raster differences, centered numeric cells and simplified toolbar/footer are drawing artifacts: the written specification requires right-aligned numbers, the existing page-size/pagination controls, actual health definitions and all supported states.

The Black view is a theme of A, not a return to the earlier B visual direction. The proof intentionally uses the Memba wordmark without a new logo so UI approval and branding approval can proceed independently.

Review this proof for readable density, true-black character, desktop space use and the balance of default versus expert information. Mobile behavior and failure-state frames remain design validation work before rollout; they have not been measured or approved by this board.

Generation method: built-in image tool; exact prompt in [PROMPTS-ROUND-2.md](PROMPTS-ROUND-2.md).
