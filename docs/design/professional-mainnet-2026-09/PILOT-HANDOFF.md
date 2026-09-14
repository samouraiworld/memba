# Professional Validators pilot — implementation handoff

Scope: P0–P5 prototype review following the authorized direction A and System / Light / Black theme policy. Selected branding 01 / Folded M remains a separate workstream.

Initial base: `98b8b762`. Refreshed to `d49896a1` through theme foundation `d3028e88` (#1194), preserving the landed validator page-size accessibility fix and protobuf update. The overlapping page-size label is included once. Branch `feat/validators-professional-pilot`, worktree `Memba-worktrees/validators-professional-pilot`. Shared `/Memba` checkout and other sessions' worktrees were not modified.

## Run and review

From this branch's `frontend` directory:

```sh
npm ci
VITE_ENABLE_PRO_UI=true npm run dev -- --host 127.0.0.1 --port 5188 --strictPort
```

Open `http://127.0.0.1:5188/mainnet/validators` or `/pearl/validators`. These pages read the real configured network. No fixtures enter ordinary runtime paths. The local preview currently has no custom monitoring environment configured, so mainnet may display raw addresses and explicitly unavailable monitoring metrics. This is distinct from fixture screenshots.

Run the deterministic browser proof with `npm run test:e2e:pro-ui`. It starts its own flag-on server on port 5189, rejects occupied ports, and fulfills network reads in Playwright. Screenshot headings identify **Test fixture**. The helper is under `frontend/e2e/helpers/proValidatorsFixture.ts`; never import it into application source.

The default build has no enabled presentation flag. The allowlist is exact known-network `/validators` overview routes, including their existing query tabs. Home, DAO, treasury, profile and hacker routes retain their existing presentation. The scoped stylesheet loads with the lazy Validators route.

## Implemented presentation contract

- Fluid available desktop width with 32px gutters (24px at smaller desktops).
- Black canvas, navigation, standard cards and table: `#000000`. Light canvas: white. Borders, readable secondary text and interaction feedback supply hierarchy.
- Compact five-metric desktop strip; mobile Network overview disclosure retains all stats and health details while bringing search/list forward.
- Primary desktop columns: rank, identity, voting power, share, uptime when monitoring exists, health and recent signatures. **All columns** restores active-since, profile/reviews when available, participation, missed blocks, transaction contribution and last downtime. Hiding an actively sorted optional field resets sorting to visible rank.
- Preserve native table rows, native sort buttons/announcements, nested links/copy buttons, pagination and URL tab state. Long addresses may truncate visually beside an exact copy action and full detail link.
- Health filter: All / Healthy / Degraded / Down / Unknown, using the existing health engine. Search and health filters compose; changing either resets pagination. Clear filters resets both. Degraded/down/unknown reasons are visible in desktop rows.
- Distinct empty network roster / empty filter messaging, contextual first-load error with expandable technical details, retained data with a visible failed-refresh message, and missing-monitoring explanation. The page title and network remain visible while the initial roster loads.
- No data query, endpoint, polling cadence, signature window, health computation, transaction, authentication or capability-gate changes.

## Review boundary and delegated decisions

The user authorized autonomous pilot completion with review at the end. The pilot uses seven primary columns (six without uptime), grouped All columns, and a collapsed mobile overview. Health filtering is implemented. Per-column configuration, saved layouts and density settings are intentionally deferred: they add preference state and complexity before real usage demonstrates a need. This is a reversible design choice, not an unresolved blocker.

This completes the working Validators pilot, not the full-product migration. Folded M production vectors/favicon/social artwork, new navigation, DAO/treasury and other feature families remain separate workstreams in the implementation plan. The selected mark remains 01 / Folded M; the current runtime logo is unchanged.

Automated checks do not substitute for manual screen-reader review, physical-device testing, browser zoom testing, or role-specific connected-wallet shell review. Those are rollout gates. No throughput/performance claims are made from fixture roster counts. Network/Candidates integration is preserved and tab navigation tested; their complete visual/state redesign is outside this roster pilot.

Rollback: keep `VITE_ENABLE_PRO_UI` absent/false; or revert this bounded presentation PR. Theme preference behavior is independently reviewable in #1194. No contract migrations or persistent validator-state migrations are needed.

## Tokens and responsive handoff

| Token | Black | Light | Purpose |
|---|---|---|---|
| `--pro-canvas` | `#000000` | `#ffffff` | Main surfaces, table, shell |
| `--pro-text` | `#f5f7f6` | `#17221e` | Primary text |
| `--pro-secondary` | `#adb5b2` | `#52615a` | Secondary text and labels |
| `--pro-border` | `#303735` | `#dbe2de` | Dividers and groups |
| `--pro-control-border` | `#68736f` | `#78867e` | Input boundaries |
| `--pro-accent` | `#00d4aa` | `#006e57` | Actions and focus |
| `--pro-hover` | `#101715` | `#f3f7f5` | Local interaction feedback |

Typography uses the existing sans font, with 30px desktop / 26px mobile titles, 14px table text, 13px column headings and 12px supporting metadata. Numerical columns use tabular numbers. Existing semantic health colors remain intact. Incident/status labels explicitly use 12px, pagination uses 13px, and the resolved incident fill is darkened to #007f59 for white-text contrast. Mixed-state and resolved-incident axe checks cover both themes.

| Width | Layout and controls |
|---|---|
| 1280px+ | 32px content gutters; table uses available width up to 1920px; default columns fit in tested fixtures. |
| 769–1279px | 24px gutters; reduced cell padding; table scrolling may remain contained within the comparison region. Identity stays pinned. |
| ≤768px | Existing shell gutters govern; cards replace rows; overview starts collapsed; cards paginate at 25; controls use 16px text and 44px minimum height. |

Layout widths, spacings and radii remain scoped pilot CSS rather than a published shared component API. Consolidate these into reusable spacing/type tokens when the design is approved for a second feature family.

## Interaction and state contract

| State / action | Behavior |
|---|---|
| Initial load | Visible page/network context and existing loading indicator; no fabricated rows. |
| Initial failure | Heading, short recovery message, expandable technical details and Retry. |
| Failed refresh | Last successful roster remains, with a visible notice and Retry. No claim that retained data is fresh. |
| Monitoring absent, signatures available | Metrics remain unavailable; health may still be derived from signatures. |
| No health signals | Unknown; unavailable numeric cells remain dashes, never manufactured zeroes. |
| Empty network | “No validators returned”, distinct from active filters returning no matches. |
| Search / health change | Reset page to 1; result count uses a status region. Clear filters resets both controls. |
| All columns | Reveals secondary metrics; hiding an active optional sort resets to ascending rank. No preference persistence. |
| Wide table | Focusable labelled region supports keyboard scrolling; identity column remains pinned. |
| Long identity / health reason | Name and reason wrap; secondary address may ellipsize with exact copy/detail access. |
| Sort / tabs | Native buttons; `aria-sort`; arrow-key tab navigation and URL state retained. |
| Mobile overview | Native details/summary with Enter/Space; all metrics remain accessible inside. |
| Reduced motion | Pilot animations/transitions disabled; status never depends on animation alone. |

## Local verification (2026-09-14, before the final mainline refresh)

- `npm test -- --maxWorkers=4`: 504 files passed, 5,017 tests passed; one existing skipped test.
- `npm run build`, `npm run lint`: passed. The final presentation refinements and inherited mobile-header correction were followed by a fresh build/lint and all 34 browser cases passing.
- `npm run test:e2e:pro-ui`: 34 passed across Chromium, Firefox, iPhone/WebKit and Pixel. Checks cover 320/390/768/769/1024/1280/1440/1920px, default desktop table fit, black surfaces, mobile disclosure, optional columns, search/reset, sorting and deep-link tabs. Axe scans of the changed main content pass in both Light and Black (healthy and mixed healthy/degraded/down/unknown fixture states).
- Background refresh failure retains the last roster; pending first load, empty roster and first-load retry recovery have focused component coverage. Browser tests cover missing monitoring/signatures, explicit Unknown filtering, 73-row pagination, filter/page-size resets, and actual horizontal keyboard scrolling with sticky identity.
- Theme foundation #1194: full backend build/race suite and protobuf lint passed on the same backend/proto tree. No backend/proto files changed in this pilot.
- Live mainnet read-only inspection at 1440px and 390px confirms real roster rendering and explicit missing-monitoring presentation. No wallet transaction or authentication flow was exercised.
- Relative to P1, the Validators route CSS adds 1.78 kB gzip (4.35 → 6.13), route JS adds 0.93 kB gzip (9.40 → 10.33), and the main JS bundle adds 0.13 kB gzip (119.41 → 119.54). The main CSS bundle is unchanged. These are build-size observations, not load-time or rendering benchmarks.

The results above describe the verified `ac89cb0e` presentation before the mainline refresh. Build, lint, unit and browser checks are being repeated on the refreshed tree; the final PR test plan and consolidated design REVIEW.md record those results. No backend/proto files changed in the refresh.

The dedicated Professional preview workflow also runs on stacked PRs (the general CI workflow only targets main/dev/v2). It runs lint, the full unit suite, a default production build, and four-browser flag-on proof, with screenshots retained as CI artifacts. See the PR for the current remote result. No merge is authorized by this handoff.

The final mobile controls use 16px text to avoid iOS input zoom. The stricter clipping audit excludes only the two intentional screen-reader-only labels; it checks the rendered shell and content for hidden horizontal clipping.
