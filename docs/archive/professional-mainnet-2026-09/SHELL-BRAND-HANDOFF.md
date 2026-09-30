# Professional shell and Folded M — review handoff

The next preview combines the selected **01 / Folded M** identity with a clearer navigation hierarchy. It follows the approved Quiet Confidence direction, System / Light / true Black theme policy, and Validators-first migration. This is a reviewable shell and asset package; the rest of Memba's feature bodies still need their planned migration.

## Authority, isolation and baseline

The user's subsequent “OK, continue autonomously” authorizes this next bounded implementation stage after the Validators pilot. This extends the earlier pilot-only scope into B1 artwork and P6 shell/navigation presentation. It does not authorize a merge, production rollout, package/realm deployment, or financial-operation changes.

- Branch: `feat/professional-shell-brand`.
- Worktree: `Memba-worktrees/professional-shell-brand`.
- Stacked base: `feat/validators-professional-pilot` at `a3f8559b` (PR #1195), on the theme foundation (PR #1194).
- Main was inspected at `08f8b04b`; this branch deliberately keeps its reviewed parent rather than refreshing the whole stack during unrelated dependency work. Integrate current main through the parent before merging the stack.
- Shared `/Memba`, other sessions' worktrees, network definitions, transaction code, contracts, wallet permissions and feature gates are untouched.

## Open the review

From this worktree's `frontend` directory:

```sh
npm ci
VITE_ENABLE_PRO_UI=true VITE_ENABLE_PRO_SHELL=true npm run dev -- --host 127.0.0.1 --port 5191 --strictPort
```

- `/mainnet/validators` — shell plus Validators pilot, reading the real configured network.
- `/mainnet/validators/hacker` — new navigation around the existing advanced-monitoring body.
- `/brand/folded-m/specimen.html` — actual-size brand specimen and downloadable SVG masters.

The development preview may report unavailable monitoring or undeployed contracts. Those states remain visible and truthful. Browser tests use synthetic fixtures, identified on captured Validators screenshots; fixtures are never imported by application code.

## Two independent presentation flags

| `VITE_ENABLE_PRO_UI` | `VITE_ENABLE_PRO_SHELL` | Result |
|---|---|---|
| unset / false | unset / false | Existing production presentation |
| true | unset / false | Existing Validators-only pilot |
| unset / false | true | New shell; existing feature bodies |
| true | true | New shell plus the exact Validators overview pilot |

Both flags require the literal string `true`. Neither enables capabilities. `.k-pro-shell` introduces only shell-specific tokens; it does not alias global feature-body colors or change their content widths. `.k-pro-ui` retains its existing exact known-network Validators overview allowlist. Advanced monitoring, DAO, treasury and other bodies are not automatically restyled.

## Navigation contract

Routes, icons, authorization metadata and availability flags continue to come from `navManifest.ts`. `proNavigation.ts` owns presentation order and grouping. A coverage test fails if a new manifest entry is not deliberately mapped.

| Group | Destinations | Access |
|---|---|---|
| Top | Search, Home | Public; Search opens the existing command palette |
| Workspace | DAOs, Tokens, Multisig, Organizations | Last two retain wallet requirement |
| Network | Validators, Alerts | Public |
| Explore | Directory, App Store, Marketplace, Feed | Existing unavailable-feature gates and “soon” labels |
| Community | Gnolove, Quests, Leaderboard, Reputation, Blog | Desktop disclosure; existing Reputation gate |
| Account & help | Profile, Settings, Candidature, Extensions, Feedback, Changelogs, Quest Admin | First three retain wallet requirement; Profile appends address; admin retains its existing address gate and desktop-only placement |

The retired Dashboard destination is omitted in this presentation; Home and the brand link both lead to the network's home for visitors and members. This does not delete its legacy redirect or change the legacy navigation manifest.

Community and Account & help use native keyboard-operable disclosures on desktop. A route in a group opens it automatically. A route change resets disclosure state; no new persisted preference is introduced. Collapsing the sidebar initially opens both groups so every icon remains reachable. Labels remain accessible and have title tooltips. A boundary-aware route match avoids treating `/validators-extra` as a Validators child.

Mobile uses **Home / DAOs / Tokens / Directory / More** for both visitors and members. More contains the same eligible groups after primary links are removed. Feed reply counts appear in More and its Feed row. Organizations, Candidature and Leaderboard become discoverable on mobile, where the legacy overflow lists omitted them. Existing DAO-dependent plugins, Theme, Network and the connected-member Act action remain available.

The preview menu includes a visible Close button, Escape dismissal, keyboard focus wrapping and focus return when focus is still inside the closing menu. Opening the command palette can transfer focus to that dialog without the old menu stealing it back. The legacy menu's default presentation remains unchanged.

## Shell specifications

| Property | Black | Light |
|---|---|---|
| Canvas | `#000000` | `#ffffff` |
| Primary text | `#f5f7f6` | `#17221e` |
| Secondary text | `#adb5b2` | `#52615a` |
| Border | `#303735` | `#dbe2de` |
| Active / focus | `#00d4aa` | `#006e57` |
| Hover / active fill | `#101715` | `#f3f7f5` |

- Desktop sidebar: 240 px expanded, 76 px collapsed; independent scroll area below a 76 px brand header.
- Navigation labels: Inter 14 px / 500; group labels 12 px; desktop links at least 40 px high. Mobile menu rows and controls at least 44 px; native mobile inputs/selects 16 px.
- Mobile: existing 768 px shell breakpoint; five primary slots. Existing tablet overlay behavior is retained at 769–1024 px.
- Focus: 2 px accent outline with 2 px offset. Reduced-motion media preference removes shell/sheet transitions.
- Body width/density and the existing deployment, wallet and network status content remain owned by their respective components.

## Folded M asset contract

Assets live in `frontend/public/brand/folded-m/`. This is a controlled vector reconstruction of the selected concept, not a claim that the raster proposal contained an original vector master.

- Silhouette: 112 × 100 unit grid, 25-unit legs, 56-unit center axis, upper valley at y=45 and lower fold at y=79. Square SVG viewBox includes padding; no shadows or gradients.
- Facets: `#00d4aa`, `#009d80`, `#54ebcb`. White and black versions preserve the identical silhouette.
- Clear space: at least one leg width (25 shape units) outside the visible mark in composed artwork. The square asset's built-in padding is not a substitute for surrounding layout space.
- Minimum specimen sizes: 16, 24, 32 px. `favicon.svg` uses one-color teal on dark browser chrome and a darker teal on light chrome. Prefer monochrome at the smallest sizes or where color reproduction is unreliable. Never stretch, round the corners or add a container to the standalone mark without a documented use case.
- Wordmarks: Inter 600, converted to paths from the bundled font; no external font loading in exported SVGs. Preserve the existing Inter OFL notice. `generate-brand.py` regenerates the outlined lockups and sharing master with the authoring-only `fonttools[woff]` dependency.
- App icon: black 512 × 512 canvas, centered mark. Its furthest silhouette corner is about 188 px from center, inside the 204.8 px mask-safe radius.
- Sharing master: 1200 × 630, outlined typography, proposed copy “Govern together. Build on gno.land.” No live balances, security certification or mainnet-capability claims.
- PNG renditions are exported from the vector masters by the browser test lane, not created by image tracing. `share.png` is suitable for a later metadata integration. After copying browser screenshots/renditions, run `prepare-review-assets.py` to remove nonvisual PNG metadata while preserving pixel/color chunks, then run the repository attribution check.

Existing favicon, PWA manifest, Apple touch icon and Open Graph metadata references are not replaced. Brand activation should be its own small follow-up: wire approved filenames, verify crawler responses and image dimensions for canonical/network/DAO/proposal URLs, then review cached social cards. Entity cards should name the entity and network with a readable fallback for long names and unavailable entity data. Do not suggest that a page has mainnet capability merely because its card has the new identity.

## Validation and rollout gates

See `SHELL-BRAND-REVIEW.md` for the final observed checks and screenshots. Browser checks cover both themes, desktop/phone engines, 320–1920 px layouts, keyboard disclosures/search/menu behavior, focus return, route isolation, assets and scoped accessibility scans. Unit checks cover every manifest entry, visitor/member/admin visibility, profile addressing, badges and legacy flag-off navigation.

Automated accessibility checks are not a screen-reader certification. Before production activation, perform VoiceOver/NVDA reading-order checks, actual browser zoom and text scaling, a physical iOS/Android pass, and a connected-wallet smoke pass on an appropriate non-production network. Review especially long member navigation, tablet overlay dismissal and menu-to-command-palette focus transfer.

## Safe continuation method

1. Review this shell/brand slice independently from the earlier theme and Validators PRs. Keep theme preferences, presentation flags and capability gates separate.
2. Reconcile shared-shell edits with other sessions through the isolated parent stack. Keep one owner for `Layout`, `Sidebar`, `MobileTabBar`, navigation presentation and shell tokens in each slice; route owners should not edit those files concurrently.
3. Add a small task record before each body migration: route allowlist, owned files, preserved data/actions, empty/loading/error cases, acceptance checks, screenshot evidence, parent commit and rollback.
4. Migrate one feature family at a time behind a default-off allowlist. Recommended next body slice: DAO overview and proposal reading/voting presentation, with treasury entry points reviewed for truthful readiness. Preserve transaction construction, signing, permission checks and realm deployment work as separate ownership.
5. Use existing data fixtures and interactions as the behavioral baseline. Test meaningful state transitions and route boundaries; avoid snapshots that merely mirror CSS implementation.
6. Merge only after the relevant review gates. Disable the shell flag to return to legacy navigation; disable the Validators flag separately to return to its legacy body. No destructive preference migration exists.

Broader Home, DAO, treasury, token, marketplace, directory, community, account and advanced-monitoring body migrations remain on the original audit roadmap. This slice does not claim their redesign is complete.
