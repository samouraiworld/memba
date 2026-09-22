# C1 discovery evidence — 2026-09-22

## Release status

Catalog PR #1239 is merged and production-verified. Directory PR #1240 remains a candidate pending its required GitHub review and hosted checks. A+B remains closed. No wallet, signature, broadcast, publication or deployment-policy change was exercised.

Catalog PR #1239 merged at 07:55:57 UTC as `25ef19793528747d99cafeaf4b1c72605e74a6b7`. Production `/build-info.json` subsequently reported that commit and `assets/index-DmSLVy3n.js`; the same entry was observed in both browser tabs. A tab loaded before rollout received the new catalog after an ordinary reload, retained `boards2/v0` search across another reload, and showed one correct mainnet result. A newly opened tab correctly gated `/mainnet/apps/submit`; its “Browse ecosystem projects” link opened all seven records without registry publishing navigation. This is a fresh-tab and returning-tab check in one browser profile, not a clean-profile or real-wallet claim. Initial rollout sampling still served the previous commit; it converged without manual deployment.

The catalog's preview and pre-merge head were `0961f44668aab6bd93e88b2a673f684d93eb6162`, entry `assets/index-DmSLVy3n.js`. Independent CTO/SWE reviews and all hosted checks, including both complete-design matrices, passed before merge.

Directory was refreshed onto the merged catalog. Two additive test conflicts in `complete-design.spec.ts` and `networkPins.test.ts` were resolved by retaining both sections; no runtime conflict or deployment-owned file changed. Refreshed integration checks are recorded below before release.

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
