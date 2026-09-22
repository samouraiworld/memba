# C1 discovery evidence — 2026-09-22

## Release status

All three C1 implementation PRs (#1239, #1240 and #1241) are merged and production-verified. A+B remains closed. No wallet, signature, broadcast, publication or deployment-policy change was exercised.

Catalog PR #1239 merged at 07:55:57 UTC as `25ef19793528747d99cafeaf4b1c72605e74a6b7`. Production `/build-info.json` subsequently reported that commit and `assets/index-DmSLVy3n.js`; the same entry was observed in both browser tabs. A tab loaded before rollout received the new catalog after an ordinary reload, retained `boards2/v0` search across another reload, and showed one correct mainnet result. A newly opened tab correctly gated `/mainnet/apps/submit`; its “Browse ecosystem projects” link opened all seven records without registry publishing navigation. This is a fresh-tab and returning-tab check in one browser profile, not a clean-profile or real-wallet claim. Initial rollout sampling still served the previous commit; it converged without manual deployment.

The catalog's preview and pre-merge head were `0961f44668aab6bd93e88b2a673f684d93eb6162`, entry `assets/index-DmSLVy3n.js`. Independent CTO/SWE reviews and all hosted checks, including both complete-design matrices, passed before merge.

Directory was refreshed onto the merged catalog. Two additive test conflicts in `complete-design.spec.ts` and `networkPins.test.ts` were resolved by retaining both sections; no runtime conflict or deployment-owned file changed. Refreshed integration checks are recorded below before release.


## Directory production verification

PR #1240 merged at 08:59:34 UTC as `a65800118e50c83db1fed18578d57bfd658a2177`. Production build-info and actual script entry match `assets/index-Cey-zz9V.js`. A returning tab initially loaded the prior catalog entry, then received the Directory release after an ordinary reload. It showed the mainnet partial-coverage notice and zero invented packages; searching Boards opened exact `r/gnoland/boards2/v0` in Explorer, and Back retained `q=Boards`. A fresh tab on the same profile showed the current entry and all three explicitly labeled mainnet editorial realms. No clean-profile or wallet claim is made.

The reliability branch was rebased onto this merged main. Only its two prepared commits were replayed; additive evidence/browser sections were retained and the released source-button contrast fix remains intact. All previously reviewed reliability runtime files remain byte-identical apart from that inherited two-line Directory CSS correction.

## Directory source boundary

The old Gnolove package record has no validated chain identifier. Directory does not merge it into selected-network realm/package results. Two bounded gnoweb namespace reads require matching chain metadata. They establish listing provenance, not successful realm rendering or transaction readiness. A failed read keeps editorial/reference entries available with a partial-coverage notice and retry. The existing document CSP excludes bare `gno.land`, so mainnet namespace reads currently fail into the editorial fallback. C1 does not change CSP or proxy behavior; Pearl fixtures cover successful namespace reads. Results are cached per network for five minutes; there is no polling or per-card fan-out.

Mainnet editorial realm source pages below were checked over HTTPS with certificate verification on 2026-09-22. HTTP success establishes source reachability on `gnoland-1` at that time only. The finite historical seed audit shows why legacy references are omitted from mainnet. They remain labeled unverified references on test networks. The user registry path is derived from selected-network configuration and is not asserted as a mainnet seed.

| Source page | HTTP | Mainnet metadata |
|---|---:|---|
| [gno.land/p/demo/avl](https://gno.land/p/demo/avl$source) | 404 | gnoland-1 |
| [gno.land/p/demo/boards2](https://gno.land/p/demo/boards2$source) | 404 | gnoland-1 |
| [gno.land/p/demo/dao](https://gno.land/p/demo/dao$source) | 404 | gnoland-1 |
| [gno.land/p/demo/entropy](https://gno.land/p/demo/entropy$source) | 404 | gnoland-1 |
| [gno.land/p/demo/grc/grc1155](https://gno.land/p/demo/grc/grc1155$source) | 404 | gnoland-1 |
| [gno.land/p/demo/grc/grc20](https://gno.land/p/demo/grc/grc20$source) | 404 | gnoland-1 |
| [gno.land/p/demo/grc/grc721](https://gno.land/p/demo/grc/grc721$source) | 404 | gnoland-1 |
| [gno.land/p/demo/json](https://gno.land/p/demo/json$source) | 404 | gnoland-1 |
| [gno.land/p/demo/membstore](https://gno.land/p/demo/membstore$source) | 404 | gnoland-1 |
| [gno.land/p/demo/ownable](https://gno.land/p/demo/ownable$source) | 404 | gnoland-1 |
| [gno.land/p/demo/pausable](https://gno.land/p/demo/pausable$source) | 404 | gnoland-1 |
| [gno.land/p/demo/seqid](https://gno.land/p/demo/seqid$source) | 404 | gnoland-1 |
| [gno.land/p/demo/simpledao](https://gno.land/p/demo/simpledao$source) | 404 | gnoland-1 |
| [gno.land/p/demo/uassert](https://gno.land/p/demo/uassert$source) | 404 | gnoland-1 |
| [gno.land/p/demo/ufmt](https://gno.land/p/demo/ufmt$source) | 404 | gnoland-1 |
| [gno.land/r/demo/grc20reg](https://gno.land/r/demo/grc20reg$source) | 404 | gnoland-1 |
| [gno.land/r/demo/worx](https://gno.land/r/demo/worx$source) | 404 | gnoland-1 |
| [gno.land/r/faucet/admin](https://gno.land/r/faucet/admin$source) | 404 | gnoland-1 |
| [gno.land/r/gnoland/blog](https://gno.land/r/gnoland/blog$source) | 200 | gnoland-1 |
| [gno.land/r/gnoland/boards2/v1](https://gno.land/r/gnoland/boards2/v1$source) | 404 | gnoland-1 |
| [gno.land/r/gnoland/faucet](https://gno.land/r/gnoland/faucet$source) | 404 | gnoland-1 |
| [gno.land/r/gnoswap/v1/router](https://gno.land/r/gnoswap/v1/router$source) | 404 | gnoland-1 |
| [gno.land/r/gov/dao](https://gno.land/r/gov/dao$source) | 200 | gnoland-1 |
| [gno.land/r/gov/dao/v2](https://gno.land/r/gov/dao/v2$source) | 404 | gnoland-1 |
| [gno.land/r/samcrew/tokenfactory_v2](https://gno.land/r/samcrew/tokenfactory_v2$source) | 404 | gnoland-1 |
| [gno.land/r/gnoland/boards2/v0](https://gno.land/r/gnoland/boards2/v0$source) | 200 | gnoland-1 |
| [gno.land/r/gov/dao](https://gno.land/r/gov/dao$source) | 200 | gnoland-1 |

## Validation limits

Namespace fixtures test both mainnet and Pearl, missing/mismatched chain identity, successful empty results and failed reads. Browser fixtures are offline data and do not prove real-wallet behavior. The bounded reliability and accessibility pass is a separate C1 slice; do not infer it from the provenance changes.

## Directory integration after catalog merge

- Refreshed onto main `25ef19793528747d99cafeaf4b1c72605e74a6b7`; both additive test sections and test-only pin inventory entries retained.
- 125 focused unit/component tests passed, covering catalog/gate, directory provenance, network pin inventory, namespace identity and exact search navigation.
- 12 combined catalog/Directory mainnet/Pearl journeys passed across Chromium, Firefox and iPhone WebKit; six additional Explorer-enabled Directory journeys passed.
- Lint, TypeScript/production build and bundle isolation/precache checks passed with Node 22. Previous complete Directory suite: 5,658 passed, one existing skip. Fresh hosted checks remain authoritative for the refreshed revision.
- Local logs: `/private/tmp/memba-c1-directory-refreshed-{unit,navigation-unit,browser,explorer,build}.log`. Browser fixtures remain read-only and do not validate wallet transactions.

## Hosted contrast regression and correction

The refreshed `e5b0ee30` design matrix failed its dark 390px and 1600px group-4 cases (75 other cases passed). Package “View source” buttons reused the link styles without an explicit background, allowing Chromium's default grey button face (`#6b6b6b`) beneath teal text (`#00d4aa`): measured contrast 2.79:1. Both Directory and the legacy Explorer redirect exposed the same issue. The complete-features matrix does not include these routes, so its success did not cover this defect.

The correction assigns the existing themed card background to `.dir-gnoweb-link` and a pointer cursor. Contrast rules, assertions and workflow requirements remain unchanged. The existing route group passed all four cases in both dark and light themes at 390px and 1600px, covering eight routes per case (32 route/theme/width checks). Local log: `/private/tmp/memba-c1-source-contrast-browser.log`. All hosted checks, including both complete-design matrices, passed on corrected head `c6e2683eac16527515d81c6af3b48c43d78eb0d6` before merge.

## Bounded reliability evidence

Five deferred-response regressions failed before the fix and passed afterward: stale global preview, stale expanded-realm preview, stuck loading after clear, delayed read after unmount, and Render attempted for a package path. Recovery tests distinguish successful empty Render output from a failed strict read and verify explicit source retry. Query state is keyed by network and path; existing transport timeouts/fallbacks and NetworkSync reload behavior remain intact.

The targeted browser matrix checks App Store browsing, realm search and one detail view in Light/Black at 320, 390 and 1440 pixels with reduced motion. Axe rules cover contrast, labels, button/link names and nested interactions; overflow is checked. Keyboard checks in Chromium, Firefox and iPhone WebKit cover initial drawer focus, Tab containment, arrow-key selection, Escape and focus return. This is bounded coverage, not a whole-app accessibility certification.

Existing API limitation: function-list transport failures can still become an empty array in `fetchRealmFuncs`; no new transport/API semantics are claimed. CSP continues to block mainnet namespace discovery and the labeled editorial fallback remains intentional. No runtime, realm eligibility or wallet action changed.

## Final local candidate checks

The reliability candidate passed 5,666 unit/component tests (one existing skip), lint, TypeScript/production build and bundle isolation/precache checks. Fifteen focused browser cases passed with the default Explorer flag; the six Explorer-on navigation cases and six Explorer-on size/theme audits passed after correcting a test assertion that raced lazy mounting. The five before/after regressions and three recovery tests are committed beside the affected code.

A temporary uncommitted integration checkout combined all three C1 slices. Both sides of additive conflicts in `complete-design.spec.ts` and the test-only network-pin inventory were retained. Its 32 focused unit tests and 21 browser cases passed, including the new seven-project catalog at 320/390/1440 pixels in Light/Black and the mainnet/Pearl central journeys across Chromium, Firefox and iPhone WebKit. This local integration check does not replace the planned fresh-main rebase, hosted gates or production verification after each reviewed merge.

## Reliability integration on released Directory

On main `a65800118e50c83db1fed18578d57bfd658a2177`, 23 focused unit/component tests passed. The combined browser pass completed 23 cases (catalog, drawer keyboard, responsive audits and the former contrast-failing group), plus six Explorer-disabled mainnet/Pearl navigation cases and 12 Explorer-enabled navigation/audit cases: 41 total. Lint, TypeScript/production build and bundle isolation/precache checks passed with Node 22. The previous complete reliability suite passed 5,666 tests with one existing skip; the rebased runtime is unchanged except for the inherited released contrast fix.

Logs: `/private/tmp/memba-c1-reliability-refreshed-{unit,browser,navigation,explorer,build}.log`. Subsequent hosted and production results are recorded below.

## Final reliability release

[PR #1241](https://github.com/samouraiworld/memba/pull/1241) merged at 09:31:30 UTC as `a2ac44d44a7b1bdbba1ce427f241a43acb4a35a6`. Every applicable hosted check passed on reviewed head `9b247c30d991b793930e5d6dd65a5b3ca2adbb39`, including Node 20/22, backend, security, E2E, both complete-design matrices and the four-browser professional preview. Both independent CTO and SWE reviewers cleared that exact revision.

Production `/build-info.json`, directly served route HTML and both verification tabs matched entry `assets/index-Cf0yRZnt.js`, version 7.7.0, for the final merge. A returning tab initially retained the previous entry through two early reloads; a later ordinary reload after the update settled received the new bundle without clearing storage or unregistering the service worker. This records eventual update convergence, not an instantaneous upgrade guarantee.

On the final entry, the returning tab retained the Boards query, opened exact mainnet Boards v0 and restored the query on Back. A newly opened tab browsed all seven catalog entries, followed the fixed mainnet Explorer link, and loaded the live Boards Render and source. On Pearl, a package drawer placed initial focus on Close, selected Info with the arrow key, dismissed on Escape and restored focus to the source-action trigger. Fresh-tab checks do not claim a clean browser profile. Request-race and forced-error recovery evidence remains the controlled tests above; no wallet transaction was attempted.

C1's implementation scope is complete. Remaining source/API boundaries (unidentified indexer data, restricted mainnet namespace access and function-error ambiguity) are explicitly documented above. New feeds, runtime/dependency upgrades, realm publication and authority or financial-policy changes require separate scope; deployment retains those workstreams.

Merged-main follow-up runs: [CI](https://github.com/samouraiworld/memba/actions/runs/35710879996), [frontend gate](https://github.com/samouraiworld/memba/actions/runs/35710879962), [Security](https://github.com/samouraiworld/memba/actions/runs/35710880000), [Attribution](https://github.com/samouraiworld/memba/actions/runs/35710879979). Security and Attribution passed at closeout preparation; CI and the frontend gate were still running without reported failures. These follow-up statuses are separate from the fully passing pre-merge checks above.
